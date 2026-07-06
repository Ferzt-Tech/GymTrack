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

  async function runSync(forceRefetch = false) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      if (supabase.auth) {
        await Promise.race([
          supabase.auth.getSession().then(() => {}),
          new Promise<void>(resolve => setTimeout(resolve, 4000)),
        ]);
      }

      const count = await getPendingCount();
      if (count > 0) {
        setSyncState("syncing");
        await refreshAuthSession();
        const { synced } = await flushQueue();
        setSyncState(synced > 0 ? "done" : "idle");
        if (synced > 0) {
          setTimeout(() => setSyncState("idle"), 2500);
          setRefetchKey(k => k + 1);
        }
      } else if (forceRefetch) {
        setRefetchKey(k => k + 1);
      }
    } finally {
      syncingRef.current = false;
    }
  }

  useEffect(() => {
    if (!navigator.onLine) {
      setSyncState("offline");
      return;
    }
    runSync(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleOffline() {
      setIsOnline(false);
      setSyncState("offline");
    }

    async function handleOnline() {
      setIsOnline(true);
      await runSync(true);
    }

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
