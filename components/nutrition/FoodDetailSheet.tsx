"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/context/LanguageContext";
import { useNav } from "@/lib/context/NavContext";
import { cn } from "@/lib/utils";
import { scaleByWeight, scaleDetail } from "@/lib/nutrition";
import { foodEmoji } from "@/lib/foodIcons";
import { MacroSummary, NutritionFactsDetails, hasExtendedDetail } from "./NutritionFacts";
import type { FoodDetail } from "@/types";

/** Normalized food the detail sheet renders — always per-100g basis. */
export interface DetailFood {
  key: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  cal100: number;
  protein100: number;
  carbs100: number;
  fats100: number;
  detail?: FoodDetail | null; // per-100g
  defaultWeightG: number;
}

interface Props {
  open: boolean;
  food: DetailFood | null;
  mealLabel: string;
  isFavorite: boolean;
  saving?: boolean;
  onAdd: (portionG: number) => void;
  onToggleFavorite: () => void;
  onClose: () => void;
  /** Optional meal-slot picker rendered above the CTA (when the food isn't tied
   *  to a preset meal, e.g. opened from the /nutrition favorites section). */
  mealSelector?: React.ReactNode;
}

export default function FoodDetailSheet({
  open,
  food,
  mealLabel,
  isFavorite,
  saving,
  onAdd,
  onToggleFavorite,
  onClose,
  mealSelector,
}: Props) {
  const t = useT();
  const { setNavHidden } = useNav();

  const [unit, setUnit] = useState<"g" | "serving">("g");
  const [amount, setAmount] = useState("100");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const servingGrams = food?.detail?.servingGrams ?? null;

  // Hide the bottom nav while the sheet is open.
  useEffect(() => {
    if (open) setNavHidden(true);
    return () => setNavHidden(false);
  }, [open, setNavHidden]);

  // Reset the amount/unit whenever a new food opens.
  useEffect(() => {
    if (!open || !food) return;
    setDetailsOpen(false);
    if (servingGrams && servingGrams > 0) {
      setUnit("serving");
      setAmount("1");
    } else {
      setUnit("g");
      setAmount(String(food.defaultWeightG || 100));
    }
  }, [open, food, servingGrams]);

  const amountNum = parseFloat(amount) || 0;
  const portionG = unit === "serving" && servingGrams ? amountNum * servingGrams : amountNum;
  const ratio = portionG / 100;

  const scaled = useMemo(() => {
    if (!food) return null;
    return {
      calories: Math.round(food.cal100 * ratio),
      protein: scaleByWeight(100, portionG, food.protein100),
      carbs: scaleByWeight(100, portionG, food.carbs100),
      fats: scaleByWeight(100, portionG, food.fats100),
      detail: scaleDetail(food.detail, ratio),
    };
  }, [food, portionG, ratio]);

  if (!open || !food || !scaled) return null;

  const showDetails = hasExtendedDetail(scaled.detail);

  const portionLabel =
    unit === "serving" && servingGrams
      ? `${amountNum} × ${food.detail?.servingSize || `${servingGrams} g`} (${Math.round(portionG)} g)`
      : `${Math.round(portionG)} g`;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center transition-opacity duration-300">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="glass-sheet absolute bottom-0 left-0 right-0 max-w-xl mx-auto rounded-t-[28px] border-t border-[var(--border)] max-h-[92vh] overflow-y-auto flex flex-col transition-transform duration-300 translate-y-0">
        {/* Pull handle */}
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div className="w-12 h-1 rounded-full bg-[var(--border)]" />
        </div>

        {/* Header controls */}
        <div className="flex items-center justify-between px-4">
          <span className="section-label">{t.nutritionTracker.detailHeader}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleFavorite}
              title={isFavorite ? t.nutritionTracker.removeFavorite : t.nutritionTracker.saveAsFavorite}
              className={cn(
                "w-9 h-9 rounded-full border flex items-center justify-center text-base transition-all active:scale-90",
                isFavorite
                  ? "border-[rgba(var(--accent-rgb),0.5)] bg-[rgba(var(--accent-rgb),0.12)]"
                  : "border-[var(--border)] hover:border-[var(--muted)]"
              )}
            >
              <span className={isFavorite ? "text-[var(--accent)]" : "text-[var(--muted)]"}>
                {isFavorite ? "♥" : "♡"}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full border border-[var(--border)] hover:border-[var(--muted)] flex items-center justify-center text-[var(--muted)] text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Identity */}
        <div className="px-5 pt-2 pb-4 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-[rgba(var(--accent-rgb),0.08)] border border-[var(--border)] flex items-center justify-center text-3xl mb-3">
            {foodEmoji(food.category, food.name)}
          </div>
          <h2 className="text-lg font-bold text-[var(--text)] leading-tight">{food.name}</h2>
          {food.brand && (
            <p className="text-sm text-[var(--muted)] mt-0.5">{food.brand}</p>
          )}
          <p className="text-[11px] text-[var(--faint)] font-mono uppercase tracking-wide mt-2">
            {t.nutritionTracker.dataPer(portionLabel)}
          </p>
        </div>

        {/* Macro tiles + segmented % bar */}
        <div className="px-4">
          <MacroSummary
            calories={scaled.calories}
            protein={scaled.protein}
            carbs={scaled.carbs}
            fats={scaled.fats}
          />
        </div>

        {/* Discreet nutrition details */}
        {showDetails && (
          <div className="px-4 mt-4">
            <div className="card border border-[var(--border)] overflow-hidden">
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3"
              >
                <span className="text-sm font-semibold text-[var(--text)]">{t.nutritionTracker.nutritionDetails}</span>
                <span className="text-[var(--faint)] text-xs">{detailsOpen ? "▲" : "▼"}</span>
              </button>

              {detailsOpen && (
                <div className="px-4 pb-4 pt-1 animate-slide-up">
                  <NutritionFactsDetails detail={scaled.detail} carbs={scaled.carbs} fats={scaled.fats} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quantity + portion */}
        <div className="px-4 mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-[var(--faint)] font-mono uppercase tracking-wide">{t.nutritionTracker.quantity}</label>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-base mt-1 metric text-center"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--faint)] font-mono uppercase tracking-wide">{t.nutritionTracker.portion}</label>
            {servingGrams ? (
              <div className="flex border border-[var(--border)] rounded-xl overflow-hidden mt-1">
                {(["serving", "g"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => {
                      if (u === unit) return;
                      // Convert the current amount so the portion in grams is preserved.
                      if (u === "g") setAmount(String(Math.round(portionG)));
                      else setAmount(String(Math.round((portionG / servingGrams) * 100) / 100));
                      setUnit(u);
                    }}
                    className={cn(
                      "flex-1 py-2.5 text-xs font-semibold transition-all",
                      unit === u
                        ? "bg-[var(--accent)] text-[#041a1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                        : "text-[var(--sub)] hover:text-[var(--muted)]"
                    )}
                  >
                    {u === "serving" ? t.nutritionTracker.servingUnit : "g"}
                  </button>
                ))}
              </div>
            ) : (
              <div className="input-base mt-1 flex items-center justify-center text-sm text-[var(--muted)]">g</div>
            )}
          </div>
        </div>

        {/* Optional meal-slot picker (page-level favorites use) */}
        {mealSelector && <div className="px-4 mt-4">{mealSelector}</div>}

        {/* Add CTA */}
        <div className="px-4 py-5 mt-2">
          <button
            type="button"
            disabled={saving || portionG <= 0}
            onClick={() => onAdd(portionG)}
            className="btn-aqua w-full py-3.5 text-sm font-bold"
          >
            {saving ? "…" : t.nutritionTracker.addToMeal(mealLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}
