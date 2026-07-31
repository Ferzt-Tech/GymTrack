import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Mirrors DEV_EMAILS in lib/devMode.ts — update both if the allowlist ever grows.
const ADMIN_EMAILS = ["sonluisfernando@gmail.com"];

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

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
    // Service-role client: intentionally bypasses RLS — this is the only place
    // in the app allowed to read cross-user aggregates, gated on the email
    // check below rather than row ownership.
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    const callerEmail = userData?.user?.email?.toLowerCase();
    if (userError || !callerEmail || !ADMIN_EMAILS.includes(callerEmail)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function count(table: string, filter?: (q: any) => any): Promise<number> {
      let q = admin.from(table).select("*", { count: "exact", head: true });
      if (filter) q = filter(q);
      const { count: c, error } = await q;
      if (error) throw error;
      return c ?? 0;
    }

    const [
      totalUsers,
      totalWorkoutSessions,
      totalWorkoutSets,
      totalFoodLogs,
      totalSavedFoods,
      totalExercises,
      usersWithOwnAiKey,
      newUsersLast30d,
      sessionsLast7d,
      foodLogsLast7d,
    ] = await Promise.all([
      count("profiles"),
      count("workout_sessions"),
      count("workout_sets"),
      count("food_logs"),
      count("saved_foods"),
      count("exercises"),
      count("profiles", (q) => q.not("gemini_api_key", "is", null)),
      count("profiles", (q) => q.gte("created_at", daysAgoIso(30))),
      count("workout_sessions", (q) => q.gte("created_at", daysAgoIso(7))),
      count("food_logs", (q) => q.gte("created_at", daysAgoIso(7))),
    ]);

    return new Response(
      JSON.stringify({
        totalUsers,
        totalWorkoutSessions,
        totalWorkoutSets,
        totalFoodLogs,
        totalSavedFoods,
        totalExercises,
        usersWithOwnAiKey,
        newUsersLast30d,
        sessionsLast7d,
        foodLogsLast7d,
        generatedAt: new Date().toISOString(),
      }),
      { headers: jsonHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
