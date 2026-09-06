import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Mirrors DEV_EMAILS in lib/devMode.ts — update all three if the allowlist
// ever grows (also duplicated in migrations/add_admin_config.sql's RLS check
// and supabase/functions/admin-stats/index.ts's ADMIN_EMAILS).
const DEV_EMAILS = ["sonluisfernando@gmail.com"];

const PROMPT = `
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

// Kept in sync with the MODELS fallback list lib/foodAi.ts uses for the
// bring-your-own-key path — same models, same fallback order.
const MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];

Deno.serve(async (req: Request) => {
  const jsonHeaders = { "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    const callerEmail = userData?.user?.email?.toLowerCase();
    // This function exists to protect the bundled Gemini key, which only the
    // allowlisted owner account is entitled to spend (see canUseAiScanner()
    // in lib/devMode.ts) — everyone else brings their own key and calls
    // Gemini directly from the client, so they never need this proxy.
    if (userError || !callerEmail || !DEV_EMAILS.includes(callerEmail)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: "Gemini API key is not configured on the server" }),
        { status: 500, headers: jsonHeaders },
      );
    }

    const { imageBase64, textDescription } = await req.json();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];
    if (imageBase64) {
      const base64Clean = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
      parts.push({ inlineData: { data: base64Clean, mimeType: "image/jpeg" } });
    }
    if (textDescription) parts.push({ text: textDescription });
    parts.push({ text: PROMPT });

    const contents = [{ role: "user", parts }];

    let lastError: string | null = null;
    for (const model of MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        let response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents, tools: [{ google_search: {} }] }),
        });

        // If search grounding fails (e.g. 429 quota or 400 on this key),
        // immediately retry without the search tool.
        if (response.status === 429 || !response.ok) {
          response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents }),
          });
        }

        if (!response.ok) {
          throw new Error(`Status ${response.status}: ${await response.text()}`);
        }

        const result = await response.json();
        let rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
        rawText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();

        return new Response(rawText, { headers: jsonHeaders });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return new Response(
      JSON.stringify({ error: `Gemini API Error: ${lastError ?? "Service Unavailable"}` }),
      { status: 502, headers: jsonHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
