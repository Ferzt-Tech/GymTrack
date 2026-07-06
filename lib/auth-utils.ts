import { supabase } from "./supabase";
import { getCached, setCache } from "./offlineQueue";

/**
 * Resolves the current userId without blocking on network.
 *
 * Priority:
 *   1. IndexedDB cache  — instant, zero network (<5ms)
 *   2. supabase.auth.getSession() with 4s hard timeout
 *
 * Root problem this solves: when the JWT is expired and the device is on
 * WiFi-with-no-internet (common in Android emulator / real device testing),
 * Supabase's token-refresh request hangs for 30-75 seconds (TCP timeout).
 * Every page that called `await supabase.auth.getSession()` would silently
 * freeze, keeping the skeleton loading state up indefinitely.
 *
 * When a userId is found from the Supabase session it is written to the
 * IndexedDB cache so all subsequent calls (including offline ones) resolve
 * in <5ms without touching the network.
 */
export async function resolveUserId(): Promise<string | null> {
  // Fast path: IndexedDB (no network, set on login / every online load)
  const cached = await getCached<string>("auth:userId");
  if (cached) return cached;

  // Slow path: Supabase session with timeout guard
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
    ]);
    const userId = result?.data?.session?.user?.id ?? null;
    if (userId) await setCache("auth:userId", userId);
    return userId;
  } catch {
    return null;
  }
}

/**
 * Forces a JWT refresh before querying Supabase on reconnect.
 * Must run before flushQueue / refetchKey increment so RLS sees a valid auth.uid().
 */
export async function refreshAuthSession(): Promise<void> {
  try {
    const result = await Promise.race([
      supabase.auth.refreshSession(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
    ]);
    const userId = (result as { data?: { session?: { user?: { id?: string } } } } | null)
      ?.data?.session?.user?.id ?? null;
    if (userId) await setCache("auth:userId", userId);
  } catch {
    // noop — cached userId still works for reads
  }
}

/**
 * Wraps any Promise with a hard timeout so it throws rather than hanging.
 * Default 8s covers slow mobile connections while preventing the 30-75s
 * TCP timeout that occurs on WiFi-with-no-internet.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms = 8000): Promise<any> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}
