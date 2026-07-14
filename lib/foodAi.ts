export interface FoodItemEstimate {
  food_name: string;
  weight_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
}

/**
 * Extensible entry point to analyze food using AI.
 * To change the underlying AI provider (Gemini direct, Supabase Edge Function, OpenAI, Claude),
 * simply swap out the internal call here.
 */
export async function analyzeMealWithAI(
  imageBase64?: string,
  textDescription?: string
): Promise<FoodItemEstimate[]> {
  // Option 1: Direct client-side integration using the official Gemini Developer API (Current default)
  return analyzeWithGeminiDirect(imageBase64, textDescription);

  // Option 2 (Future/Production): Secure proxy call via a Supabase Edge Function
  // return analyzeWithSupabaseEdge(imageBase64, textDescription);
}

/**
 * Direct client-side implementation of Gemini 2.5 Flash
 */
async function analyzeWithGeminiDirect(
  imageBase64?: string,
  textDescription?: string
): Promise<FoodItemEstimate[]> {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || (window as any).NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Gemini API Key is not configured. Please add NEXT_PUBLIC_GEMINI_API_KEY to your .env.local file or configure it in Settings."
    );
  }

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

  // Standard fetch payload targeting gemini-2.5-flash
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
 * Example future secure serverless proxy function.
 * Moves key management to the backend and works around CORS.
 */
async function _analyzeWithSupabaseEdge(
  imageBase64?: string,
  textDescription?: string
): Promise<FoodItemEstimate[]> {
  const { supabaseOnline } = await import("./supabase");
  if (!supabaseOnline) throw new Error("Offline");

  const { data, error } = await supabaseOnline.functions.invoke("analyze-food", {
    body: { imageBase64, textDescription },
  });

  if (error) throw error;
  return data;
}
