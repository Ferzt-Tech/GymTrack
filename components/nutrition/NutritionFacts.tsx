"use client";

import { useLanguage, useT } from "@/lib/context/LanguageContext";
import { cn } from "@/lib/utils";
import { macroCaloriePercents } from "@/lib/nutrition";
import { MICRO_KEYS, NUTRIENT_LABELS, formatNutrientAmount, percentDV } from "@/lib/dailyValues";
import type { FoodDetail } from "@/types";

/* Shared, presentational nutrition-facts rendering used by both FoodDetailSheet
 * (portion-scaled, inside a disclosure) and FavoritesView (per-100g, inline). */

const NUTRI_COLORS: Record<string, string> = {
  // Official Nutri-Score scale (external standard — not app theme chrome).
  a: "#158a4f",
  b: "#85bb2f",
  c: "#f5b800",
  d: "#f18b2c",
  e: "#e63e11",
};

/** grams → friendly "12 mg" / "0.5 g" / "3 µg" string. */
export function fmtNutrient(grams: number): string {
  const { value, unit } = formatNutrientAmount(grams);
  return `${value} ${unit}`;
}

/** Whether a detail carries anything beyond the 4 macros (drives disclosure visibility). */
export function hasExtendedDetail(detail?: FoodDetail | null): boolean {
  if (!detail) return false;
  const micro = detail.micros ? MICRO_KEYS.some((k) => (detail.micros![k] ?? 0) > 0) : false;
  return (
    detail.sugars_g != null ||
    detail.fiber_g != null ||
    detail.satFat_g != null ||
    detail.sodium_g != null ||
    micro ||
    !!detail.nutriScore ||
    !!detail.novaGroup
  );
}

/** 4 macro tiles + the segmented Protein/Carbs/Fat calorie-% bar. */
export function MacroSummary({ calories, protein, carbs, fats }: {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}) {
  const t = useT();
  const pct = macroCaloriePercents(protein, carbs, fats);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        <MacroTile label={t.nutritionTracker.calories} value={String(Math.round(calories))} sub="kcal" color="var(--text)" />
        <MacroTile label={t.nutritionTracker.protein} value={protein.toFixed(1)} sub="g" color="var(--accent)" />
        <MacroTile label={t.nutritionTracker.carbs} value={carbs.toFixed(1)} sub="g" color="rgb(var(--emerald-rgb))" />
        <MacroTile label={t.nutritionTracker.fats} value={fats.toFixed(1)} sub="g" color="rgb(var(--violet-rgb))" />
      </div>
      {pct.protein + pct.carbs + pct.fats > 0 && (
        <div>
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
    </div>
  );
}

/** Extended breakdown (sugar/fiber/sat-fat/sodium) + vitamins/minerals %DV grid +
 *  Nutri-Score/NOVA. Renders null when there's no extended data. `carbs`/`fats`
 *  are the macro totals at the same basis as `detail`, used for the header rows. */
export function NutritionFactsDetails({ detail, carbs, fats }: {
  detail?: FoodDetail | null;
  carbs: number;
  fats: number;
}) {
  const t = useT();
  const { language } = useLanguage();
  if (!hasExtendedDetail(detail)) return null;
  const d = detail!;
  const microEntries = d.micros ? MICRO_KEYS.filter((k) => d.micros![k] != null && d.micros![k]! > 0) : [];

  return (
    <div className="space-y-3">
      {/* Extended macro breakdown */}
      <div className="space-y-1.5">
        <FactRow label={t.nutritionTracker.carbs} value={`${carbs.toFixed(1)} g`} bold />
        {d.sugars_g != null && <FactRow label={t.nutritionTracker.sugars} value={`${d.sugars_g.toFixed(1)} g`} indent dv={percentDV("sugars", d.sugars_g)} />}
        {d.fiber_g != null && <FactRow label={t.nutritionTracker.fiber} value={`${d.fiber_g.toFixed(1)} g`} indent dv={percentDV("fiber", d.fiber_g)} />}
        <FactRow label={t.nutritionTracker.fats} value={`${fats.toFixed(1)} g`} bold />
        {d.satFat_g != null && <FactRow label={t.nutritionTracker.saturatedFat} value={`${d.satFat_g.toFixed(1)} g`} indent dv={percentDV("satFat", d.satFat_g)} />}
        {d.sodium_g != null && <FactRow label={t.nutritionTracker.sodium} value={fmtNutrient(d.sodium_g)} dv={percentDV("sodium", d.sodium_g)} />}
      </div>

      {/* Vitamins & minerals with %DV */}
      {microEntries.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <p className="section-label">{t.nutritionTracker.vitaminsMinerals}</p>
          {microEntries.map((key) => {
            const grams = d.micros![key]!;
            const dv = percentDV(key, grams);
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs text-[var(--sub)] w-24 shrink-0">{NUTRIENT_LABELS[key]?.[language] ?? key}</span>
                <span className="text-xs metric text-[var(--text)] w-16 shrink-0">{fmtNutrient(grams)}</span>
                <div className="h-1.5 flex-1 bg-[var(--border)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, dv ?? 0)}%` }} />
                </div>
                <span className="text-[10px] metric text-[var(--muted)] w-10 text-right shrink-0">{dv != null ? `${dv}%` : "—"}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Quality signals */}
      {(d.nutriScore || d.novaGroup) && (
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border)]">
          {d.nutriScore && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[var(--faint)] font-mono uppercase">{t.nutritionTracker.nutriScore}</span>
              <span className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-white" style={{ background: NUTRI_COLORS[d.nutriScore] }}>
                {d.nutriScore.toUpperCase()}
              </span>
            </div>
          )}
          {d.novaGroup && (
            <div className="flex items-center gap-1.5">
              <span className="sector-readout">{t.nutritionTracker.nova} {d.novaGroup}</span>
              <span className="text-[10px] text-[var(--muted)]">{t.nutritionTracker.novaDesc(d.novaGroup)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
