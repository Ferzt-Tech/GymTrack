/* ── Saved foods (favorites) ──
   One place for the favorite <-> detail-sheet conversions and the basis math.

   A `saved_foods` row always stores CANONICAL PER-100G macros; `default_weight_g`
   records the portion the user actually saved the food at (473 for a whole energy
   drink, 100 for a plain per-100g reference). Everything displayed derives from
   the per-100g values scaled to that basis, so the stored numbers never depend on
   the basis and legacy rows keep working (they simply read as 100 g).

   The ♥ toggle and the per-100g normalizer used to be hand-copied in both
   `/nutrition` and `FoodLoggerSheet`; they live here now so the basis rule can't
   drift between the two. */

import { scaleByWeight, scaleDetail } from "@/lib/nutrition";
import type { DetailFood, FoodDetail, SavedFood } from "@/types";

/** The portion a favorite is expressed in. Legacy/absent values read as 100 g. */
export function savedBasisGrams(fav: SavedFood): number {
  const g = fav.default_weight_g;
  return typeof g === "number" && g > 0 ? g : 100;
}

/** A favorite's macros + extended detail at its own saved basis (not per-100g). */
export function scaledFavorite(fav: SavedFood, basisG = savedBasisGrams(fav)): {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  detail: FoodDetail | null;
} {
  const ratio = basisG / 100;
  return {
    calories: Math.round(fav.calories_100g * ratio),
    protein: scaleByWeight(100, basisG, fav.protein_100g),
    carbs: scaleByWeight(100, basisG, fav.carbs_100g),
    fats: scaleByWeight(100, basisG, fav.fats_100g),
    detail: scaleDetail(fav.detail, ratio),
  };
}

/** Normalize a favorite for the detail sheet, which always works per-100g.
 *  `preferredPortionG` makes the sheet reopen at the basis the food was saved at. */
export function toDetailFood(fav: SavedFood): DetailFood {
  return {
    key: fav.id,
    name: fav.name,
    brand: fav.detail?.brand ?? null,
    category: fav.detail?.category ?? null,
    cal100: fav.calories_100g,
    protein100: fav.protein_100g,
    carbs100: fav.carbs_100g,
    fats100: fav.fats_100g,
    detail: fav.detail,
    defaultWeightG: savedBasisGrams(fav),
    preferredPortionG: savedBasisGrams(fav),
  };
}

/** Find the favorite a detail-sheet food corresponds to. Barcode first (the same
 *  product can be saved under a locale-translated name), then exact name. */
export function findSavedMatch(list: SavedFood[], food: DetailFood): SavedFood | undefined {
  const code = food.detail?.code;
  if (code) {
    const byCode = list.find((f) => f.detail?.code === code);
    if (byCode) return byCode;
  }
  return list.find((f) => f.name === food.name);
}

/** Build the `saved_foods` row for a food the user hearted at `basisGrams`.
 *  Macros stay per-100g; only `default_weight_g` records the chosen basis. */
export function buildSavedFood(food: DetailFood, basisGrams: number, userId: string): SavedFood {
  const basis = basisGrams > 0 ? Math.round(basisGrams * 10) / 10 : 100;
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    name: food.name,
    calories_100g: food.cal100,
    protein_100g: food.protein100,
    carbs_100g: food.carbs100,
    fats_100g: food.fats100,
    default_weight_g: basis,
    detail: food.detail ?? null,
    created_at: new Date().toISOString(),
  };
}

/** Newest-saved first — the order the capped quick-add list and the favorites
 *  subpage present favorites in. */
export function sortFavorites(list: SavedFood[]): SavedFood[] {
  return [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
