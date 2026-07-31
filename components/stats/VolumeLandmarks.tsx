"use client";

import { useMemo } from "react";
import { useT } from "@/lib/context/LanguageContext";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";
import {
  buildVolumePlan,
  MEV,
  MAV_TOP,
  MRV,
  SCALE_MAX,
  type VolumeRecommendation,
} from "@/lib/analytics/volume";
import type { VolumeFeedback } from "@/types";

interface Props {
  /** Sets per muscle group logged this week (from the stats page). */
  weeklyMuscles: Record<string, number>;
  /** Pump/soreness ratings from recent sessions (IndexedDB, device-local). */
  feedback?: VolumeFeedback[];
  isOffline?: boolean;
}

export default function VolumeLandmarks({ weeklyMuscles, feedback = [], isOffline }: Props) {
  const t = useT();

  const plan = useMemo(
    () => buildVolumePlan({ weeklyMuscles, feedback }),
    [weeklyMuscles, feedback]
  );

  if (plan.length === 0) {
    return isOffline
      ? <OfflinePlaceholder className="py-2" />
      : <p className="text-[13px] text-[var(--faint)] text-center py-4">{t.volumeLandmarks.noData}</p>;
  }

  function zoneStyle(rec: VolumeRecommendation): { label: string; color: string } {
    if (rec.zone === "belowMev") return { label: t.volumeLandmarks.below,  color: "var(--chart-4)" };
    if (rec.zone === "aboveMrv") return { label: t.volumeLandmarks.high,   color: "var(--chart-5)" };
    return                              { label: t.volumeLandmarks.growth, color: "var(--accent)" };
  }

  /** The auto-regulated call, phrased as an instruction rather than a number. */
  function advice(rec: VolumeRecommendation): { text: string; color: string } | null {
    if (rec.action === "deload") {
      return { text: t.volumeLandmarks.deload(rec.recommendedSets), color: "var(--chart-5)" };
    }
    if (rec.delta > 0) {
      return { text: t.volumeLandmarks.addSets(rec.delta, rec.recommendedSets), color: "var(--accent)" };
    }
    if (rec.delta < 0) {
      return { text: t.volumeLandmarks.cutSets(-rec.delta, rec.recommendedSets), color: "var(--chart-4)" };
    }
    return rec.feedback ? { text: t.volumeLandmarks.holdSets(rec.recommendedSets), color: "var(--sub)" } : null;
  }

  const anyFeedback = plan.some(rec => rec.feedback != null);

  return (
    <div className="space-y-3">
      {plan.map(rec => {
        const z = zoneStyle(rec);
        const tip = advice(rec);
        const pct = Math.min(100, (rec.currentSets / SCALE_MAX) * 100);
        const targetPct = Math.min(100, (rec.recommendedSets / SCALE_MAX) * 100);

        return (
          <div key={rec.muscle}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[11px] font-medium text-[var(--text)]">
                {t.muscleGroups[rec.muscle] ?? rec.muscle}
              </span>
              <span className="metric text-[11px]" style={{ color: z.color }}>
                {rec.currentSets} {t.volumeLandmarks.setsWk} · {z.label}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-[var(--border)] overflow-hidden">
              {/* MEV→MRV growth band */}
              <div
                className="absolute inset-y-0 opacity-25"
                style={{
                  left:  `${(MEV / SCALE_MAX) * 100}%`,
                  width: `${((MRV - MEV) / SCALE_MAX) * 100}%`,
                  background: "var(--accent)",
                }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: z.color, opacity: 0.85 }}
              />
              {/* MEV / MAV-top / MRV tick marks */}
              {[MEV, MAV_TOP, MRV].map(mark => (
                <div
                  key={mark}
                  className="absolute inset-y-0 w-px bg-[var(--bg)]"
                  style={{ left: `${(mark / SCALE_MAX) * 100}%` }}
                />
              ))}
              {/* Next microcycle's target — a marker, not a fill, so it reads as
                  a destination rather than as volume already done. */}
              {rec.delta !== 0 && (
                <div
                  className="absolute inset-y-0 w-[2px] rounded-full transition-all duration-500"
                  style={{ left: `calc(${targetPct}% - 1px)`, background: tip?.color ?? "var(--accent)" }}
                />
              )}
            </div>
            {tip && (
              <p className="text-[10px] font-mono mt-1 leading-none" style={{ color: tip.color }}>
                › {tip.text}
              </p>
            )}
          </div>
        );
      })}

      <p className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider pt-1 leading-relaxed">
        {t.volumeLandmarks.legend}
        {!anyFeedback && (
          <>
            <br />
            {t.volumeLandmarks.noFeedbackHint}
          </>
        )}
      </p>
    </div>
  );
}
