"use client";

import { useT } from "@/lib/context/LanguageContext";
import { cn } from "@/lib/utils";
import type { PumpRating, SorenessRating } from "@/types";

export interface MuscleFeedbackDraft {
  pump: PumpRating | null;
  soreness: SorenessRating | null;
}

export interface FeedbackTarget {
  muscle: string;
  sets: number;
}

interface Props {
  targets: FeedbackTarget[];
  value: Record<string, MuscleFeedbackDraft>;
  onChange: (muscle: string, patch: Partial<MuscleFeedbackDraft>) => void;
}

const RATINGS = [0, 1, 2] as const;

/** Two 3-way questions per muscle group trained, asked once at the end of a
 *  session. Optional by design — an unanswered group is simply not stored, and
 *  the recommender falls back to the landmarks alone. Blocking the save on it
 *  would trade a workout for a survey. */
export default function VolumeFeedbackPanel({ targets, value, onChange }: Props) {
  const t = useT();
  if (targets.length === 0) return null;

  return (
    <div className="w-full text-left space-y-3">
      <div>
        <p className="section-label !mb-1">{t.volumeFeedback.title}</p>
        <p className="text-[11px] text-[var(--faint)] leading-relaxed">{t.volumeFeedback.subtitle}</p>
      </div>

      {targets.map(({ muscle, sets }) => {
        const draft = value[muscle] ?? { pump: null, soreness: null };
        return (
          <div key={muscle} className="card-glass p-3 space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="sector-readout text-[10px] font-mono tracking-widest uppercase">
                {t.muscleGroups[muscle] ?? muscle}
              </span>
              <span className="metric text-[10px] text-[var(--faint)]">
                {t.volumeFeedback.setsThisSession(sets)}
              </span>
            </div>

            {([
              { field: "pump" as const, label: t.volumeFeedback.pumpLabel, options: t.volumeFeedback.pumpOptions },
              { field: "soreness" as const, label: t.volumeFeedback.sorenessLabel, options: t.volumeFeedback.sorenessOptions },
            ]).map(({ field, label, options }) => (
              <div key={field}>
                <p className="text-[10px] text-[var(--faint)] uppercase tracking-wider mb-1">{label}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {RATINGS.map(rating => {
                    const selected = draft[field] === rating;
                    return (
                      <button
                        key={rating}
                        type="button"
                        onClick={() => onChange(muscle, { [field]: selected ? null : rating })}
                        aria-pressed={selected}
                        className={cn(
                          "py-2 px-1 rounded-xl border text-[11px] font-medium leading-tight transition-all active:scale-[0.97]",
                          selected
                            ? "border-[var(--accent)] bg-[var(--accent-faint)] text-[var(--accent)]"
                            : "border-[var(--border)] text-[var(--sub)] hover:border-[var(--muted)]"
                        )}
                      >
                        {options[rating]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
