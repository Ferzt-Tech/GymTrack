"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/context/LanguageContext";
import { useNav } from "@/lib/context/NavContext";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import { enqueue } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { todayISO, cn } from "@/lib/utils";
import {
  YIELD_PRESETS,
  clampYieldFactor,
  deleteRecipe,
  emptyIngredient,
  ingredientFromSavedFood,
  listRecipes,
  newRecipe,
  portionByCookedGrams,
  saveRecipe,
  summarizeRecipe,
} from "@/lib/recipes";
import { MacroSummary } from "./NutritionFacts";
import type { Recipe, RecipeIngredient, SavedFood } from "@/types";

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealSlot = typeof MEAL_SLOTS[number];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Saved favorites, offered as one-tap ingredients (they already carry
   *  canonical per-100g macros). */
  favorites: SavedFood[];
  defaultMeal: MealSlot;
  /** Fired after a portion is logged, so the diary refetches. */
  onLogged: () => void;
}

function num(value: string, fallback = 0): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Full-screen recipes subpage. Not a route — an in-page overlay, same reason as
 *  FavoritesView: a nested /nutrition/recipes route breaks the strict
 *  `path === href` nav pill and the `basePath === "/nutrition"` header, and
 *  hardware back is blocked while navHidden, so it ships its own back control. */
export default function RecipeManager({ open, onClose, favorites, defaultMeal, onLogged }: Props) {
  const t = useT();
  const { setNavHidden } = useNav();
  const { isOnline, triggerSync } = useOnlineSync();

  const [userId, setUserId] = useState("");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFavPicker, setShowFavPicker] = useState(false);

  // Portion logging state (per open recipe)
  const [portionG, setPortionG] = useState("");
  const [meal, setMeal] = useState<MealSlot>(defaultMeal);
  const [logging, setLogging] = useState(false);

  const reload = useCallback(async () => {
    const uid = await resolveUserId();
    if (!uid) { setLoading(false); return; }
    setUserId(uid);
    setRecipes(await listRecipes(uid));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) {
      setNavHidden(true);
      reload().catch(err => { console.error("Failed to load recipes:", err); setLoading(false); });
    }
    return () => setNavHidden(false);
  }, [open, reload, setNavHidden]);

  useEffect(() => {
    if (!open) { setDraft(null); setShowFavPicker(false); setPortionG(""); }
    else setMeal(defaultMeal);
  }, [open, defaultMeal]);

  const summary = useMemo(
    () => (draft ? summarizeRecipe(draft) : null),
    [draft]
  );

  if (!open) return null;

  /* ── Draft mutation ── */

  function patchDraft(patch: Partial<Recipe>) {
    setDraft(prev => (prev ? { ...prev, ...patch } : prev));
  }

  function patchIngredient(id: string, patch: Partial<RecipeIngredient>) {
    setDraft(prev =>
      prev
        ? { ...prev, ingredients: prev.ingredients.map(i => (i.id === id ? { ...i, ...patch } : i)) }
        : prev
    );
  }

  function addIngredient(ingredient?: RecipeIngredient) {
    setDraft(prev => (prev ? { ...prev, ingredients: [...prev.ingredients, ingredient ?? emptyIngredient()] } : prev));
  }

  function removeIngredient(id: string) {
    setDraft(prev =>
      prev
        ? { ...prev, ingredients: prev.ingredients.filter(i => i.id !== id) }
        : prev
    );
  }

  async function persistDraft() {
    if (!draft || !draft.name.trim()) return;
    const saved = await saveRecipe({ ...draft, name: draft.name.trim() });
    setRecipes(prev => {
      const rest = prev.filter(r => r.id !== saved.id);
      return [saved, ...rest].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    });
    setDraft(null);
  }

  async function removeRecipe(id: string) {
    await deleteRecipe(id);
    setRecipes(prev => prev.filter(r => r.id !== id));
    setDraft(prev => (prev?.id === id ? null : prev));
  }

  /* ── Logging a portion ── */

  async function logPortion() {
    if (!draft || !summary) return;
    const grams = num(portionG);
    if (grams <= 0) return;

    setLogging(true);
    try {
      const uid = userId || (await resolveUserId());
      if (!uid) return;
      const macros = portionByCookedGrams(draft, grams);

      // Saving first means a portion logged from an unsaved draft doesn't
      // vanish along with the recipe it came from.
      await saveRecipe({ ...draft, name: draft.name.trim() || t.recipes.untitled });

      await enqueue({
        type: "upsert",
        table: "food_logs",
        payload: {
          id: crypto.randomUUID(),
          user_id: uid,
          logged_date: todayISO(),
          meal_type: meal,
          food_name: draft.name.trim() || t.recipes.untitled,
          calories: macros.calories,
          protein_g: macros.protein,
          carbs_g: macros.carbs,
          fats_g: macros.fats,
          weight_g: Math.round(grams * 10) / 10,
          detail: { category: t.recipes.categoryLabel, source: "manual" as const },
          created_at: new Date().toISOString(),
        },
      });
      if (isOnline) triggerSync();
      onLogged();
      setPortionG("");
      onClose();
    } finally {
      setLogging(false);
    }
  }

  /* ══ RENDER ══ */

  return (
    <div className="fixed inset-0 z-[60] bg-[var(--bg)] flex flex-col">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 pb-3 border-b border-[var(--border)] shrink-0"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={() => (draft ? setDraft(null) : onClose())}
          className="w-9 h-9 rounded-full border border-[var(--border)] hover:border-[var(--muted)] flex items-center justify-center text-[var(--muted)] shrink-0"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] text-[var(--accent)] font-mono tracking-widest uppercase">RECIPES.SYS</span>
          <h1 className="text-lg font-bold text-[var(--text)] leading-tight truncate">
            {draft ? (draft.name.trim() || t.recipes.newRecipe) : t.recipes.title}
          </h1>
        </div>
        {draft && (
          <button
            type="button"
            onClick={persistDraft}
            disabled={!draft.name.trim()}
            className="btn-aqua px-4 py-2 text-xs font-bold shrink-0 disabled:opacity-50"
          >
            {t.recipes.save}
          </button>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        {/* ══ LIST ══ */}
        {!draft && (
          <>
            <button
              type="button"
              onClick={() => setDraft(newRecipe(userId))}
              className="btn-outline w-full border-dashed py-3 text-sm"
            >
              {t.recipes.newRecipe}
            </button>

            {loading ? (
              <div className="skeleton h-20 w-full rounded-2xl" />
            ) : recipes.length === 0 ? (
              <p className="text-xs text-[var(--muted)] text-center py-10 leading-relaxed px-6">
                {t.recipes.empty}
              </p>
            ) : (
              recipes.map(recipe => {
                const s = summarizeRecipe(recipe);
                return (
                  <button
                    key={recipe.id}
                    type="button"
                    onClick={() => { setDraft(recipe); setPortionG(s.perServingWeightG ? String(s.perServingWeightG) : ""); }}
                    className="card-glass w-full p-3 flex items-center gap-3 text-left"
                  >
                    <span className="shrink-0 w-12 text-right">
                      <span className="metric block text-base font-bold leading-none text-[var(--text)]">
                        {s.per100gCooked.calories}
                      </span>
                      <span className="block text-[9px] font-mono uppercase tracking-wide text-[var(--faint)] leading-none mt-1">
                        /100g
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold text-[var(--text)] truncate">{recipe.name}</h4>
                      <p className="text-[10px] text-[var(--faint)] font-mono uppercase truncate mt-0.5">
                        {t.recipes.batchSummary(s.effectiveCookedWeightG, recipe.ingredients.length)}
                      </p>
                    </div>
                    <span className="text-[var(--faint)] text-xs shrink-0">›</span>
                  </button>
                );
              })
            )}
          </>
        )}

        {/* ══ EDITOR ══ */}
        {draft && summary && (
          <>
            <input
              type="text"
              value={draft.name}
              onChange={e => patchDraft({ name: e.target.value })}
              placeholder={t.recipes.namePlaceholder}
              className="input-base"
            />

            {/* Ingredients */}
            <div className="space-y-2">
              <p className="section-label">{t.recipes.ingredients}</p>

              {draft.ingredients.map((ing, idx) => (
                <div key={ing.id} className="card-glass p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="sector-readout text-[9px] font-mono shrink-0">{idx + 1}</span>
                    <input
                      type="text"
                      value={ing.name}
                      onChange={e => patchIngredient(ing.id, { name: e.target.value })}
                      placeholder={t.recipes.ingredientName}
                      className="input-base flex-1 text-sm py-1.5"
                    />
                    {draft.ingredients.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeIngredient(ing.id)}
                        className="text-red-400/70 hover:text-red-400 px-1 text-sm shrink-0"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[9px] text-[var(--faint)] font-mono uppercase tracking-wide">
                        {t.recipes.rawWeight}
                      </span>
                      <input
                        type="number" inputMode="decimal" min="0"
                        value={ing.rawWeightG || ""}
                        onChange={e => patchIngredient(ing.id, { rawWeightG: num(e.target.value) })}
                        placeholder="0"
                        className="input-base metric text-sm py-1.5"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[9px] text-[var(--faint)] font-mono uppercase tracking-wide">
                        {t.recipes.yieldFactor}
                      </span>
                      <input
                        type="number" inputMode="decimal" step="0.01" min="0.1" max="5"
                        value={ing.yieldFactor}
                        onChange={e => patchIngredient(ing.id, { yieldFactor: num(e.target.value, 1) })}
                        onBlur={e => patchIngredient(ing.id, { yieldFactor: clampYieldFactor(num(e.target.value, 1)) })}
                        className="input-base metric text-sm py-1.5"
                      />
                    </label>
                  </div>

                  {/* Yield presets — the table most people don't have memorised */}
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {YIELD_PRESETS.map(preset => (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => patchIngredient(ing.id, { yieldFactor: preset.factor })}
                        className={cn(
                          "shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors",
                          Math.abs(ing.yieldFactor - preset.factor) < 0.001
                            ? "bg-[var(--accent)] text-[#041a1f] border-[var(--accent)]"
                            : "border-[var(--border)] text-[var(--sub)] hover:text-[var(--muted)]"
                        )}
                      >
                        {t.recipes.yieldPresets[preset.key] ?? preset.key} ·{" "}
                        <span className="metric">{preset.factor}</span>
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      ["calories100g", t.recipes.kcal] as const,
                      ["protein100g",  "P"] as const,
                      ["carbs100g",    "C"] as const,
                      ["fats100g",     "F"] as const,
                    ]).map(([field, label]) => (
                      <label key={field} className="block">
                        <span className="text-[9px] text-[var(--faint)] font-mono uppercase tracking-wide">
                          {label}/100g
                        </span>
                        <input
                          type="number" inputMode="decimal" min="0"
                          value={ing[field] || ""}
                          onChange={e => patchIngredient(ing.id, { [field]: num(e.target.value) })}
                          placeholder="0"
                          className="input-base metric text-sm py-1.5 px-2"
                        />
                      </label>
                    ))}
                  </div>

                  <p className="text-[9px] font-mono text-[var(--faint)] leading-none">
                    {t.recipes.cookedPreview(
                      Math.round(ing.rawWeightG * clampYieldFactor(ing.yieldFactor) * 10) / 10
                    )}
                  </p>
                </div>
              ))}

              <div className="flex gap-2">
                <button type="button" onClick={() => addIngredient()} className="btn-outline flex-1 border-dashed py-2 text-xs">
                  {t.recipes.addIngredient}
                </button>
                <button
                  type="button"
                  onClick={() => setShowFavPicker(v => !v)}
                  disabled={favorites.length === 0}
                  className="btn-outline flex-1 border-dashed py-2 text-xs disabled:opacity-40"
                >
                  {t.recipes.fromFavorites}
                </button>
              </div>

              {showFavPicker && favorites.length > 0 && (
                <div className="card-glass p-2 space-y-1 max-h-52 overflow-y-auto">
                  {favorites.map(fav => (
                    <button
                      key={fav.id}
                      type="button"
                      onClick={() => { addIngredient(ingredientFromSavedFood(fav)); setShowFavPicker(false); }}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--accent-faint)] text-left"
                    >
                      <span className="text-xs text-[var(--text)] truncate">{fav.name}</span>
                      <span className="metric text-[10px] text-[var(--faint)] shrink-0">
                        {Math.round(fav.calories_100g)} kcal/100g
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Batch yield */}
            <div className="card-glass p-3 space-y-2">
              <p className="section-label">{t.recipes.batchYield}</p>

              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="rounded-lg border border-[var(--border)] px-2 py-1.5">
                  <span className="text-[var(--faint)] uppercase tracking-wide block leading-none">
                    {t.recipes.rawTotal}
                  </span>
                  <span className="metric text-[var(--text)] text-sm font-bold">{summary.rawWeightG} g</span>
                </div>
                <div className="rounded-lg border border-[var(--border)] px-2 py-1.5">
                  <span className="text-[var(--faint)] uppercase tracking-wide block leading-none">
                    {t.recipes.estimatedCooked}
                  </span>
                  <span className="metric text-[var(--text)] text-sm font-bold">{summary.estimatedCookedWeightG} g</span>
                </div>
              </div>

              <label className="block">
                <span className="text-[9px] text-[var(--faint)] font-mono uppercase tracking-wide">
                  {t.recipes.measuredCooked}
                </span>
                <input
                  type="number" inputMode="decimal" min="0"
                  value={draft.cookedWeightG ?? ""}
                  onChange={e => patchDraft({ cookedWeightG: e.target.value === "" ? null : num(e.target.value) })}
                  placeholder={String(summary.estimatedCookedWeightG)}
                  className="input-base metric text-sm py-1.5"
                />
              </label>
              <p className="text-[9px] font-mono text-[var(--faint)] leading-relaxed">
                {summary.measured ? t.recipes.usingMeasured : t.recipes.usingEstimate}
              </p>

              <label className="block">
                <span className="text-[9px] text-[var(--faint)] font-mono uppercase tracking-wide">
                  {t.recipes.servings}
                </span>
                <input
                  type="number" inputMode="numeric" min="1"
                  value={draft.servings ?? ""}
                  onChange={e => patchDraft({ servings: e.target.value === "" ? null : Math.max(1, Math.round(num(e.target.value, 1))) })}
                  placeholder="—"
                  className="input-base metric text-sm py-1.5"
                />
              </label>
            </div>

            {/* Nutrition */}
            <div className="card-glass p-3 space-y-3">
              <p className="section-label !mb-1">{t.recipes.per100gCooked}</p>
              <MacroSummary
                calories={summary.per100gCooked.calories}
                protein={summary.per100gCooked.protein}
                carbs={summary.per100gCooked.carbs}
                fats={summary.per100gCooked.fats}
              />
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-1">
                <div className="rounded-lg bg-[var(--accent-faint)] px-2 py-1.5">
                  <span className="text-[var(--faint)] uppercase tracking-wide block leading-none">
                    {t.recipes.wholeBatch}
                  </span>
                  <span className="metric text-[var(--text)] text-sm font-bold">{summary.totals.calories} kcal</span>
                </div>
                {summary.perServing && summary.perServingWeightG != null && (
                  <div className="rounded-lg bg-[var(--accent-faint)] px-2 py-1.5">
                    <span className="text-[var(--faint)] uppercase tracking-wide block leading-none">
                      {t.recipes.perServingLabel(summary.perServingWeightG)}
                    </span>
                    <span className="metric text-[var(--text)] text-sm font-bold">{summary.perServing.calories} kcal</span>
                  </div>
                )}
              </div>
            </div>

            {/* Log a portion */}
            <div className="card-glass p-3 space-y-2">
              <p className="section-label">{t.recipes.logPortion}</p>

              <div className="flex gap-2">
                <input
                  type="number" inputMode="decimal" min="0"
                  value={portionG}
                  onChange={e => setPortionG(e.target.value)}
                  placeholder={t.recipes.cookedGrams}
                  className="input-base metric flex-1 text-sm py-2"
                />
                {summary.perServingWeightG != null && (
                  <button
                    type="button"
                    onClick={() => setPortionG(String(summary.perServingWeightG))}
                    className="btn-outline px-3 text-[11px] shrink-0"
                  >
                    {t.recipes.oneServing}
                  </button>
                )}
              </div>

              <div className="flex border border-[var(--border)] rounded-xl overflow-hidden">
                {MEAL_SLOTS.map(slot => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setMeal(slot)}
                    className={cn(
                      "flex-1 py-2 text-[11px] font-semibold transition-all",
                      meal === slot
                        ? "bg-[var(--accent)] text-[#041a1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                        : "text-[var(--sub)] hover:text-[var(--muted)]"
                    )}
                  >
                    {t.nutritionTracker[slot]}
                  </button>
                ))}
              </div>

              {num(portionG) > 0 && (
                <p className="text-[10px] font-mono text-[var(--faint)] leading-relaxed">
                  {(() => {
                    const m = portionByCookedGrams(draft, num(portionG));
                    return `${m.calories} kcal · ${m.protein}P · ${m.carbs}C · ${m.fats}F`;
                  })()}
                </p>
              )}

              <button
                type="button"
                onClick={logPortion}
                disabled={logging || num(portionG) <= 0 || summary.effectiveCookedWeightG <= 0}
                className="btn-aqua w-full py-2.5 text-xs font-bold disabled:opacity-50"
              >
                {logging ? "…" : t.nutritionTracker.addToDiary}
              </button>
            </div>

            <button
              type="button"
              onClick={() => removeRecipe(draft.id)}
              className="btn-outline w-full py-2 text-xs text-red-400 border-red-400/30"
            >
              {t.recipes.delete}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
