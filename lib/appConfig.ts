import { supabaseOnline } from "./supabase";
import { getCached, setCache } from "./offlineQueue";
import { withTimeout } from "./auth-utils";
import type { AdminStats } from "@/types";

const AI_GLOBAL_CACHE_KEY = "appConfig:aiScannerGlobalEnabled";

/**
 * Whether the admin has enabled AI meal scanning for every user (each user
 * still needs to add their own Gemini key in Settings). Backed by the public
 * `app_settings` row — readable by anyone via RLS, writable only by the
 * allowlisted admin account (see migrations/add_admin_config.sql).
 *
 * Cached in IndexedDB so it still resolves offline after the first
 * successful fetch. Defaults to false (fail closed) when never fetched —
 * this is a cost/access control, so an unreachable flag should never
 * silently grant access.
 */
export async function isAiScannerGloballyEnabled(): Promise<boolean> {
  const cached = await getCached<boolean>(AI_GLOBAL_CACHE_KEY);
  try {
    if (!supabaseOnline) return cached ?? false;
    const { data, error } = await withTimeout(
      supabaseOnline.from("app_settings").select("ai_scanner_global_enabled").eq("id", 1).single(),
    );
    if (error) throw error;
    const enabled = !!data?.ai_scanner_global_enabled;
    await setCache(AI_GLOBAL_CACHE_KEY, enabled);
    return enabled;
  } catch {
    return cached ?? false;
  }
}

/** Admin-only write (enforced by RLS on `app_settings`, not just this UI gate). */
export async function setAiScannerGloballyEnabled(enabled: boolean): Promise<void> {
  if (!supabaseOnline) throw new Error("Offline — connect to the internet to change this setting.");
  const { error } = await withTimeout(
    supabaseOnline
      .from("app_settings")
      .update({ ai_scanner_global_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", 1),
  );
  if (error) throw error;
  await setCache(AI_GLOBAL_CACHE_KEY, enabled);
}

/**
 * Cross-user aggregate stats for the admin panel. Requires the `admin-stats`
 * Supabase Edge Function (service-role, bypasses RLS) — the client can never
 * safely query other users' rows directly. The function re-checks the
 * caller's email server-side before running any privileged query, so this
 * throws "Forbidden" for non-admin accounts even if called directly.
 */
export async function fetchAdminStats(): Promise<AdminStats> {
  if (!supabaseOnline) throw new Error("Offline — connect to the internet to view admin stats.");
  const { data, error } = await withTimeout(supabaseOnline.functions.invoke("admin-stats"), 15000);
  if (error) throw error;
  return data as AdminStats;
}
