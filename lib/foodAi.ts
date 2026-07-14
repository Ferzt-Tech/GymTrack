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
  const contents: any[] = [];
  
  if (imageBase64) {
    // Remove metadata prefix (e.g. data:image/jpeg;base64,) if present
    const base64Clean = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
    contents.push({
      inlineData: {
        data: base64Clean,
        mimeType: "image/jpeg"
      }
    });
  }
  
  if (textDescription) {
    contents.push({ text: textDescription });
  }
  
  contents.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
  }

  const result = await response.json();
  let rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  
  // Clean potential markdown blocks
  rawText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
  
  try {
    return JSON.parse(rawText);
  } catch (e) {
    console.error("Failed to parse Gemini AI response:", rawText, e);
    throw new Error("AI returned an invalid JSON response structure.");
  }
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
