/**
 * Recipes & the raw → cooked yield problem.
 *
 * Nutrition databases list meat raw and grains dry, but people weigh food on the
 * plate. 100 g of raw chicken breast becomes ~75 g cooked — same protein, less
 * water — so logging "150 g chicken" off a cooked portion against raw macros
 * under-counts by a third. Dry rice runs the other way: 100 g becomes ~280 g
 * cooked, and the naive log over-counts by nearly 3×.
 *
 * The model that makes both work: **macros are conserved through cooking, mass
 * is not**. So the batch's totals come from the RAW weights and RAW per-100g
 * values, and only the divisor changes — total cooked weight, measured if the
 * user weighed the finished batch, estimated from per-ingredient yield factors
 * otherwise. A scale always beats a lookup table, so a measured weight wins.
 *
 * Storage is device-local (IndexedDB `recipes`), for the same reasons as
 * lib/volumeFeedback.ts — see the note there.
 */

import { getDb } from "./db";
import type { Recipe, RecipeIngredient, SavedFood } from "@/types";
import { savedBasisGrams } from "./savedFoods";

/** cooked grams ÷ raw grams. Values below 1 lose water, above 1 absorb it.
 *  USDA yield-factor tables, rounded to what a kitchen scale can resolve. */
export const YIELD_PRESETS: { key: string; factor: number }[] = [
  { key: "none", factor: 1 },
  { key: "chickenBreast", factor: 0.75 },
  { key: "leanBeef", factor: 0.73 },
  { key: "groundBeef", factor: 0.75 },
  { key: "porkLoin", factor: 0.74 },
  { key: "whiteFish", factor: 0.8 },
  { key: "salmon", factor: 0.79 },
  { key: "eggs", factor: 0.9 },
  { key: "whiteRice", factor: 2.8 },
  { key: "brownRice", factor: 2.6 },
  { key: "pasta", factor: 2.4 },
  { key: "oats", factor: 3.0 },
  { key: "legumes", factor: 2.4 },
  { key: "potato", factor: 0.9 },
  { key: "leafyGreens", factor: 0.55 },
  { key: "mixedVegetables", factor: 0.85 },
];

export const DEFAULT_YIELD_FACTOR = 1;
/** Guard rails — a factor outside this is a typo, and a bad divisor silently
 *  corrupts every portion logged from the recipe. */
export const MIN_YIELD_FACTOR = 0.1;
export const MAX_YIELD_FACTOR = 5;

export interface RecipeMacros {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface RecipeSummary {
  /** Sum of the ingredients' raw weights, grams. */
  rawWeightG: number;
  /** Σ rawWeightG × yieldFactor — what the yield table predicts. */
  estimatedCookedWeightG: number;
  /** The divisor actually used: measured weight when present, else estimated. */
  effectiveCookedWeightG: number;
  /** True when the user weighed the finished batch. */
  measured: boolean;
  /** Whole-batch macros (conserved from the raw ingredients). */
  totals: RecipeMacros;
  /** Macros per 100 g of the finished, cooked food. */
  per100gCooked: RecipeMacros;
  /** Per portion when the batch is split by count; null without `servings`. */
  perServing: RecipeMacros | null;
  perServingWeightG: number | null;
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function clampYieldFactor(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return DEFAULT_YIELD_FACTOR;
  return Math.min(MAX_YIELD_FACTOR, Math.max(MIN_YIELD_FACTOR, factor));
}

/** Raw grams → cooked grams. */
export function rawToCooked(rawG: number, yieldFactor: number): number {
  return round1(rawG * clampYieldFactor(yieldFactor));
}

/** Cooked grams → the raw weight they came from. The inverse direction people
 *  need when they only weighed the finished plate. */
export function cookedToRaw(cookedG: number, yieldFactor: number): number {
  return round1(cookedG / clampYieldFactor(yieldFactor));
}

/** Per-100g values restated on a cooked basis: the same macros spread over the
 *  new mass. A yield of 0.75 makes cooked chicken ~33 % denser per gram. */
export function per100gRawToCooked(value100gRaw: number, yieldFactor: number): number {
  return round1(value100gRaw / clampYieldFactor(yieldFactor));
}

const ZERO: RecipeMacros = { calories: 0, protein: 0, carbs: 0, fats: 0 };

function scaleMacros(m: RecipeMacros, ratio: number): RecipeMacros {
  return {
    calories: round1(m.calories * ratio),
    protein: round1(m.protein * ratio),
    carbs: round1(m.carbs * ratio),
    fats: round1(m.fats * ratio),
  };
}

/** Whole-batch macros. Summed from RAW weights — cooking moves water, not
 *  calories, so this total is basis-independent and stays correct however the
 *  finished batch is portioned. */
export function recipeTotals(ingredients: RecipeIngredient[]): RecipeMacros {
  return ingredients.reduce<RecipeMacros>((acc, ing) => {
    const ratio = (Number(ing.rawWeightG) || 0) / 100;
    return {
      calories: acc.calories + (Number(ing.calories100g) || 0) * ratio,
      protein: acc.protein + (Number(ing.protein100g) || 0) * ratio,
      carbs: acc.carbs + (Number(ing.carbs100g) || 0) * ratio,
      fats: acc.fats + (Number(ing.fats100g) || 0) * ratio,
    };
  }, { ...ZERO });
}

export function estimatedCookedWeight(ingredients: RecipeIngredient[]): number {
  return round1(
    ingredients.reduce(
      (sum, ing) => sum + (Number(ing.rawWeightG) || 0) * clampYieldFactor(ing.yieldFactor),
      0
    )
  );
}

export function totalRawWeight(ingredients: RecipeIngredient[]): number {
  return round1(ingredients.reduce((sum, ing) => sum + (Number(ing.rawWeightG) || 0), 0));
}

/** Everything the UI needs about a recipe, in one pass. */
export function summarizeRecipe(recipe: Pick<Recipe, "ingredients" | "cookedWeightG" | "servings">): RecipeSummary {
  const ingredients = recipe.ingredients ?? [];
  const totals = recipeTotals(ingredients);
  const estimated = estimatedCookedWeight(ingredients);
  const measured = recipe.cookedWeightG != null && recipe.cookedWeightG > 0;
  const effective = measured ? (recipe.cookedWeightG as number) : estimated;

  const per100gCooked = effective > 0 ? scaleMacros(totals, 100 / effective) : { ...ZERO };
  const servings = recipe.servings && recipe.servings > 0 ? recipe.servings : null;

  return {
    rawWeightG: totalRawWeight(ingredients),
    estimatedCookedWeightG: estimated,
    effectiveCookedWeightG: round1(effective),
    measured,
    totals: {
      calories: Math.round(totals.calories),
      protein: round1(totals.protein),
      carbs: round1(totals.carbs),
      fats: round1(totals.fats),
    },
    per100gCooked,
    perServing: servings ? scaleMacros(totals, 1 / servings) : null,
    perServingWeightG: servings ? round1(effective / servings) : null,
  };
}

/** Macros for a portion of the finished batch, weighed in cooked grams. */
export function portionByCookedGrams(
  recipe: Pick<Recipe, "ingredients" | "cookedWeightG" | "servings">,
  cookedGrams: number
): RecipeMacros {
  const summary = summarizeRecipe(recipe);
  if (summary.effectiveCookedWeightG <= 0) return { ...ZERO };
  return scaleMacros(summary.totals, cookedGrams / summary.effectiveCookedWeightG);
}

/** Macros for a whole number (or fraction) of the batch's servings. */
export function portionByServings(
  recipe: Pick<Recipe, "ingredients" | "cookedWeightG" | "servings">,
  servings: number
): RecipeMacros {
  const summary = summarizeRecipe(recipe);
  if (!summary.perServing) return { ...ZERO };
  return scaleMacros(summary.perServing, servings);
}

/** Build an ingredient from a saved favorite. Favorites store canonical
 *  per-100g values, so they drop straight in — the user only supplies the raw
 *  weight and how it cooks. */
export function ingredientFromSavedFood(
  fav: SavedFood,
  rawWeightG?: number,
  yieldFactor: number = DEFAULT_YIELD_FACTOR
): RecipeIngredient {
  return {
    id: generateUUID(),
    name: fav.name,
    rawWeightG: rawWeightG ?? savedBasisGrams(fav),
    calories100g: fav.calories_100g,
    protein100g: fav.protein_100g,
    carbs100g: fav.carbs_100g,
    fats100g: fav.fats_100g,
    yieldFactor: clampYieldFactor(yieldFactor),
    savedFoodId: fav.id,
    detail: fav.detail ?? null,
  };
}

export function emptyIngredient(): RecipeIngredient {
  return {
    id: generateUUID(),
    name: "",
    rawWeightG: 0,
    calories100g: 0,
    protein100g: 0,
    carbs100g: 0,
    fats100g: 0,
    yieldFactor: DEFAULT_YIELD_FACTOR,
    savedFoodId: null,
    detail: null,
  };
}

export function newRecipe(userId: string): Recipe {
  const now = new Date().toISOString();
  return {
    id: generateUUID(),
    user_id: userId,
    name: "",
    ingredients: [emptyIngredient()],
    cookedWeightG: null,
    servings: null,
    notes: null,
    created_at: now,
    updated_at: now,
  };
}

/* ── Local persistence ───────────────────────────────────────────────────── */

export async function listRecipes(userId: string): Promise<Recipe[]> {
  const db = await getDb();
  if (!db) return [];
  const all = (await db.getAll("recipes")) as Recipe[];
  return all
    .filter(r => r.user_id === userId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function saveRecipe(recipe: Recipe): Promise<Recipe> {
  const db = await getDb();
  const row: Recipe = {
    ...recipe,
    ingredients: recipe.ingredients.map(i => ({ ...i, yieldFactor: clampYieldFactor(i.yieldFactor) })),
    updated_at: new Date().toISOString(),
  };
  if (!db) return row;
  await db.put("recipes", row);
  return row;
}

export async function deleteRecipe(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete("recipes", id);
}
