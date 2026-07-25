"use client";

import { useEffect, useMemo, useState } from "react";
import { useT, useLanguage } from "@/lib/context/LanguageContext";
import { useNav } from "@/lib/context/NavContext";
import { cn } from "@/lib/utils";
import { macroCaloriePercents, scaleByWeight, scaleDetail } from "@/lib/nutrition";
import { foodEmoji } from "@/lib/foodIcons";
import {
  MICRO_KEYS,
  NUTRIENT_LABELS,
  formatNutrientAmount,
  percentDV,
} from "@/lib/dailyValues";
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
}

const NUTRI_COLORS: Record<string, string> = {
  // Official Nutri-Score scale (external standard — not app theme chrome).
  a: "#158a4f",
  b: "#85bb2f",
  c: "#f5b800",
  d: "#f18b2c",
  e: "#e63e11",
};

export default function FoodDetailSheet({
  open,
  food,
  mealLabel,
  isFavorite,
  saving,
  onAdd,
  onToggleFavorite,
  onClose,
}: Props) {
  const t = useT();
  const { language } = useLanguage();
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

  const pct = macroCaloriePercents(scaled.protein, scaled.carbs, scaled.fats);
  const d = scaled.detail;
  const microEntries = d?.micros
    ? MICRO_KEYS.filter((k) => d.micros![k] != null && d.micros![k]! > 0)
    : [];
  const hasExtended =
    !!d &&
    (d.sugars_g != null ||
      d.fiber_g != null ||
      d.satFat_g != null ||
      d.sodium_g != null ||
      microEntries.length > 0 ||
      !!d.nutriScore ||
      !!d.novaGroup);

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

        {/* Macro tiles */}
        <div className="px-4 grid grid-cols-4 gap-2">
          <MacroTile label={t.nutritionTracker.calories} value={String(scaled.calories)} sub="kcal" color="var(--text)" />
          <MacroTile label={t.nutritionTracker.protein} value={scaled.protein.toFixed(1)} sub="g" color="var(--accent)" />
          <MacroTile label={t.nutritionTracker.carbs} value={scaled.carbs.toFixed(1)} sub="g" color="rgb(var(--emerald-rgb))" />
          <MacroTile label={t.nutritionTracker.fats} value={scaled.fats.toFixed(1)} sub="g" color="rgb(var(--violet-rgb))" />
        </div>

        {/* Segmented macro-% bar */}
        {pct.protein + pct.carbs + pct.fats > 0 && (
          <div className="px-4 mt-4">
            <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-[var(--border)]">
              <div style={{ width: `${pct.protein}%`, background: "var(--accent)" }} />
              <div style={{ width: `${pct.carbs}%`, background: "rgb(var(--emerald-rgb))" }} />
              <div style={{ width: `${pct.fats}%`, background: "rgb(var(--violet-rgb))" }} />
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-[var(--muted)]">
              <Legend color="var(--accent)" label={`${t.nutritionTracker.protein} ${pct.protein}%`} />
              <Legend color="rgb(var(--emerald-rgb))" label={`${t.nutritionTracker.carbs} ${pct.carbs}%`} />
              <Legend color="rgb(var(--violet-rgb))" label={`${t.nutritionTracker.fats} ${pct.fats}%`} />
            </div>
          </div>
        )}

        {/* Discreet nutrition details */}
        {hasExtended && (
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
                <div className="px-4 pb-4 pt-1 space-y-3 animate-slide-up">
                  {/* Extended macro breakdown */}
                  <div className="space-y-1.5">
                    <FactRow label={t.nutritionTracker.carbs} value={`${scaled.carbs.toFixed(1)} g`} bold />
                    {d?.sugars_g != null && <FactRow label={t.nutritionTracker.sugars} value={`${d.sugars_g.toFixed(1)} g`} indent dv={percentDV("sugars", d.sugars_g)} />}
                    {d?.fiber_g != null && <FactRow label={t.nutritionTracker.fiber} value={`${d.fiber_g.toFixed(1)} g`} indent dv={percentDV("fiber", d.fiber_g)} />}
                    <FactRow label={t.nutritionTracker.fats} value={`${scaled.fats.toFixed(1)} g`} bold />
                    {d?.satFat_g != null && <FactRow label={t.nutritionTracker.saturatedFat} value={`${d.satFat_g.toFixed(1)} g`} indent dv={percentDV("satFat", d.satFat_g)} />}
                    {d?.sodium_g != null && (
                      <FactRow
                        label={t.nutritionTracker.sodium}
                        value={fmt(d.sodium_g)}
                        dv={percentDV("sodium", d.sodium_g)}
                      />
                    )}
                  </div>

                  {/* Vitamins & minerals with %DV */}
                  {microEntries.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                      <p className="section-label">{t.nutritionTracker.vitaminsMinerals}</p>
                      {microEntries.map((key) => {
                        const grams = d!.micros![key]!;
                        const dv = percentDV(key, grams);
                        return (
                          <div key={key} className="flex items-center gap-3">
                            <span className="text-xs text-[var(--sub)] w-24 shrink-0">
                              {NUTRIENT_LABELS[key]?.[language] ?? key}
                            </span>
                            <span className="text-xs metric text-[var(--text)] w-16 shrink-0">{fmt(grams)}</span>
                            <div className="h-1.5 flex-1 bg-[var(--border)] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[var(--accent)]"
                                style={{ width: `${Math.min(100, dv ?? 0)}%` }}
                              />
                            </div>
                            <span className="text-[10px] metric text-[var(--muted)] w-10 text-right shrink-0">
                              {dv != null ? `${dv}%` : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Quality signals */}
                  {(d?.nutriScore || d?.novaGroup) && (
                    <div className="flex items-center gap-3 pt-2 border-t border-[var(--border)]">
                      {d?.nutriScore && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[var(--faint)] font-mono uppercase">{t.nutritionTracker.nutriScore}</span>
                          <span
                            className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-white"
                            style={{ background: NUTRI_COLORS[d.nutriScore] }}
                          >
                            {d.nutriScore.toUpperCase()}
                          </span>
                        </div>
                      )}
                      {d?.novaGroup && (
                        <div className="flex items-center gap-1.5">
                          <span className="sector-readout">{t.nutritionTracker.nova} {d.novaGroup}</span>
                          <span className="text-[10px] text-[var(--muted)]">{t.nutritionTracker.novaDesc(d.novaGroup)}</span>
                        </div>
                      )}
                    </div>
                  )}
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

/** grams → friendly "12 mg" / "0.5 g" / "3 µg" string. */
function fmt(grams: number): string {
  const { value, unit } = formatNutrientAmount(grams);
  return `${value} ${unit}`;
}

function MacroTile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="p-2.5 bg-[#080808]/40 border border-[var(--border)] rounded-xl flex flex-col items-center justify-center text-center">
      <span className="text-base font-bold metric leading-none" style={{ color }}>{value}</span>
      <span className="text-[9px] text-[var(--muted)] mt-0.5">{sub}</span>
      <span className="text-[9px] text-[var(--faint)] uppercase font-mono mt-1 leading-none">{label}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function FactRow({ label, value, indent, bold, dv }: { label: string; value: string; indent?: boolean; bold?: boolean; dv?: number | null }) {
  return (
    <div className={cn("flex items-center justify-between text-xs", indent && "pl-4")}>
      <span className={cn(bold ? "text-[var(--text)] font-medium" : "text-[var(--sub)]")}>{label}</span>
      <span className="flex items-center gap-2">
        <span className="metric text-[var(--text)]">{value}</span>
        {dv != null && <span className="text-[10px] metric text-[var(--muted)] w-10 text-right">{dv}%</span>}
      </span>
    </div>
  );
}
