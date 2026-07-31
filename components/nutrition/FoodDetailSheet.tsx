"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/context/LanguageContext";
import { useNav } from "@/lib/context/NavContext";
import { cn } from "@/lib/utils";
import { scaleByWeight, scaleDetail } from "@/lib/nutrition";
import { MacroSummary, NutritionFactsDetails, hasExtendedDetail } from "./NutritionFacts";
import type { DetailFood } from "@/types";

export type { DetailFood };

/** Portion units the quantity field can be expressed in. "package" is the whole
 *  net content of the product (a 473 g can), so single-unit foods can be logged
 *  and favorited as the thing people actually consume. */
type PortionUnit = "g" | "serving" | "package";

interface Props {
  open: boolean;
  food: DetailFood | null;
  mealLabel: string;
  isFavorite: boolean;
  saving?: boolean;
  onAdd: (portionG: number) => void;
  /** Favoriting is WYSIWYG: the portion currently shown becomes the saved
   *  food's basis, so "the whole 473 g can with these macros" is one tap. */
  onToggleFavorite: (basisGrams: number) => void;
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

  const [unit, setUnit] = useState<PortionUnit>("g");
  const [amount, setAmount] = useState("100");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const servingGrams = food?.detail?.servingGrams ?? null;
  const rawPackageGrams = food?.detail?.packageGrams ?? null;
  const preferredPortionG = food?.preferredPortionG ?? null;

  // Single-serve products (a 473 ml can) list their serving size *as* the whole
  // package, so offering both units would be two identical buttons. Keep the
  // package unit only when it genuinely differs from one serving.
  const packageGrams =
    rawPackageGrams && (!servingGrams || Math.abs(rawPackageGrams - servingGrams) >= 0.5)
      ? rawPackageGrams
      : null;

  /** Grams in one unit of the selected basis (1 for plain grams). */
  const unitGrams =
    unit === "serving" && servingGrams ? servingGrams : unit === "package" && packageGrams ? packageGrams : 1;

  // Hide the bottom nav while the sheet is open.
  useEffect(() => {
    if (open) setNavHidden(true);
    return () => setNavHidden(false);
  }, [open, setNavHidden]);

  // Reset the amount/unit whenever a new food opens. A deliberate portion (a
  // favorite's saved basis, or the weight a recent log used) wins over the
  // package serving size — reopening a favorite must show the food exactly as it
  // was saved. Only then do we fall back to "1 serving", then to plain grams.
  useEffect(() => {
    if (!open || !food) return;
    setDetailsOpen(false);
    if (preferredPortionG && preferredPortionG > 0) {
      // Re-express the saved basis in the nicest unit that matches it exactly, so
      // a whole-package favorite reads "1 package", not "473 g".
      if (packageGrams && Math.abs(preferredPortionG - packageGrams) < 0.5) {
        setUnit("package");
        setAmount("1");
      } else if (servingGrams && Math.abs(preferredPortionG - servingGrams) < 0.5) {
        setUnit("serving");
        setAmount("1");
      } else {
        setUnit("g");
        setAmount(String(preferredPortionG));
      }
    } else if (servingGrams && servingGrams > 0) {
      setUnit("serving");
      setAmount("1");
    } else {
      setUnit("g");
      setAmount(String(food.defaultWeightG || 100));
    }
  }, [open, food, servingGrams, packageGrams, preferredPortionG]);

  const amountNum = parseFloat(amount) || 0;
  const portionG = amountNum * unitGrams;
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

  // Units offered by this food, most specific first; plain grams is always last.
  const units: PortionUnit[] = [
    ...(servingGrams ? (["serving"] as const) : []),
    ...(packageGrams ? (["package"] as const) : []),
    "g",
  ];

  const portionLabel =
    unit === "serving" && servingGrams
      ? `${amountNum} × ${food.detail?.servingSize || `${servingGrams} g`} (${Math.round(portionG)} g)`
      : unit === "package" && packageGrams
        ? `${amountNum} × ${food.detail?.packageLabel || `${packageGrams} g`} (${Math.round(portionG)} g)`
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
              onClick={() => onToggleFavorite(portionG)}
              disabled={!isFavorite && portionG <= 0}
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
        <div className="px-5 pt-3 pb-4 flex flex-col items-center text-center">
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
            {units.length > 1 ? (
              <div className="flex border border-[var(--border)] rounded-xl overflow-hidden mt-1">
                {units.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => {
                      if (u === unit) return;
                      // Switching to "package" means one package, not a rescale of
                      // the previous amount — nobody wants 0.53 of a can. Between
                      // grams and servings, keep the portion in grams intact.
                      if (u === "package") setAmount("1");
                      else if (u === "g") setAmount(String(Math.round(portionG)));
                      else if (servingGrams)
                        setAmount(String(Math.round((portionG / servingGrams) * 100) / 100));
                      setUnit(u);
                    }}
                    className={cn(
                      "flex-1 py-2.5 text-xs font-semibold transition-all",
                      unit === u
                        ? "bg-[var(--accent)] text-[#041a1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                        : "text-[var(--sub)] hover:text-[var(--muted)]"
                    )}
                  >
                    {u === "serving"
                      ? t.nutritionTracker.servingUnit
                      : u === "package"
                        ? t.nutritionTracker.packageUnit
                        : "g"}
                  </button>
                ))}
              </div>
            ) : (
              <div className="input-base mt-1 flex items-center justify-center text-sm text-[var(--muted)]">g</div>
            )}
          </div>
        </div>

        {/* Whole-package shortcut — one tap to the portion the product is sold in,
            which is also the basis ♥ will save. Hidden once it's the active unit. */}
        {packageGrams && unit !== "package" && (
          <div className="px-4 mt-2">
            <button
              type="button"
              onClick={() => { setUnit("package"); setAmount("1"); }}
              className="btn-outline w-full py-2 text-[11px] font-semibold"
            >
              {t.nutritionTracker.useWholePackage(food.detail?.packageLabel || `${packageGrams} g`)}
            </button>
          </div>
        )}

        {/* The ♥ basis is whatever is shown above — say so, since it's the whole
            point of being able to favorite a 473 g can rather than 100 g of it. */}
        {!isFavorite && portionG > 0 && (
          <p className="px-4 mt-3 text-[10px] text-[var(--faint)] leading-relaxed">
            {t.nutritionTracker.favoriteBasisHint(`${Math.round(portionG)} g`)}
          </p>
        )}

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
