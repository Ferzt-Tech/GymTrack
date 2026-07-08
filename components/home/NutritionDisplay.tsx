"use client";

import { useEffect, useState } from "react";
import { getCached } from "@/lib/offlineQueue";
import { useT } from "@/lib/context/LanguageContext";
import { cn } from "@/lib/utils";

interface NutritionTargets {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  calculatedAt: string;
}

interface Props {
  onOpenCalculator: () => void;
  refetchKey?: number;
}

export default function NutritionDisplay({ onOpenCalculator, refetchKey = 0 }: Props) {
  const t = useT();
  const [targets, setTargets] = useState<NutritionTargets | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTargets() {
      const cached = await getCached<NutritionTargets>("auth:nutrition_targets");
      setTargets(cached);
      setLoading(false);
    }
    loadTargets();
  }, [refetchKey]);

  if (loading) {
    return <div className="skeleton h-24 w-full" />;
  }

  return (
    <div className="animate-spring-up stagger-5">
      {!targets ? (
        /* Empty State */
        <div className="card-glass p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <p className="section-label mb-0">{t.nutrition.title}</p>
            <p className="text-xs text-[var(--muted)]">
              {t.nutrition.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenCalculator}
            className="btn-aqua py-2 px-4 rounded-xl text-xs font-bold shrink-0 text-center"
          >
            {t.nutrition.calculateBtn}
          </button>
        </div>
      ) : (
        /* Display State */
        <div className="card-glass p-4 space-y-3.5">
          {/* Header */}
          <div className="flex justify-between items-center">
            <p className="section-label mb-0">{t.nutrition.title}</p>
            <button
              onClick={onOpenCalculator}
              className="text-[10px] text-[var(--accent)] uppercase tracking-wider font-semibold font-mono hover:opacity-80 transition-opacity"
            >
              ⚙ Edit Targets
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Calorie Dial */}
            <div className="text-center sm:text-left shrink-0">
              <p className="text-[10px] text-[var(--faint)] uppercase tracking-widest font-mono">
                {t.nutrition.caloriesTarget}
              </p>
              <p className="text-3xl font-extrabold tracking-tight text-[var(--text)] mt-1 metric drop-shadow-[0_0_8px_rgba(var(--accent-rgb),0.2)]">
                {targets.calories.toLocaleString()} <span className="text-xs font-semibold tracking-normal text-[var(--muted)]">kcal</span>
              </p>
            </div>

            {/* Separator on Desktop */}
            <div className="hidden sm:block w-px h-10 bg-[var(--border)] self-center" />

            {/* Macro Cards */}
            <div className="grid grid-cols-3 gap-2 flex-1">
              {/* Protein */}
              <div className="p-2 bg-[#080808]/40 border border-[rgba(var(--accent-rgb),0.15)] rounded-xl flex flex-col justify-center">
                <span className="text-[10px] text-[var(--faint)] uppercase font-mono">{t.nutrition.protein}</span>
                <span className="text-sm font-semibold metric text-[var(--accent)] mt-0.5">
                  {targets.protein}g
                </span>
                <div className="h-1 w-full bg-[var(--border)] rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-[var(--accent)]"
                    style={{ width: `${Math.min(100, Math.round((targets.protein * 4 / targets.calories) * 100))}%` }}
                  />
                </div>
              </div>

              {/* Carbs */}
              <div className="p-2 bg-[#080808]/40 border border-[rgba(var(--emerald-rgb),0.15)] rounded-xl flex flex-col justify-center">
                <span className="text-[10px] text-[var(--faint)] uppercase font-mono">{t.nutrition.carbs}</span>
                <span className="text-sm font-semibold metric text-[rgb(var(--emerald-rgb))] mt-0.5">
                  {targets.carbs}g
                </span>
                <div className="h-1 w-full bg-[var(--border)] rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-[rgb(var(--emerald-rgb))]"
                    style={{ width: `${Math.min(100, Math.round((targets.carbs * 4 / targets.calories) * 100))}%` }}
                  />
                </div>
              </div>

              {/* Fats */}
              <div className="p-2 bg-[#080808]/40 border border-[rgba(var(--violet-rgb),0.15)] rounded-xl flex flex-col justify-center">
                <span className="text-[10px] text-[var(--faint)] uppercase font-mono">{t.nutrition.fats}</span>
                <span className="text-sm font-semibold metric text-[rgb(var(--violet-rgb))] mt-0.5">
                  {targets.fats}g
                </span>
                <div className="h-1 w-full bg-[var(--border)] rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-[rgb(var(--violet-rgb))]"
                    style={{ width: `${Math.min(100, Math.round((targets.fats * 9 / targets.calories) * 100))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
