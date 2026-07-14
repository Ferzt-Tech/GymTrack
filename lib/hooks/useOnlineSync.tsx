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
  const retryTimerRef = useRef<any>(null);

  async function runSync(forceRefetch = false, retryAttempt = 0) {
    if (syncingRef.current) return;
    syncingRef.current = true;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

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
        const { synced, failed } = await flushQueue();
        
        if (synced > 0 && failed === 0) {
          setSyncState("done");
          setTimeout(() => setSyncState("idle"), 2500);
          setRefetchKey(k => k + 1);
        } else if (synced > 0 && failed > 0) {
          setSyncState("done");
          setTimeout(() => setSyncState("idle"), 2500);
          setRefetchKey(k => k + 1);
          if (typeof navigator !== "undefined" && navigator.onLine && retryAttempt < 3) {
            retryTimerRef.current = setTimeout(() => {
              runSync(false, retryAttempt + 1);
            }, 5000);
          }
        } else if (synced === 0 && failed > 0) {
          setSyncState("offline");
          if (typeof navigator !== "undefined" && navigator.onLine && retryAttempt < 3) {
            retryTimerRef.current = setTimeout(() => {
              runSync(false, retryAttempt + 1);
            }, 5000);
          } else {
            setTimeout(() => setSyncState("idle"), 2500);
          }
        } else {
          setSyncState("idle");
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
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
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
