"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCached, setCache, enqueue } from "@/lib/offlineQueue";
import { resolveUserId, withTimeout } from "@/lib/auth-utils";
import type { Profile } from "@/types";

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const userId = await resolveUserId();

      if (!isMounted) return;
      if (!userId) { setLoading(false); return; }

      // Offline: serve profile from IndexedDB cache.
      if (!navigator.onLine) {
        const cached = await getCached<Profile>(`profile:${userId}`);
        if (isMounted) { setProfile(cached ?? null); setLoading(false); }
        return;
      }

      // Online: fetch fresh profile, seed both caches.
      await setCache("auth:userId", userId);

      try {
        const { data } = await withTimeout(
          supabase.from("profiles").select("*").eq("id", userId).single(),
        );
        if (isMounted) {
          if (data) {
            setProfile(data);
            await setCache(`profile:${userId}`, data);
          }
          setLoading(false);
        }
      } catch {
        const cached = await getCached<Profile>(`profile:${userId}`);
        if (isMounted) { setProfile(cached ?? null); setLoading(false); }
      }
    }
    load();
    return () => { isMounted = false; };
  }, []);

  async function updateProfile(updates: Partial<Profile>) {
    const userId = await resolveUserId();
    if (!userId) return;

    if (!navigator.onLine) {
      await enqueue({
        type: "upsert",
        table: "profiles",
        payload: { id: userId, ...updates, updated_at: new Date().toISOString() },
        conflictOn: "id",
      });
      setProfile(prev => prev ? { ...prev, ...updates } : null);
      await setCache(`profile:${userId}`, { ...(profile ?? {}), ...updates, id: userId } as Profile);
      return;
    }

    try {
      const { data } = await withTimeout(
        supabase
          .from("profiles")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("id", userId)
          .select()
          .single(),
      );
      if (data) {
        setProfile(data);
        await setCache(`profile:${userId}`, data);
      }
    } catch {
      // Queue for retry when back online
      await enqueue({
        type: "upsert",
        table: "profiles",
        payload: { id: userId, ...updates, updated_at: new Date().toISOString() },
        conflictOn: "id",
      });
      setProfile(prev => prev ? { ...prev, ...updates } : null);
    }
  }

  return { profile, loading, updateProfile };
}
