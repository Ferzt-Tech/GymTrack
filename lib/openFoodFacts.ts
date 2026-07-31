/* ── Open Food Facts client ──
   Product-by-barcode uses the world endpoint (barcodes are global). Text search
   uses the modern Search-a-licious API filtered to the Mexican market first, so
   Mexican supermarket products (Lala, Bimbo, Santa Clara, Alpura…) rank before
   international ones. The legacy cgi/search.pl is kept only as a last-resort
   fallback — it is frequently "temporarily unavailable".

   Extracted from FoodLoggerSheet so both the logger and the food-detail sheet
   can share it. mapOffProduct now also extracts a per-100g FoodDetail (extended
   macros, vitamins/minerals, Nutri-Score, NOVA) from the same `nutriments`
   object that was already being fetched. */

import type { FoodDetail } from "@/types";
import { MICRO_KEYS } from "@/lib/dailyValues";

export interface OffItem {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  calories100g: number;
  protein100g: number;
  carbs100g: number;
  fats100g: number;
  servingSize: string | null;
  servingGrams: number | null;
  detail: FoodDetail; // per-100g
}

// The whole `nutriments` object is requested, so extended nutrients come for
// free; only the score/category/quantity fields need to be named explicitly.
// `product_quantity` + `quantity` give the net package content (the "whole
// 473 ml can" portion); `serving_quantity` is a pre-parsed serving size that
// beats regexing `serving_size`.
const SEARCH_FIELDS =
  "code,product_name,product_name_es,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,product_quantity,product_quantity_unit,quantity,nutriscore_grade,nova_group,categories_tags";

/** Mass/volume units OFF uses, as a multiplier to grams. Volume is treated 1:1
 *  with mass (exact for water-based drinks, close enough for most foods). */
const UNIT_TO_GRAMS: Record<string, number> = {
  kg: 1000, g: 1, gr: 1, mg: 0.001,
  l: 1000, dl: 100, cl: 10, ml: 1,
};

// Longest units first so "ml" is never read as "l", and \b so the "l" in
// "1 lata 473 ml" can't be mistaken for a litre.
const AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*(kg|mg|ml|cl|dl|l|g)\b/i;

/** Parse a free-text amount label into grams — a serving size ("30 g", "250ml",
 *  "2 rebanadas (56 g)") or a net package quantity ("473 ml", "1 L", "16 oz").
 *  Returns null when no mass/volume unit is present (e.g. "16 fl oz", "6 pieces"),
 *  which is correct: guessing there would put wrong macros in the diary. */
export function parseServingGrams(servingSize: string | null): number | null {
  if (!servingSize) return null;
  const m = servingSize.match(AMOUNT_RE);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  const grams = n * (UNIT_TO_GRAMS[m[2].toLowerCase()] ?? 1);
  return Math.round(grams * 10) / 10;
}

/** OFF's numeric quantity fields (`serving_quantity`, `product_quantity`) with
 *  their unit sibling — trustworthy only for mass/volume, since OFF also stores
 *  counts ("6" pieces) there, which would silently become grams. */
function quantityToGrams(value: unknown, unit: unknown): number | null {
  const n = parseFloat(String(value));
  if (!isFinite(n) || n <= 0) return null;
  const u = String(unit ?? "").toLowerCase().trim();
  // An absent unit on these fields means grams by OFF convention.
  const mult = u === "" ? 1 : UNIT_TO_GRAMS[u];
  if (mult == null) return null;
  return Math.round(n * mult * 10) / 10;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function offCategory(p: any): string | null {
  const tags: string[] = Array.isArray(p.categories_tags) ? p.categories_tags : [];
  const last = tags[tags.length - 1]; // most specific
  if (!last) return null;
  return last
    .replace(/^[a-z]{2}:/, "") // strip "en:" / "es:" locale prefix
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeGrade(g: unknown): FoodDetail["nutriScore"] {
  const v = typeof g === "string" ? g.toLowerCase() : "";
  return ["a", "b", "c", "d", "e"].includes(v) ? (v as FoodDetail["nutriScore"]) : undefined;
}

function normalizeNova(n: unknown): FoodDetail["novaGroup"] {
  const v = typeof n === "number" ? n : parseInt(String(n), 10);
  return [1, 2, 3, 4].includes(v) ? (v as FoodDetail["novaGroup"]) : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapOffProduct(p: any, fallbackId: string): OffItem {
  const nut = p.nutriments || {};
  let cal = parseFloat(nut["energy-kcal_100g"]) || parseFloat(nut["energy-kcal"]) || 0;
  if (cal === 0 && (nut["energy-kj_100g"] || nut["energy-kj"])) {
    const kj = parseFloat(nut["energy-kj_100g"]) || parseFloat(nut["energy-kj"]) || 0;
    cal = Math.round(kj / 4.184);
  }
  // brands is a string in the legacy/v2 APIs but an array in Search-a-licious
  const brand = Array.isArray(p.brands)
    ? (p.brands[0] ?? null)
    : (p.brands ? String(p.brands).split(",")[0] : null);
  const category = offCategory(p);
  const servingSize = p.serving_size || null;
  // Prefer OFF's already-parsed numeric serving over regexing the raw label.
  const servingGrams =
    quantityToGrams(p.serving_quantity, p.serving_quantity_unit) ?? parseServingGrams(servingSize);
  // Net package content — the "whole can / whole bar" portion. `quantity` is the
  // free-text label ("473 ml"), used as a display fallback for the numeric field.
  const packageLabel: string | null = p.quantity ? String(p.quantity) : null;
  const packageGrams =
    quantityToGrams(p.product_quantity, p.product_quantity_unit) ?? parseServingGrams(packageLabel);

  const num = (v: unknown): number | undefined => {
    const n = parseFloat(String(v));
    return isFinite(n) && n > 0 ? n : undefined;
  };

  // OFF normalizes `<nutrient>_100g` to grams, so store as-is (grams).
  const micros: Record<string, number> = {};
  for (const key of MICRO_KEYS) {
    const v = num(nut[`${key}_100g`]);
    if (v != null) micros[key] = v;
  }

  const detail: FoodDetail = {
    source: "off",
    brand: brand ?? undefined,
    category: category ?? undefined,
    code: p.code || undefined,
    servingSize: servingSize ?? undefined,
    servingGrams: servingGrams ?? undefined,
    packageGrams: packageGrams ?? undefined,
    packageLabel: packageLabel ?? undefined,
    sugars_g: num(nut.sugars_100g),
    fiber_g: num(nut.fiber_100g),
    satFat_g: num(nut["saturated-fat_100g"]),
    sodium_g: num(nut.sodium_100g),
    salt_g: num(nut.salt_100g),
    micros: Object.keys(micros).length ? micros : undefined,
    nutriScore: normalizeGrade(p.nutriscore_grade),
    novaGroup: normalizeNova(p.nova_group),
  };

  return {
    id: p.code || fallbackId,
    name: p.product_name_es || p.product_name || `Producto (${fallbackId})`,
    brand,
    category,
    calories100g: cal,
    protein100g: parseFloat(nut.proteins_100g) || 0,
    carbs100g: parseFloat(nut.carbohydrates_100g) || 0,
    fats100g: parseFloat(nut.fat_100g) || 0,
    servingSize,
    servingGrams,
    detail,
  };
}

/** A product with all-zero nutriments is an incomplete OFF entry — logging it
    would silently corrupt the daily totals with fake zeros. */
export function hasNutritionData(item: OffItem): boolean {
  return item.calories100g > 0 || item.protein100g > 0 || item.carbs100g > 0 || item.fats100g > 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchALicious(query: string): Promise<any[] | null> {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&langs=es&page_size=20&fields=${SEARCH_FIELDS}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.hits || [];
}

export async function offSearchProducts(query: string): Promise<OffItem[]> {
  // 1. Mexican market first
  try {
    const mxHits = await searchALicious(`${query} countries_tags:"en:mexico"`);
    if (mxHits) {
      const mxItems = mxHits
        .map((p) => mapOffProduct(p, p.code || crypto.randomUUID()))
        .filter(hasNutritionData);
      if (mxItems.length > 0) return mxItems;
    }
    // 2. Worldwide (imported / international foods)
    const worldHits = await searchALicious(query);
    if (worldHits) {
      const worldItems = worldHits
        .map((p) => mapOffProduct(p, p.code || crypto.randomUUID()))
        .filter(hasNutritionData);
      if (worldItems.length > 0) return worldItems;
    }
  } catch (err) {
    console.warn("Search-a-licious failed, falling back to legacy search:", err);
  }
  // 3. Legacy fallback (only if the new API is down)
  const params = `search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=true&page_size=20&sort_by=unique_scans_n&lc=es`;
  const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`);
  if (res.ok) {
    try {
      const data = await res.json();
      return (data.products || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => mapOffProduct(p, p.code || crypto.randomUUID()))
        .filter(hasNutritionData);
    } catch { /* endpoint returned an HTML error page */ }
  }
  return [];
}

export async function offProductByBarcode(barcode: string): Promise<OffItem | null> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return mapOffProduct(data.product, barcode);
}
