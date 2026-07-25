/* Best-effort emoji for a food, from its Open Food Facts category or name.
 * Purely decorative — falls back to a neutral plate. */

const RULES: [RegExp, string][] = [
  [/whey|protein|supplement|proteína|suplement/i, "🥛"],
  [/milk|leche|dairy|lácteo|yogur|yogurt/i, "🥛"],
  [/cheese|queso/i, "🧀"],
  [/bread|pan|bakery|harina|tortilla|toast/i, "🍞"],
  [/cereal|oat|avena|granola/i, "🥣"],
  [/rice|arroz/i, "🍚"],
  [/pasta|noodle|fideo/i, "🍝"],
  [/chicken|pollo|pavo|turkey|poultry/i, "🍗"],
  [/beef|res|carne|steak|pork|cerdo|ham|jamón|fiambre|sausage|salchicha/i, "🥩"],
  [/fish|pescado|salmon|atún|tuna|seafood|marisco/i, "🐟"],
  [/egg|huevo/i, "🥚"],
  [/chocolate|cocoa|cacao|mazapán/i, "🍫"],
  [/candy|sweet|dulce|caramelo/i, "🍬"],
  [/cookie|galleta|biscuit/i, "🍪"],
  [/cake|pastel|dessert|postre/i, "🍰"],
  [/ice.?cream|helado/i, "🍨"],
  [/chips|snack|botana|frituras/i, "🍿"],
  [/nut|almond|nuez|almendra|cacahuate|peanut/i, "🥜"],
  [/fruit|fruta|apple|manzana|banana|plátano|berry|baya/i, "🍎"],
  [/vegetable|verdura|vegetal|salad|ensalada|nopal/i, "🥗"],
  [/juice|jugo|soda|refresco|drink|bebida/i, "🥤"],
  [/coffee|café|tea|té/i, "☕"],
  [/water|agua/i, "💧"],
  [/oil|aceite|butter|mantequilla|margarina/i, "🧈"],
  [/bean|frijol|legume|legumbre|lentil|lenteja/i, "🫘"],
  [/pizza/i, "🍕"],
  [/burger|hamburguesa/i, "🍔"],
  [/taco|burrito|quesadilla/i, "🌮"],
];

export function foodEmoji(category?: string | null, name?: string | null): string {
  const haystack = `${category ?? ""} ${name ?? ""}`;
  for (const [re, emoji] of RULES) {
    if (re.test(haystack)) return emoji;
  }
  return "🍽️";
}
