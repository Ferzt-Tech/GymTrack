export interface FoodItemEstimate {
  food_name: string;
  weight_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
}

const USER_KEY_STORAGE = "gymtrack:gemini_api_key";

/** Personal Gemini API key entered by the user in Settings (device-local). */
export function getUserGeminiKey(): string | null {
  if (typeof window === "undefined") return null;
  const key = localStorage.getItem(USER_KEY_STORAGE);
  return key && key.trim() ? key.trim() : null;
}

export function setUserGeminiKey(key: string): void {
  if (typeof window === "undefined") return;
  if (key.trim()) localStorage.setItem(USER_KEY_STORAGE, key.trim());
  else localStorage.removeItem(USER_KEY_STORAGE);
}

/**
 * Entry point to analyze food using AI.
 *
 * A user's own Gemini key (Settings → AI Meal Scanner) always calls Gemini
 * directly from the client — it's their own key, nothing to protect. The
 * bundled key (owner/dev-account fallback only, see canUseAiScanner() in
 * lib/devMode.ts) never reaches the client at all: it lives server-side in
 * the analyze-meal Edge Function's GEMINI_API_KEY env var, so this path
 * calls that function instead of Gemini directly. Before this split, the
 * bundled key shipped in client JS via NEXT_PUBLIC_GEMINI_API_KEY —
 * extractable from any built APK/IPA and spending the owner's own quota for
 * anyone who found it.
 */
export async function analyzeMealWithAI(
  imageBase64?: string,
  textDescription?: string
): Promise<FoodItemEstimate[]> {
  const userKey = getUserGeminiKey();
  if (userKey) {
    return analyzeWithGeminiDirect(userKey, imageBase64, textDescription);
  }

  const { isDevUser } = await import("./devMode");
  if (!(await isDevUser())) {
    throw new Error("Add your Gemini API key in Settings to use AI meal analysis.");
  }

  return analyzeWithSupabaseEdge(imageBase64, textDescription);
}

/**
 * Direct client-side call to the Gemini Developer API, using a key the
 * caller already holds (never the bundled one — see analyzeMealWithAI).
 */
async function analyzeWithGeminiDirect(
  apiKey: string,
  imageBase64?: string,
  textDescription?: string
): Promise<FoodItemEstimate[]> {
  const prompt = `
    You are a professional nutrition expert. Analyze the food described or shown in the image.
    Estimate the portion weight of each item in grams, and calculate the calories and macros (protein, carbs, fats).
    Be realistic and precise in your nutritional estimates.
    
    CRITICAL GROUNDING INSTRUCTIONS:
    1. If the food is likely a standard packaged supermarket product (e.g. "Yogurt Griego Fage", "Lala Entera", "Bimbo Cero Cero", "Coca Cola Light"), use the Google Search tool to look up the exact product's nutritional facts online in Mexico or globally, and extract the real values for calories and macros.
    2. If the food is an unpackaged, home-cooked, or raw meal (e.g. "a bowl of oatmeal with berries", "scrambled eggs", "tacos de bistec"), estimate the portion size and nutritional values based on visual appearance or textual description as a standard raw/cooked food item.
    
    You MUST respond STRICTLY with a raw JSON array of objects fitting this structure. Do not include markdown codeblocks (no \`\`\`json or \`\`\` wrappers):
    [
      {
        "food_name": "string",
        "weight_g": number,
        "calories": number,
        "protein_g": number,
        "carbs_g": number,
        "fats_g": number
      }
    ]
  `;

  const parts: any[] = [];
  
  if (imageBase64) {
    // Remove metadata prefix (e.g. data:image/jpeg;base64,) if present
    const base64Clean = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
    parts.push({
      inlineData: {
        data: base64Clean,
        mimeType: "image/jpeg"
      }
    });
  }
  
  if (textDescription) {
    parts.push({ text: textDescription });
  }
  
  parts.push({ text: prompt });

  const contents = [
    {
      role: "user",
      parts: parts
    }
  ];

  const models = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
  let lastError: any = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      let response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          tools: [{ google_search: {} }]
        }),
      });

      // If search tool fails (e.g. 429 quota limit or 400 bad requests on free key),
      // immediately retry without the search tool.
      if (response.status === 429 || !response.ok) {
        console.warn(`Search grounding failed with status ${response.status}. Retrying without search tool...`);
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents }),
        });
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Status ${response.status}: ${errText}`);
      }

      const result = await response.json();
      let rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      
      // Clean potential markdown blocks
      rawText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
      
      return JSON.parse(rawText);
    } catch (err: any) {
      console.warn(`Gemini model ${model} failed, trying next fallback...`, err);
      lastError = err;
    }
  }

  throw new Error(`Gemini API Error: ${lastError?.message || "Service Unavailable"}`);
}

/**
 * Bundled-key path: calls the analyze-meal Edge Function
 * (supabase/functions/analyze-meal) instead of Gemini directly, so the
 * bundled GEMINI_API_KEY never reaches the client. The function re-validates
 * the caller's JWT server-side and checks it against its own allowlist
 * before spending that key — same shape as supabase/functions/admin-stats.
 */
async function analyzeWithSupabaseEdge(
  imageBase64?: string,
  textDescription?: string
): Promise<FoodItemEstimate[]> {
  const { supabaseOnline } = await import("./supabase");
  if (!supabaseOnline) throw new Error("Offline");

  const { data, error } = await supabaseOnline.functions.invoke("analyze-meal", {
    body: { imageBase64, textDescription },
  });

  if (error) throw error;
  return data;
}
