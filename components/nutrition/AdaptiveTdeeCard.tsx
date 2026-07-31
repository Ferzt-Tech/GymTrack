"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/db";
import { getCached, setCache } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { useT } from "@/lib/context/LanguageContext";
import { cn } from "@/lib/utils";
import {
  calculateAdaptiveTdee,
  goalToAdaptiveGoal,
  recommendWeeklyAdjustment,
  type AdaptiveTdeeResult,
  type WeeklyAdjustment,
} from "@/lib/analytics/tdee";
import type { FitnessGoal } from "@/lib/nutrition";
import type { DailyWeightLog, FoodLog, WeightUnit } from "@/types";

interface CachedTargets {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  calculatedAt: string;
}

interface Props {
  /** Display unit only — daily_weight_logs.weight is always stored in kg. */
  unit: WeightUnit;
  /** Bump to recompute (the page's refetchKey). */
  refetchKey?: number;
  /** Called after the user applies a new calorie target. */
  onTargetsApplied?: () => void;
}

const KG_TO_LBS = 2.20462;

function fmtWeight(kg: number, unit: WeightUnit): string {
  const v = unit === "lbs" ? kg * KG_TO_LBS : kg;
  return v.toFixed(1);
}

function fmtSignedWeight(kg: number, unit: WeightUnit): string {
  const v = unit === "lbs" ? kg * KG_TO_LBS : kg;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

/**
 * Measured expenditure from the last few weeks of scale weights and food logs,
 * plus the week's suggested calorie move. Reads entirely from IndexedDB, so it
 * works offline and for guests exactly as it does online.
 */
export default function AdaptiveTdeeCard({ unit, refetchKey = 0, onTargetsApplied }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AdaptiveTdeeResult | null>(null);
  const [adjustment, setAdjustment] = useState<WeeklyAdjustment | null>(null);
  const [targets, setTargets] = useState<CachedTargets | null>(null);
  const [applied, setApplied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    const userId = await resolveUserId();
    const db = await getDb();
    if (!userId || !db) { setLoading(false); return; }

    const [weightRows, foodRows] = await Promise.all([
      db.getAll("daily_weight_logs") as Promise<DailyWeightLog[]>,
      db.getAll("food_logs") as Promise<FoodLog[]>,
    ]);

    const tdee = calculateAdaptiveTdee({
      // Stored weights are canonical kg (WeightLogger converts on the way in).
      weights: weightRows
        .filter(r => r.user_id === userId && r.weight > 0)
        .map(r => ({ date: r.logged_date, weightKg: r.weight })),
      intake: foodRows
        .filter(r => r.user_id === userId)
        .map(r => ({ date: r.logged_date, calories: r.calories })),
    });

    const cachedTargets = await getCached<CachedTargets>("auth:nutrition_targets");
    const inputs = await getCached<{ goal?: FitnessGoal }>("auth:nutrition_inputs");

    const bodyWeightKg = tdee.endTrendKg ?? 0;
    const adj =
      cachedTargets && bodyWeightKg > 0
        ? recommendWeeklyAdjustment({
            goal: goalToAdaptiveGoal(inputs?.goal ?? "maintain"),
            bodyWeightKg,
            current: {
              calories: cachedTargets.calories,
              protein: cachedTargets.protein,
              carbs: cachedTargets.carbs,
              fats: cachedTargets.fats,
            },
            observedWeeklyRateKg: tdee.weeklyRateKg,
            confidence: tdee.confidence,
            tdee: tdee.tdee,
          })
        : null;

    setResult(tdee);
    setTargets(cachedTargets);
    setAdjustment(adj);
    setApplied(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    load().catch(err => {
      console.error("Adaptive TDEE failed:", err);
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [load, refetchKey]);

  async function applyAdjustment() {
    if (!adjustment || adjustment.status === "onTrack" || adjustment.status === "insufficientData") return;
    await setCache("auth:nutrition_targets", {
      ...adjustment.next,
      calculatedAt: new Date().toISOString(),
    });
    setApplied(true);
    onTargetsApplied?.();
  }

  const statusTone = useMemo(() => {
    switch (result?.confidence) {
      case "high":   return "var(--accent)";
      case "medium": return "var(--chart-1)";
      case "low":    return "var(--chart-4)";
      default:       return "var(--faint)";
    }
  }, [result?.confidence]);

  if (loading) {
    return <div className="skeleton h-32 w-full rounded-2xl" />;
  }
  if (!result) return null;

  /* Not enough data yet — say exactly what's missing rather than showing a
     number the data can't support. */
  if (result.tdee == null) {
    return (
      <div className="card-glass p-4 space-y-2">
        <p className="section-label !mb-1">{t.adaptiveTdee.title}</p>
        <p className="text-[11px] text-[var(--faint)] leading-relaxed">
          {result.reason === "notEnoughIntake"
            ? t.adaptiveTdee.needIntake(result.intakeDaysUsed)
            : result.reason === "implausible"
              ? t.adaptiveTdee.implausible
              : t.adaptiveTdee.needWeight(result.weightPointsUsed)}
        </p>
      </div>
    );
  }

  const rate = result.weeklyRateKg ?? 0;
  const rateTone = Math.abs(rate) < 0.05 ? "var(--sub)" : rate > 0 ? "var(--chart-1)" : "var(--chart-4)";

  return (
    <div className="card-glass p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="section-label !mb-0">{t.adaptiveTdee.title}</p>
        <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: statusTone }}>
          ◈ {t.adaptiveTdee.confidence[result.confidence]}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-[var(--accent-faint)] px-2.5 py-2">
          <p className="metric text-lg font-bold leading-none text-[var(--accent)]">{result.tdee}</p>
          <p className="text-[9px] font-mono uppercase tracking-wide text-[var(--faint)] mt-1 leading-none">
            {t.adaptiveTdee.kcalPerDay}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] px-2.5 py-2">
          <p className="metric text-lg font-bold leading-none" style={{ color: rateTone }}>
            {fmtSignedWeight(rate, unit)}
          </p>
          <p className="text-[9px] font-mono uppercase tracking-wide text-[var(--faint)] mt-1 leading-none">
            {t.adaptiveTdee.perWeek(unit)}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] px-2.5 py-2">
          <p className="metric text-lg font-bold leading-none text-[var(--text)]">
            {result.endTrendKg != null ? fmtWeight(result.endTrendKg, unit) : "—"}
          </p>
          <p className="text-[9px] font-mono uppercase tracking-wide text-[var(--faint)] mt-1 leading-none">
            {t.adaptiveTdee.trendWeight}
          </p>
        </div>
      </div>

      {/* The weekly call */}
      {adjustment && adjustment.status === "onTrack" && (
        <p className="text-[11px] text-[var(--accent)] leading-relaxed">
          ✓ {t.adaptiveTdee.onTrack(t.adaptiveTdee.goals[adjustment.goal])}
        </p>
      )}

      {adjustment && (adjustment.status === "increase" || adjustment.status === "decrease") && (
        <div className="rounded-xl border border-[var(--border)] p-3 space-y-2">
          <p className="text-[11px] text-[var(--sub)] leading-relaxed">
            {t.adaptiveTdee.suggestion(
              t.adaptiveTdee.goals[adjustment.goal],
              adjustment.observedWeeklyRatePct ?? 0,
              adjustment.targetWeeklyRatePct
            )}
          </p>
          <div className="flex items-center gap-3">
            <span
              className="metric text-base font-bold"
              style={{ color: adjustment.calorieDelta > 0 ? "var(--chart-1)" : "var(--chart-4)" }}
            >
              {adjustment.calorieDelta > 0 ? "+" : ""}{adjustment.calorieDelta} kcal
            </span>
            <span className="text-[10px] font-mono text-[var(--faint)]">
              {adjustment.current.calories} → {adjustment.next.calories}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
            {([
              ["P", adjustment.current.protein, adjustment.next.protein],
              ["C", adjustment.current.carbs,   adjustment.next.carbs],
              ["F", adjustment.current.fats,    adjustment.next.fats],
            ] as const).map(([label, from, to]) => (
              <div key={label} className="rounded-lg bg-[var(--accent-faint)] px-2 py-1.5 text-center">
                <span className="text-[var(--faint)]">{label}</span>{" "}
                <span className={cn("metric", from !== to && "text-[var(--accent)] font-bold")}>
                  {from !== to ? `${from}→${to}` : `${to}`}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={applyAdjustment}
            disabled={applied}
            className="btn-aqua w-full py-2 text-xs font-bold disabled:opacity-60"
          >
            {applied ? t.adaptiveTdee.applied : t.adaptiveTdee.applyBtn}
          </button>
        </div>
      )}

      {adjustment?.status === "insufficientData" && (
        <p className="text-[11px] text-[var(--faint)] leading-relaxed">{t.adaptiveTdee.holdSteady}</p>
      )}

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-[10px] font-mono uppercase tracking-wide text-[var(--faint)] hover:text-[var(--muted)] transition-colors pt-1"
      >
        <span>{t.adaptiveTdee.howItWorks}</span>
        <span>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="space-y-1.5 text-[10px] font-mono text-[var(--faint)] leading-relaxed animate-slide-up">
          <p>{t.adaptiveTdee.method}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span>{t.adaptiveTdee.meanIntake}</span>
            <span className="metric text-right text-[var(--sub)]">{result.meanIntake} kcal</span>
            <span>{t.adaptiveTdee.windowLabel}</span>
            <span className="metric text-right text-[var(--sub)]">{result.spanDays + 1} d</span>
            <span>{t.adaptiveTdee.weighIns}</span>
            <span className="metric text-right text-[var(--sub)]">{result.weightPointsUsed}</span>
            <span>{t.adaptiveTdee.loggedDays}</span>
            <span className="metric text-right text-[var(--sub)]">
              {result.intakeDaysUsed} ({Math.round(result.intakeCoverage * 100)}%)
            </span>
            <span>{t.adaptiveTdee.energyBalance}</span>
            <span className="metric text-right text-[var(--sub)]">
              {result.energyBalance != null && result.energyBalance > 0 ? "+" : ""}
              {result.energyBalance} kcal
            </span>
            <span>{t.adaptiveTdee.fitQuality}</span>
            <span className="metric text-right text-[var(--sub)]">
              {result.fitQuality != null ? `${Math.round(result.fitQuality * 100)}%` : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
