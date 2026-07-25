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
// free; only the score/category fields need to be named explicitly.
const SEARCH_FIELDS =
  "code,product_name,product_name_es,brands,nutriments,serving_size,nutriscore_grade,nova_group,categories_tags";

/** Parse the package serving size ("30 g", "250ml", "2 rebanadas (56 g)") into
 *  grams. ml is treated 1:1 as grams (exact for water-based drinks, close for
 *  most). */
export function parseServingGrams(servingSize: string | null): number | null {
  if (!servingSize) return null;
  const m = servingSize.match(/(\d+(?:[.,]\d+)?)\s*(g|ml)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
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
  const servingGrams = parseServingGrams(servingSize);

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
