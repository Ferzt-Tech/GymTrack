"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { flushQueue, getPendingCount } from "@/lib/offlineQueue";
import { refreshAuthSession } from "@/lib/auth-utils";
import { supabase } from "@/lib/supabase";

export type SyncState = "idle" | "syncing" | "done" | "offline";

interface OnlineSyncCtxValue {
  isOnline:    boolean;
  syncState:   SyncState;
  refetchKey:  number;
  triggerSync: () => void;
}

const OnlineSyncCtx = createContext<OnlineSyncCtxValue>({
  isOnline:    true,
  syncState:   "idle",
  refetchKey:  0,
  triggerSync: () => {},
});

export function OnlineSyncProvider({ children }: { children: ReactNode }) {
  const [isOnline,   setIsOnline]   = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [syncState,  setSyncState]  = useState<SyncState>("idle");
  const [refetchKey, setRefetchKey] = useState(0);
  const syncingRef = useRef(false);

  // Single flush function — shared mutex prevents race conditions from multiple
  // trigger paths (mount, online event, visibilitychange) running concurrently.
  async function runSync(forceRefetch = false) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      // Calling getSession() primes the Supabase client's internal auth state
      // from cookies/localStorage. Without this, refreshSession() can fail on
      // initial mount because the client hasn't read the stored session yet.
      await Promise.race([
        supabase.auth.getSession().then(() => {}),
        new Promise<void>(resolve => setTimeout(resolve, 4000)),
      ]);

      const count = await getPendingCount();
      if (count > 0) {
        setSyncState("syncing");
        await refreshAuthSession();
        const { synced } = await flushQueue();
        setSyncState(synced > 0 ? "done" : "idle");
        if (synced > 0) {
          setTimeout(() => setSyncState("idle"), 2500);
          // Only trigger page refetch when ops actually landed in Supabase.
          // If synced=0 (all failed) we intentionally skip the refetch so the
          // page's Supabase fetch doesn't overwrite optimistic cache entries
          // that still have pending ops waiting to be synced.
          setRefetchKey(k => k + 1);
        }
      } else if (forceRefetch) {
        // No pending ops but caller wants pages to reload stale cached data.
        setRefetchKey(k => k + 1);
      }
    } finally {
      syncingRef.current = false;
    }
  }

  // Mount: flush ops queued during a prior offline session ("closed app offline,
  // reopened online" — the 'online' event never fires in this case).
  useEffect(() => {
    if (!navigator.onLine) {
      setSyncState("offline");
      return;
    }
    runSync(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Network events + visibilitychange for the mobile background/foreground case.
  useEffect(() => {
    function handleOffline() {
      setIsOnline(false);
      setSyncState("offline");
    }

    async function handleOnline() {
      setIsOnline(true);
      // forceRefetch=true: reload page data even if no ops were queued —
      // cached data may be stale after being offline.
      await runSync(true);
    }

    // On Android/iOS (Capacitor), the JS thread is frozen while the app is
    // backgrounded. If the device reconnects during that window the 'online'
    // event is fired but never received. visibilitychange fires when the user
    // brings the app to the foreground, giving us a second chance to flush.
    async function handleVisibility() {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      await runSync(false);
    }

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire-and-forget flush for components to call after a queued fallback.
  // runSync's mutex prevents concurrent flushes if called rapidly.
  function triggerSync() { runSync(false); }

  return (
    <OnlineSyncCtx.Provider value={{ isOnline, syncState, refetchKey, triggerSync }}>
      {children}
    </OnlineSyncCtx.Provider>
  );
}

export function useOnlineSync(): OnlineSyncCtxValue {
  return useContext(OnlineSyncCtx);
}
