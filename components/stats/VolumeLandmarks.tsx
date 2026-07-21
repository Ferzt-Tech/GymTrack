"use client";

import { useT } from "@/lib/context/LanguageContext";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";

interface Props {
  /** Sets per muscle group logged this week (from the stats page). */
  weeklyMuscles: Record<string, number>;
  isOffline?: boolean;
}

/* Renaissance Periodization-style hypertrophy volume landmarks (sets/week) */
const MEV = 10;
const MAV_TOP = 20;
const MRV = 22;
const SCALE_MAX = 26;

export default function VolumeLandmarks({ weeklyMuscles, isOffline }: Props) {
  const t = useT();
  const entries = Object.entries(weeklyMuscles).sort(([, a], [, b]) => b - a);

  if (entries.length === 0) {
    return isOffline
      ? <OfflinePlaceholder className="py-2" />
      : <p className="text-[13px] text-[var(--faint)] text-center py-4">{t.volumeLandmarks.noData}</p>;
  }

  function zone(sets: number): { label: string; color: string } {
    if (sets < MEV)     return { label: t.volumeLandmarks.below,  color: "var(--chart-4)" };
    if (sets <= MRV)    return { label: t.volumeLandmarks.growth, color: "var(--accent)" };
    return               { label: t.volumeLandmarks.high,   color: "var(--chart-5)" };
  }

  return (
    <div className="space-y-3">
      {entries.map(([muscle, sets]) => {
        const z = zone(sets);
        const pct = Math.min(100, (sets / SCALE_MAX) * 100);
        return (
          <div key={muscle}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[11px] font-medium text-[var(--text)]">
                {t.muscleGroups[muscle] ?? muscle}
              </span>
              <span className="metric text-[11px]" style={{ color: z.color }}>
                {sets} {t.volumeLandmarks.setsWk} · {z.label}
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
            </div>
          </div>
        );
      })}
      <p className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider pt-1">
        {t.volumeLandmarks.legend}
      </p>
    </div>
  );
}
