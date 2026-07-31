/**
 * Adaptive TDEE — energy expenditure inferred from what actually happened, not
 * from a population equation.
 *
 * `lib/nutrition.ts` predicts TDEE from BMR × an activity multiplier. That is a
 * starting guess: the multipliers are coarse and NEAT varies enormously between
 * people. Once a user has a couple of weeks of scale weights and food logs, the
 * energy balance equation solves for their real expenditure:
 *
 *     TDEE = mean daily intake − (Δ stored energy / days)
 *
 * with Δ stored energy from the smoothed weight trend at ~7700 kcal per kg.
 *
 * Everything here is pure — inputs in, numbers out — so it runs identically on
 * cached IndexedDB rows offline and on fresh data online.
 */

import type { FitnessGoal } from "../nutrition";

/** Energy density of body mass. 1 kg of adipose ≈ 7700 kcal; the same figure is
 *  used for gains, where it under-states the cost of lean tissue and therefore
 *  errs toward *under*-feeding a surplus rather than over-feeding it. */
export const KCAL_PER_KG_BODY_MASS = 7700;

/** The analysis window, in days. Below 14 the scale noise (glycogen, sodium, gut
 *  content) swamps the signal; above 30 a real change in activity or metabolism
 *  gets averaged away. */
export const MIN_WINDOW_DAYS = 14;
export const MAX_WINDOW_DAYS = 30;
export const DEFAULT_WINDOW_DAYS = 21;

/** Half-life of the exponential weight filter, in days. 7 days keeps roughly a
 *  week of history at meaningful weight — enough to flatten a single salty meal
 *  without lagging a genuine trend by more than a couple of days. */
export const DEFAULT_HALF_LIFE_DAYS = 7;

/** Minimum coverage before a TDEE estimate is worth showing at all. */
const MIN_WEIGHT_POINTS = 6;
const MIN_SPAN_DAYS = 10;
const MIN_INTAKE_DAYS = 8;

/** Physiological sanity rails. Anything outside this is a logging artefact
 *  (a forgotten day, a double-logged meal), not a metabolism. */
const MIN_PLAUSIBLE_TDEE = 800;
const MAX_PLAUSIBLE_TDEE = 6000;

export interface WeightPoint {
  /** yyyy-MM-dd */
  date: string;
  weightKg: number;
}

export interface IntakePoint {
  /** yyyy-MM-dd */
  date: string;
  calories: number;
}

export interface SmoothedWeightPoint {
  date: string;
  /** The raw scale reading. */
  weightKg: number;
  /** The EWMA ("trend weight") at this date. */
  trendKg: number;
}

export type TdeeConfidence = "none" | "low" | "medium" | "high";

export interface AdaptiveTdeeResult {
  /** kcal/day, or null when the data can't support an estimate. */
  tdee: number | null;
  confidence: TdeeConfidence;
  /** Why the estimate is null or low-confidence — a UI-friendly discriminant. */
  reason: "ok" | "notEnoughWeight" | "notEnoughIntake" | "spanTooShort" | "implausible";
  windowDays: number;
  /** Days between the first and last weigh-in actually used. */
  spanDays: number;
  weightPointsUsed: number;
  intakeDaysUsed: number;
  /** Share of the window's days that carry a food log (0–1). Sparse logging
   *  biases mean intake, so this drives confidence more than anything else. */
  intakeCoverage: number;
  meanIntake: number | null;
  /** Fitted trend weight at each end of the window (kg) — see `fitTrendLine`. */
  startTrendKg: number | null;
  endTrendKg: number | null;
  /** How well a straight line describes the window (0–1). A low value means the
   *  weight moved erratically and the rate below is a weak summary of it. */
  fitQuality: number | null;
  /** Trend change over the window, kg. Negative = losing. */
  trendChangeKg: number | null;
  weeklyRateKg: number | null;
  /** Weekly change as a percentage of current body weight — the unit every
   *  rate guideline is actually written in. */
  weeklyRatePct: number | null;
  /** Mean daily surplus (+) or deficit (−) implied by the trend. */
  energyBalance: number | null;
  series: SmoothedWeightPoint[];
}

function toDayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? NaN : Math.round(ms / 86_400_000);
}

function round(value: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function clampWindowDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.round(days)));
}

/**
 * Exponentially weighted moving average over daily scale weight.
 *
 * The decay is computed from the *gap between weigh-ins*, not from the index, so
 * a missed week decays the old value by a week rather than by one reading. That
 * matters: index-based EWMA on irregular logs makes a stale weight look current.
 *
 * Same-day duplicates are averaged before smoothing.
 */
export function ewmaSeries(
  points: WeightPoint[],
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS
): SmoothedWeightPoint[] {
  const byDate = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.weightKg) || p.weightKg <= 0) continue;
    if (Number.isNaN(toDayNumber(p.date))) continue;
    const bucket = byDate.get(p.date) ?? { sum: 0, n: 0 };
    bucket.sum += p.weightKg;
    bucket.n += 1;
    byDate.set(p.date, bucket);
  }

  const daily = Array.from(byDate.entries())
    .map(([date, b]) => ({ date, weightKg: b.sum / b.n }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (daily.length === 0) return [];

  const halfLife = Math.max(0.5, halfLifeDays);
  const out: SmoothedWeightPoint[] = [];
  let trend = daily[0].weightKg;
  let prevDay = toDayNumber(daily[0].date);

  for (let i = 0; i < daily.length; i++) {
    const day = toDayNumber(daily[i].date);
    if (i > 0) {
      const gap = Math.max(1, day - prevDay);
      // Weight of the new reading grows with the gap: after one half-life it is
      // 0.5, after two 0.75 — i.e. old data stops dominating once it is stale.
      const alpha = 1 - Math.exp((-Math.LN2 * gap) / halfLife);
      trend = trend + alpha * (daily[i].weightKg - trend);
    }
    prevDay = day;
    out.push({ date: daily[i].date, weightKg: round(daily[i].weightKg, 2), trendKg: round(trend, 3) });
  }

  return out;
}

export interface TrendLine {
  /** kg per day. Negative = losing. */
  slopeKgPerDay: number;
  /** Fitted weight at the window's first and last dates. */
  startKg: number;
  endKg: number;
  /** R² of the fit, 0–1. */
  fitQuality: number;
}

/**
 * Least-squares line through the daily weights.
 *
 * Why this and not "EWMA at the end minus EWMA at the start": an exponential
 * filter *lags*. Applied to a genuinely linear trend it settles a fixed distance
 * behind the truth, while its first value is seeded at the raw reading with no
 * lag at all — so differencing the two ends systematically under-reads the real
 * change. On a 21-day, −0.45 kg/week trend that shortfall is worth roughly
 * 200 kcal/day of TDEE, which is more than the effect the whole feature exists
 * to detect.
 *
 * A regression slope has no such bias: scale noise raises its variance (which is
 * what `fitQuality` and the confidence rating report) but not its expectation.
 * The EWMA still earns its place as the *smoother* — it is what the series and
 * the displayed trend weight are drawn from — it just isn't a rate estimator.
 */
export function fitTrendLine(points: SmoothedWeightPoint[]): TrendLine | null {
  if (points.length < 2) return null;

  const originDay = toDayNumber(points[0].date);
  const xs = points.map(p => toDayNumber(p.date) - originDay);
  const ys = points.map(p => p.weightKg);
  const n = points.length;

  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  if (sxx === 0) return null; // every reading on the same day

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i] - (intercept + slope * xs[i])) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }

  const lastX = xs[n - 1];
  return {
    slopeKgPerDay: slope,
    startKg: round(intercept, 3),
    endKg: round(intercept + slope * lastX, 3),
    // ssTot === 0 means a perfectly flat scale: the line fits exactly.
    fitQuality: ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot)),
  };
}

/**
 * Solve the energy balance equation over the window.
 *
 * `referenceDate` (yyyy-MM-dd) defaults to today and defines the window's right
 * edge, so the caller can reproduce a past estimate deterministically.
 */
export function calculateAdaptiveTdee(params: {
  weights: WeightPoint[];
  intake: IntakePoint[];
  windowDays?: number;
  halfLifeDays?: number;
  referenceDate?: string;
}): AdaptiveTdeeResult {
  const windowDays = clampWindowDays(params.windowDays ?? DEFAULT_WINDOW_DAYS);
  const reference = params.referenceDate ?? new Date().toISOString().slice(0, 10);
  const refDay = toDayNumber(reference);
  const cutoffDay = refDay - (windowDays - 1);

  const empty: AdaptiveTdeeResult = {
    tdee: null,
    confidence: "none",
    reason: "notEnoughWeight",
    windowDays,
    spanDays: 0,
    weightPointsUsed: 0,
    intakeDaysUsed: 0,
    intakeCoverage: 0,
    meanIntake: null,
    startTrendKg: null,
    endTrendKg: null,
    fitQuality: null,
    trendChangeKg: null,
    weeklyRateKg: null,
    weeklyRatePct: null,
    energyBalance: null,
    series: [],
  };

  const inWindow = (date: string) => {
    const d = toDayNumber(date);
    return !Number.isNaN(d) && d >= cutoffDay && d <= refDay;
  };

  // Smooth over the window's readings only — an EWMA seeded from months of
  // older data would carry a stale trend into the first in-window point.
  const series = ewmaSeries(params.weights.filter(w => inWindow(w.date)), params.halfLifeDays);
  if (series.length < MIN_WEIGHT_POINTS) {
    return { ...empty, series, weightPointsUsed: series.length, reason: "notEnoughWeight" };
  }

  const first = series[0];
  const last = series[series.length - 1];
  const spanDays = toDayNumber(last.date) - toDayNumber(first.date);
  if (spanDays < MIN_SPAN_DAYS) {
    return {
      ...empty,
      series,
      weightPointsUsed: series.length,
      spanDays,
      reason: "spanTooShort",
    };
  }

  // Only days that actually carry food logs count. Treating an unlogged day as
  // zero calories would drag mean intake down and inflate TDEE — the single most
  // common way an adaptive estimate goes wrong.
  const intakeByDate = new Map<string, number>();
  for (const p of params.intake) {
    if (!inWindow(p.date) || !Number.isFinite(p.calories) || p.calories <= 0) continue;
    intakeByDate.set(p.date, (intakeByDate.get(p.date) ?? 0) + p.calories);
  }
  // Restrict intake to the weigh-in span: calories logged before the first
  // weigh-in describe a period the weight trend says nothing about.
  const firstDay = toDayNumber(first.date);
  const lastDay = toDayNumber(last.date);
  const spanIntake = Array.from(intakeByDate.entries()).filter(([date]) => {
    const d = toDayNumber(date);
    return d >= firstDay && d <= lastDay;
  });

  const intakeDaysUsed = spanIntake.length;
  const spanTotalDays = spanDays + 1;
  const intakeCoverage = round(intakeDaysUsed / spanTotalDays, 3);

  if (intakeDaysUsed < MIN_INTAKE_DAYS) {
    return {
      ...empty,
      series,
      weightPointsUsed: series.length,
      spanDays,
      intakeDaysUsed,
      intakeCoverage,
      reason: "notEnoughIntake",
    };
  }

  const meanIntake = spanIntake.reduce((sum, [, kcal]) => sum + kcal, 0) / intakeDaysUsed;

  const fit = fitTrendLine(series);
  if (!fit) {
    return {
      ...empty,
      series,
      weightPointsUsed: series.length,
      spanDays,
      intakeDaysUsed,
      intakeCoverage,
      reason: "spanTooShort",
    };
  }

  const trendChangeKg = fit.slopeKgPerDay * spanDays;
  const weeklyRateKg = fit.slopeKgPerDay * 7;
  const energyBalance = fit.slopeKgPerDay * KCAL_PER_KG_BODY_MASS;
  const tdeeRaw = meanIntake - energyBalance;

  const base = {
    ...empty,
    series,
    weightPointsUsed: series.length,
    spanDays,
    intakeDaysUsed,
    intakeCoverage,
    meanIntake: round(meanIntake),
    startTrendKg: fit.startKg,
    endTrendKg: fit.endKg,
    fitQuality: round(fit.fitQuality, 3),
    trendChangeKg: round(trendChangeKg, 2),
    weeklyRateKg: round(weeklyRateKg, 3),
    weeklyRatePct: fit.endKg > 0 ? round((weeklyRateKg / fit.endKg) * 100, 2) : null,
    energyBalance: round(energyBalance),
  };

  if (tdeeRaw < MIN_PLAUSIBLE_TDEE || tdeeRaw > MAX_PLAUSIBLE_TDEE) {
    return { ...base, tdee: null, confidence: "none", reason: "implausible" };
  }

  // Confidence is really "how much do I trust mean intake", which is coverage,
  // tempered by how long the weight trend has had to separate from noise.
  let confidence: TdeeConfidence = "low";
  if (intakeCoverage >= 0.8 && spanDays >= 17 && series.length >= 10) confidence = "high";
  else if (intakeCoverage >= 0.6 && spanDays >= 13) confidence = "medium";

  return { ...base, tdee: Math.round(tdeeRaw), confidence, reason: "ok" };
}

/* ══════════════════════════════════════════════════════════════════════════════
   Weekly macro adjustment
   ══════════════════════════════════════════════════════════════════════════ */

export type AdaptiveGoal = "hypertrophy" | "maintenance" | "cut";

/** Target rate bands as a percentage of body weight per week.
 *  Hypertrophy: 0.25–0.5 %/wk is the range where added mass stays mostly lean.
 *  Cut: 0.5–1.0 %/wk preserves lean mass; past ~1 % the losses stop being fat.
 *  Maintenance: a dead band, not a target — inside it, change nothing. */
export const GOAL_RATE_BANDS: Record<AdaptiveGoal, { min: number; max: number }> = {
  hypertrophy: { min: 0.25, max: 0.5 },
  maintenance: { min: -0.15, max: 0.15 },
  cut: { min: -1.0, max: -0.5 },
};

/** Maps the calculator's five-step goal onto the three auto-regulated modes. */
export function goalToAdaptiveGoal(goal: FitnessGoal): AdaptiveGoal {
  if (goal === "loseFast" || goal === "lose") return "cut";
  if (goal === "gain" || goal === "gainFast") return "hypertrophy";
  return "maintenance";
}

/** Never move a target by more than this in one weekly review — a large jump
 *  makes the *next* estimate unreadable, because intake and weight would both
 *  have changed mid-window. */
const MAX_WEEKLY_CALORIE_STEP = 300;
/** Protein and fat floors, g/kg. Carbs absorb the adjustment; fat only gives way
 *  once carbs are exhausted, and never below the hormonal floor. */
const PROTEIN_G_PER_KG = 2.0;
const FAT_G_PER_KG_TARGET = 0.8;
const FAT_G_PER_KG_FLOOR = 0.6;

export interface MacroTargets {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface WeeklyAdjustment {
  status: "insufficientData" | "onTrack" | "increase" | "decrease";
  goal: AdaptiveGoal;
  /** Midpoint of the goal band, %/wk. */
  targetWeeklyRatePct: number;
  targetWeeklyRateKg: number;
  observedWeeklyRateKg: number | null;
  observedWeeklyRatePct: number | null;
  /** kcal/day change to apply, already capped and rounded to 10. */
  calorieDelta: number;
  /** The new daily targets. Equals `current` when nothing should change. */
  next: MacroTargets;
  current: MacroTargets;
  confidence: TdeeConfidence;
}

/**
 * Re-derive daily macros for a calorie target: protein and fat are anchored to
 * body mass (they are structural, not a lever), carbs take the swing. Mirrors
 * the "sportsScience" split in lib/nutrition.ts so switching between the manual
 * calculator and the adaptive engine doesn't reshuffle a user's macros.
 */
export function macrosForCalories(calories: number, bodyWeightKg: number): MacroTargets {
  const kcal = Math.max(0, Math.round(calories));
  const protein = Math.round(bodyWeightKg * PROTEIN_G_PER_KG);
  let fats = Math.round(bodyWeightKg * FAT_G_PER_KG_TARGET);

  let carbs = Math.round((kcal - protein * 4 - fats * 9) / 4);
  if (carbs < 0) {
    // Aggressive deficit: give fat back down to the floor before letting carbs
    // go negative, then accept whatever protein + fat alone costs.
    const fatFloor = Math.round(bodyWeightKg * FAT_G_PER_KG_FLOOR);
    fats = Math.max(fatFloor, Math.round((kcal - protein * 4) / 9));
    carbs = Math.max(0, Math.round((kcal - protein * 4 - fats * 9) / 4));
  }

  return { calories: kcal, protein, carbs, fats };
}

/**
 * Compare the observed trend against the goal band and return the week's move.
 *
 * The adjustment is driven by the *rate gap*, converted through 7700 kcal/kg
 * into a daily calorie delta — so a user 0.2 %/wk short of their surplus gets
 * exactly the calories that gap is worth, not a fixed ±100.
 */
export function recommendWeeklyAdjustment(params: {
  goal: AdaptiveGoal;
  bodyWeightKg: number;
  current: MacroTargets;
  observedWeeklyRateKg: number | null;
  confidence: TdeeConfidence;
  /** When supplied, the calorie target is re-anchored to measured expenditure
   *  rather than nudged from the current one — a better base once trustworthy. */
  tdee?: number | null;
}): WeeklyAdjustment {
  const { goal, bodyWeightKg, current, observedWeeklyRateKg, confidence } = params;
  const band = GOAL_RATE_BANDS[goal];
  const targetPct = (band.min + band.max) / 2;
  const targetWeeklyRateKg = round((targetPct / 100) * bodyWeightKg, 3);
  const observedPct =
    observedWeeklyRateKg != null && bodyWeightKg > 0
      ? round((observedWeeklyRateKg / bodyWeightKg) * 100, 2)
      : null;

  const idle: WeeklyAdjustment = {
    status: "insufficientData",
    goal,
    targetWeeklyRatePct: round(targetPct, 2),
    targetWeeklyRateKg,
    observedWeeklyRateKg,
    observedWeeklyRatePct: observedPct,
    calorieDelta: 0,
    next: current,
    current,
    confidence,
  };

  if (observedWeeklyRateKg == null || observedPct == null || bodyWeightKg <= 0) return idle;
  if (confidence === "none") return idle;

  // Inside the band, the plan is working — leave it alone. Chasing the exact
  // midpoint every week just adds noise to the next estimate.
  if (observedPct >= band.min && observedPct <= band.max) {
    return { ...idle, status: "onTrack" };
  }

  const gapKgPerWeek = targetWeeklyRateKg - observedWeeklyRateKg;
  const rawDelta = (gapKgPerWeek * KCAL_PER_KG_BODY_MASS) / 7;
  const capped = Math.max(-MAX_WEEKLY_CALORIE_STEP, Math.min(MAX_WEEKLY_CALORIE_STEP, rawDelta));
  const calorieDelta = Math.round(capped / 10) * 10;

  if (calorieDelta === 0) return { ...idle, status: "onTrack" };

  // With a trustworthy TDEE, anchor to it: target = measured expenditure + the
  // surplus/deficit the goal rate is worth. Otherwise nudge the existing target.
  const anchored =
    params.tdee != null && confidence === "high"
      ? params.tdee + (targetWeeklyRateKg * KCAL_PER_KG_BODY_MASS) / 7
      : current.calories + calorieDelta;

  const nextCalories = Math.max(MIN_PLAUSIBLE_TDEE, Math.round(anchored / 10) * 10);

  return {
    ...idle,
    status: calorieDelta > 0 ? "increase" : "decrease",
    calorieDelta,
    next: macrosForCalories(nextCalories, bodyWeightKg),
  };
}
