"use client";

import { useT } from "@/lib/context/LanguageContext";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";

interface Exercise { name: string; sets: number; sessions: number; }

export default function TopExercises({ exercises, isOffline }: { exercises: Exercise[]; isOffline?: boolean }) {
  const t = useT();
  if (!exercises.length) {
    if (isOffline) return <OfflinePlaceholder />;
    return (
      <p className="text-[13px] text-[var(--faint)] text-center py-6">
        {t.topExercises.noExercises}
      </p>
    );
  }

  const max = exercises[0]?.sets ?? 1;

  return (
    <div className="space-y-3.5">
      {exercises.map((ex, i) => (
        <div key={ex.name}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="sector-readout shrink-0 w-6 justify-center px-0 py-0 text-[9px]">
                {i + 1}
              </span>
              <span className="text-[13px] font-medium text-[var(--text)] truncate">{ex.name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <span className="text-[10px] font-mono text-[var(--faint)]">{ex.sessions}d</span>
              <span className="metric text-[12px] font-semibold text-[var(--accent)]">
                {t.topExercises.sets(ex.sets)}
              </span>
            </div>
          </div>
          <div className="ml-8 h-1 rounded-full overflow-hidden bg-[var(--surface)]">
            <div
              className="h-full rounded-full"
              style={{
                width:      `${(ex.sets / max) * 100}%`,
                background: `linear-gradient(90deg, rgba(34,211,238,0.6), rgba(34,211,238,${0.5 + (ex.sets / max) * 0.5}))`,
                transition: "width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
