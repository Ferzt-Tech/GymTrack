/* Reference Daily Values (FDA, adults) and nutrient display helpers.
 *
 * All amounts are expressed in GRAMS — the same unit Open Food Facts uses for
 * its normalized `<nutrient>_100g` fields — so %DV math stays unit-agnostic.
 * The display layer converts grams → g / mg / µg for humans. */

export const DAILY_VALUES: Record<string, number> = {
  // extended macros
  fiber: 28,
  satFat: 20,
  sodium: 2.3, // 2300 mg
  salt: 5.75,
  sugars: 50,
  // minerals
  calcium: 1.3, // 1300 mg
  iron: 0.018, // 18 mg
  potassium: 4.7, // 4700 mg
  magnesium: 0.42, // 420 mg
  zinc: 0.011, // 11 mg
  phosphorus: 1.25, // 1250 mg
  // vitamins
  "vitamin-a": 0.0009, // 900 µg
  "vitamin-c": 0.09, // 90 mg
  "vitamin-d": 0.00002, // 20 µg
  "vitamin-e": 0.015, // 15 mg
  "vitamin-k": 0.00012, // 120 µg
  "vitamin-b6": 0.0017, // 1.7 mg
  "vitamin-b9": 0.0004, // 400 µg (folate)
  "vitamin-b12": 0.0000024, // 2.4 µg
};

/** Bilingual display names for the vitamins/minerals grid. Nutrient names are
 *  data (they read the same everywhere), so they live here rather than bloating
 *  the i18n files — both languages are still covered. */
export const NUTRIENT_LABELS: Record<string, { en: string; es: string }> = {
  calcium: { en: "Calcium", es: "Calcio" },
  iron: { en: "Iron", es: "Hierro" },
  potassium: { en: "Potassium", es: "Potasio" },
  magnesium: { en: "Magnesium", es: "Magnesio" },
  zinc: { en: "Zinc", es: "Zinc" },
  phosphorus: { en: "Phosphorus", es: "Fósforo" },
  "vitamin-a": { en: "Vitamin A", es: "Vitamina A" },
  "vitamin-c": { en: "Vitamin C", es: "Vitamina C" },
  "vitamin-d": { en: "Vitamin D", es: "Vitamina D" },
  "vitamin-e": { en: "Vitamin E", es: "Vitamina E" },
  "vitamin-k": { en: "Vitamin K", es: "Vitamina K" },
  "vitamin-b6": { en: "Vitamin B6", es: "Vitamina B6" },
  "vitamin-b9": { en: "Folate", es: "Folato" },
  "vitamin-b12": { en: "Vitamin B12", es: "Vitamina B12" },
};

/** OFF nutriment ids we surface in the micros grid, in display order. */
export const MICRO_KEYS = Object.keys(NUTRIENT_LABELS);

/** %DV for a nutrient given an amount in grams. null if no reference exists. */
export function percentDV(key: string, grams: number): number | null {
  const dv = DAILY_VALUES[key];
  if (!dv || dv <= 0 || !isFinite(grams) || grams <= 0) return null;
  return Math.round((grams / dv) * 100);
}

/** Format a grams amount into a human-friendly value + unit (g / mg / µg). */
export function formatNutrientAmount(grams: number): { value: string; unit: string } {
  if (!isFinite(grams) || grams < 0) return { value: "0", unit: "g" };
  if (grams >= 1) return { value: trim(grams, 1), unit: "g" };
  const mg = grams * 1000;
  if (mg >= 1) return { value: trim(mg, mg < 10 ? 1 : 0), unit: "mg" };
  const ug = grams * 1_000_000;
  return { value: trim(ug, ug < 10 ? 1 : 0), unit: "µg" };
}

function trim(n: number, decimals: number): string {
  const r = Math.round(n * 10 ** decimals) / 10 ** decimals;
  return String(r);
}
