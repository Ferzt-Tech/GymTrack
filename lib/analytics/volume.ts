/**
 * Volume auto-regulation — Renaissance Periodization set progression.
 *
 * The landmarks (MV/MEV/MAV/MRV) say what a *population* can recover from; they
 * can't say what this user recovered from last week. Pump and soreness can: pump
 * proxies the stimulus a session actually delivered, soreness proxies whether
 * the last one was recovered from in time. Together they resolve the only
 * question that matters between microcycles — add sets, hold, or back off.
 *
 * Pure functions; the feedback rows come from lib/volumeFeedback.ts.
 */

import type { PumpRating, SorenessRating, VolumeFeedback } from "@/types";

/* Weekly sets per muscle group. */
/** Maintenance volume — enough to hold what you have. */
export const MV = 6;
/** Minimum effective volume — the floor for growth. */
export const MEV = 10;
/** Top of the maximum adaptive volume band. */
export const MAV_TOP = 20;
/** Maximum recoverable volume — past this, fatigue outruns adaptation. */
export const MRV = 22;
/** Full-scale end for the landmark bar. */
export const SCALE_MAX = 26;

/** Feedback older than this no longer describes current recovery capacity. */
export const FEEDBACK_STALE_DAYS = 14;

/**
 * RP's set progression matrix, indexed [soreness][pump].
 *
 * Soreness is read first because it gates everything: still sore at the door
 * means the previous dose has not been paid off, and adding volume on top of an
 * unpaid debt is how a mesocycle ends early. Within a recovered state, a low
 * pump means the session under-delivered stimulus and there is room to add more.
 *
 *   soreness 0 = none            pump 0 = none
 *   soreness 1 = recovered just in time   pump 1 = moderate
 *   soreness 2 = still sore      pump 2 = insane
 */
export const SET_CHANGE_MATRIX: Record<SorenessRating, Record<PumpRating, number>> = {
  0: { 0: +3, 1: +2, 2: +1 },
  1: { 0: +2, 1: +1, 2: 0 },
  // Still sore: hold at best. A big pump on top of unresolved soreness is the
  // signature of exceeding MRV, so that cell actively pulls volume back.
  2: { 0: 0, 1: 0, 2: -2 },
};

export type VolumeZone = "belowMev" | "growth" | "aboveMrv";
export type VolumeAction = "add" | "hold" | "reduce" | "deload";

export interface VolumeRecommendation {
  muscle: string;
  /** Sets logged for this muscle in the current week. */
  currentSets: number;
  /** Sets to target next microcycle, clamped into the landmark band. */
  recommendedSets: number;
  /** recommendedSets − currentSets, after clamping. */
  delta: number;
  action: VolumeAction;
  zone: VolumeZone;
  /** The feedback that drove it, or null when there is none / it went stale. */
  feedback: VolumeFeedback | null;
  /** True when feedback exists but predates FEEDBACK_STALE_DAYS. */
  stale: boolean;
}

export function zoneFor(sets: number): VolumeZone {
  if (sets < MEV) return "belowMev";
  if (sets > MRV) return "aboveMrv";
  return "growth";
}

function daysBetween(fromISODate: string, toISODate: string): number {
  const a = Date.parse(`${fromISODate}T00:00:00Z`);
  const b = Date.parse(`${toISODate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

/** Most recent feedback per muscle group, newest first by date then insert time. */
export function latestFeedbackByMuscle(
  feedback: VolumeFeedback[]
): Record<string, VolumeFeedback> {
  const out: Record<string, VolumeFeedback> = {};
  for (const f of feedback) {
    const current = out[f.muscle_group];
    if (
      !current ||
      f.logged_date > current.logged_date ||
      (f.logged_date === current.logged_date && f.created_at > current.created_at)
    ) {
      out[f.muscle_group] = f;
    }
  }
  return out;
}

/**
 * Next microcycle's set target for one muscle group.
 *
 * Clamping is deliberately asymmetric. Upward it stops at MRV — the matrix can
 * suggest +3, but pushing past maximum recoverable volume is exactly what the
 * landmark exists to prevent. Downward it stops at MEV, *except* when soreness
 * says recovery is already failing: that is a deload, and a deload below MEV is
 * the point.
 */
export function recommendSets(params: {
  muscle: string;
  currentSets: number;
  feedback?: VolumeFeedback | null;
  /** yyyy-MM-dd; defaults to today. Only used for the staleness check. */
  referenceDate?: string;
}): VolumeRecommendation {
  const { muscle, currentSets } = params;
  const reference = params.referenceDate ?? new Date().toISOString().slice(0, 10);
  const zone = zoneFor(currentSets);

  const raw = params.feedback ?? null;
  const stale = raw != null && daysBetween(raw.logged_date, reference) > FEEDBACK_STALE_DAYS;
  const feedback = stale ? null : raw;

  // No usable feedback: fall back to the landmarks alone — nudge toward MEV from
  // below, back toward MRV from above, otherwise leave the plan as it stands.
  if (!feedback) {
    let recommended = currentSets;
    let action: VolumeAction = "hold";
    if (zone === "belowMev") {
      recommended = Math.min(MEV, currentSets + 2);
      action = "add";
    } else if (zone === "aboveMrv") {
      recommended = MRV;
      action = "reduce";
    }
    return {
      muscle,
      currentSets,
      recommendedSets: recommended,
      delta: recommended - currentSets,
      action,
      zone,
      feedback: null,
      stale,
    };
  }

  const change = SET_CHANGE_MATRIX[feedback.soreness][feedback.pump];

  // Still sore while already at or above MRV is the textbook deload trigger:
  // volume is past what can be recovered from, and trimming a set or two won't
  // clear the debt. Drop to maintenance volume for a week instead.
  const needsDeload = feedback.soreness === 2 && currentSets >= MRV;
  if (needsDeload) {
    return {
      muscle,
      currentSets,
      recommendedSets: MV,
      delta: MV - currentSets,
      action: "deload",
      zone,
      feedback,
      stale: false,
    };
  }

  const proposed = currentSets + change;
  const floor = change < 0 ? MV : Math.min(MEV, currentSets);
  const recommended = Math.max(floor, Math.min(MRV, proposed));
  const delta = recommended - currentSets;

  return {
    muscle,
    currentSets,
    recommendedSets: recommended,
    delta,
    action: delta > 0 ? "add" : delta < 0 ? "reduce" : "hold",
    zone,
    feedback,
    stale: false,
  };
}

/**
 * Recommendations for every muscle group trained this week, ordered by current
 * volume (descending) so the heaviest loads read first.
 */
export function buildVolumePlan(params: {
  weeklyMuscles: Record<string, number>;
  feedback: VolumeFeedback[];
  referenceDate?: string;
}): VolumeRecommendation[] {
  const latest = latestFeedbackByMuscle(params.feedback);
  return Object.entries(params.weeklyMuscles)
    .map(([muscle, currentSets]) =>
      recommendSets({
        muscle,
        currentSets,
        feedback: latest[muscle] ?? null,
        referenceDate: params.referenceDate,
      })
    )
    .sort((a, b) => b.currentSets - a.currentSets);
}
