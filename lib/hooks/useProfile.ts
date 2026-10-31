"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCached, setCache, enqueue, getPendingCount } from "@/lib/offlineQueue";
import { resolveUserId, withTimeout } from "@/lib/auth-utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import type { Profile } from "@/types";

/* Every component calling useProfile() holds its own copy. The dashboard
   layout's copy drives the water reminder, and Settings saves through another
   — so turning reminders off kept them firing until a restart (the layout only
   re-read after a sync, which a direct online save never triggers). Each save
   is broadcast and every instance adopts it. */
const PROFILE_UPDATED = "gymtrack:profile-updated";

function broadcastProfile(next: Profile) {
  window.dispatchEvent(new CustomEvent<Profile>(PROFILE_UPDATED, { detail: next }));
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const { refetchKey, triggerSync } = useOnlineSync();

  useEffect(() => {
    function onUpdated(e: Event) {
      const next = (e as CustomEvent<Profile>).detail;
      setProfile(prev => (!prev || prev.id === next.id ? next : prev));
    }
    window.addEventListener(PROFILE_UPDATED, onUpdated);
    return () => window.removeEventListener(PROFILE_UPDATED, onUpdated);
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const userId = await resolveUserId();

      if (!isMounted) return;
      if (!userId) { setLoading(false); return; }

      const cacheKey = `profile:${userId}`;

      async function fromCache() {
        const cached = await getCached<Profile>(cacheKey);
        if (isMounted) {
          if (cached) {
            setProfile(cached);
          } else if (userId === "guest-user") {
            const guestProfile: Profile = {
              id: "guest-user",
              username: "Guest",
              weight_unit: "kg",
              distance_unit: "km",
              water_goal_liters: 2.5,
              water_reminder_enabled: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            setProfile(guestProfile);
            await setCache(cacheKey, guestProfile);
          } else {
            setProfile(null);
          }
          setLoading(false);
        }
      }

      // Always load from cache first
      await fromCache();

      // Offline or guest: we are done
      if (!navigator.onLine || userId === "guest-user") {
        return;
      }

      // Online: check if there are pending ops in the queue.
      // If so, skip fetching from Supabase because OnlineSyncProvider will flush them
      // and increment refetchKey, which will trigger this load() again when finished.
      const pendingCount = await getPendingCount();
      if (pendingCount > 0) {
        if (isMounted) setLoading(false);
        return;
      }

      // Online: fetch fresh profile, seed both caches.
      await setCache("auth:userId", userId);

      try {
        const { data, error } = await withTimeout(
          supabase.from("profiles").select("*").eq("id", userId).single(),
        );
        if (error) console.error("Failed to fetch profile, keeping cached data:", error);
        if (isMounted) {
          if (data) {
            setProfile(data);
            await setCache(cacheKey, data);
          }
          setLoading(false);
        }
      } catch {
        // Keep the already loaded cache data
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => { isMounted = false; };
  }, [refetchKey]);

  async function queueProfileUpdate(userId: string, updates: Partial<Profile>) {
    await enqueue({
      type: "upsert",
      table: "profiles",
      payload: { id: userId, ...updates, updated_at: new Date().toISOString() },
      conflictOn: "id",
    });
    const merged = { ...(profile ?? {}), ...updates, id: userId } as Profile;
    setProfile(prev => prev ? { ...prev, ...updates } : null);
    await setCache(`profile:${userId}`, merged);
    broadcastProfile(merged);
  }

  async function updateProfile(updates: Partial<Profile>) {
    const userId = await resolveUserId();
    if (!userId) return;

    if (!navigator.onLine || userId === "guest-user") {
      await queueProfileUpdate(userId, updates);
      return;
    }

    try {
      const { data, error } = await withTimeout(
        supabase
          .from("profiles")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("id", userId)
          .select()
          .single(),
      );
      if (error) throw error;
      if (data) {
        setProfile(data);
        await setCache(`profile:${userId}`, data);
        broadcastProfile(data);
      }
    } catch {
      // Queue for retry when back online
      await queueProfileUpdate(userId, updates);
      triggerSync();
    }
  }

  return { profile, loading, updateProfile };
}
