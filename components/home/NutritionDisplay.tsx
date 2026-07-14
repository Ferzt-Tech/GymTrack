"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDb } from "@/lib/db";
import { todayISO } from "@/lib/utils";
import { getCached, getPendingUpsertsForTable, getPendingDeletesForTable, overlayUpserts } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { useT } from "@/lib/context/LanguageContext";

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
  const router = useRouter();
  const [targets, setTargets] = useState<NutritionTargets | null>(null);
  const [loading, setLoading] = useState(true);
  const [eaten, setEaten] = useState({ calories: 0, protein: 0, carbs: 0, fats: 0 });

  useEffect(() => {
    async function loadData() {
      const cached = await getCached<NutritionTargets>("auth:nutrition_targets");
      setTargets(cached);

      const userId = await resolveUserId();
      if (userId) {
        const db = await getDb();
        let localLogs: any[] = [];
        if (db) {
          const allLogs = await db.getAll("food_logs");
          localLogs = allLogs.filter((l: any) => l.logged_date === todayISO() && l.user_id === userId);
        }

        const pendingUpserts = await getPendingUpsertsForTable("food_logs");
        const pendingDeletes = await getPendingDeletesForTable("food_logs");
        const activeDeletes = new Set(pendingDeletes.map((op: any) => op.value));
        const filteredLocal = localLogs.filter(l => !activeDeletes.has(l.id));
        const overlaid = overlayUpserts(filteredLocal as any[], pendingUpserts, "id") as any[];

        const totals = overlaid.reduce(
          (acc, log) => {
            acc.calories += log.calories || 0;
            acc.protein += log.protein_g || 0;
            acc.carbs += log.carbs_g || 0;
            acc.fats += log.fats_g || 0;
            return acc;
          },
          { calories: 0, protein: 0, carbs: 0, fats: 0 }
        );

        setEaten({
          calories: Math.round(totals.calories),
          protein: Math.round(totals.protein * 10) / 10,
          carbs: Math.round(totals.carbs * 10) / 10,
          fats: Math.round(totals.fats * 10) / 10,
        });
      }
      setLoading(false);
    }
    loadData();
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
        <div
          onClick={() => router.push("/nutrition")}
          className="card-glass p-4 space-y-3.5 cursor-pointer hover:border-[rgba(var(--accent-rgb),0.35)] transition-all"
        >
          {/* Header */}
          <div className="flex justify-between items-center">
            <p className="section-label mb-0">{t.nutrition.title}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenCalculator();
              }}
              className="text-[10px] text-[var(--accent)] uppercase tracking-wider font-semibold font-mono hover:opacity-80 transition-opacity"
            >
              ⚙ Edit Targets
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Calorie Dial */}
            <div className="text-center sm:text-left shrink-0">
              <p className="text-[10px] text-[var(--faint)] uppercase tracking-widest font-mono">
                {t.nutritionTracker.eaten} / {t.nutritionTracker.target}
              </p>
              <p className="text-3xl font-extrabold tracking-tight text-[var(--text)] mt-1 metric drop-shadow-[0_0_8px_rgba(var(--accent-rgb),0.2)]">
                {eaten.calories.toLocaleString()} <span className="text-xs font-semibold tracking-normal text-[var(--muted)]">/ {targets.calories.toLocaleString()} kcal</span>
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
                  {eaten.protein} <span className="text-[9px] font-normal text-[var(--muted)]">/ {targets.protein}g</span>
                </span>
                <div className="h-1 w-full bg-[var(--border)] rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-[var(--accent)]"
                    style={{ width: `${Math.min(100, Math.round((eaten.protein / targets.protein) * 100))}%` }}
                  />
                </div>
              </div>

              {/* Carbs */}
              <div className="p-2 bg-[#080808]/40 border border-[rgba(var(--emerald-rgb),0.15)] rounded-xl flex flex-col justify-center">
                <span className="text-[10px] text-[var(--faint)] uppercase font-mono">{t.nutrition.carbs}</span>
                <span className="text-sm font-semibold metric text-[rgb(var(--emerald-rgb))] mt-0.5">
                  {eaten.carbs} <span className="text-[9px] font-normal text-[var(--muted)]">/ {targets.carbs}g</span>
                </span>
                <div className="h-1 w-full bg-[var(--border)] rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-[rgb(var(--emerald-rgb))]"
                    style={{ width: `${Math.min(100, Math.round((eaten.carbs / targets.carbs) * 100))}%` }}
                  />
                </div>
              </div>

              {/* Fats */}
              <div className="p-2 bg-[#080808]/40 border border-[rgba(var(--violet-rgb),0.15)] rounded-xl flex flex-col justify-center">
                <span className="text-[10px] text-[var(--faint)] uppercase font-mono">{t.nutrition.fats}</span>
                <span className="text-sm font-semibold metric text-[rgb(var(--violet-rgb))] mt-0.5">
                  {eaten.fats} <span className="text-[9px] font-normal text-[var(--muted)]">/ {targets.fats}g</span>
                </span>
                <div className="h-1 w-full bg-[var(--border)] rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-[rgb(var(--violet-rgb))]"
                    style={{ width: `${Math.min(100, Math.round((eaten.fats / targets.fats) * 100))}%` }}
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
