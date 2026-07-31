import { getCached, setCache } from "./offlineQueue";
import { supabaseOnline } from "./supabase";

/**
 * Developer mode — gates dev-only features (currently the AI meal scanner).
 *
 * Access is granted by account email. The email is cached in IndexedDB
 * (`auth:userEmail`, written on every auth state change) so the check works
 * fully offline after the first sign-in. Guest users have no email and are
 * never dev users.
 *
 * NOTE: this is a UI/UX gate, not a security boundary — the app is a static
 * client bundle, so anything shipped in it (including NEXT_PUBLIC_* keys)
 * is readable by any user. Real enforcement would need a server-side proxy
 * (e.g. the Supabase Edge Function variant in lib/foodAi.ts).
 */
export const DEV_EMAILS = ["sonluisfernando@gmail.com"];

const AI_TOGGLE_KEY = "gymtrack:dev_ai_enabled";

export async function resolveUserEmail(): Promise<string | null> {
  // Fast path: IndexedDB cache (works offline, <5ms)
  const cached = await getCached<string>("auth:userEmail");
  if (cached) return cached;

  // Slow path: live session with a timeout guard (same pattern as resolveUserId)
  try {
    if (!supabaseOnline) return null;
    const result = await Promise.race([
      supabaseOnline.auth.getSession(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const email = (result as any)?.data?.session?.user?.email ?? null;
    if (email) await setCache("auth:userEmail", email);
    return email;
  } catch {
    return null;
  }
}

export async function isDevUser(): Promise<boolean> {
  const email = await resolveUserEmail();
  return !!email && DEV_EMAILS.includes(email.toLowerCase());
}

/** Dev-local preference: lets the dev switch the AI scanner off without signing out. */
export function isAiScannerEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(AI_TOGGLE_KEY) !== "false";
}

export function setAiScannerEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AI_TOGGLE_KEY, enabled ? "true" : "false");
}

/**
 * Gate used by the food logger.
 * - Owner account (allowlisted): always eligible, using either their own saved
 *   key or the bundled dev key (dev AI toggle).
 * - Everyone else: eligible only when the admin has enabled AI scanning for
 *   all users (lib/appConfig.ts `isAiScannerGloballyEnabled`) AND they have
 *   added their own Gemini key in Settings — the global flag alone never
 *   grants access to the bundled key, since that would run AI calls on the
 *   owner's account/quota for every user.
 */
export async function canUseAiScanner(): Promise<boolean> {
  const isDev = await isDevUser();
  const { getUserGeminiKey } = await import("./foodAi");

  if (isDev) {
    if (getUserGeminiKey()) return true;
    return isAiScannerEnabled();
  }

  if (!getUserGeminiKey()) return false;
  const { isAiScannerGloballyEnabled } = await import("./appConfig");
  return isAiScannerGloballyEnabled();
}
