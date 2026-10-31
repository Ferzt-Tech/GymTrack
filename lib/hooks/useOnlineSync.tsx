"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { flushQueue, getPendingCount, enqueue, type PendingOp } from "@/lib/offlineQueue";
import { refreshAuthSession, withTimeout } from "@/lib/auth-utils";
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
  const [syncState,  setSyncState]  = useState<SyncState>(() =>
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "idle"
  );
  const [refetchKey, setRefetchKey] = useState(0);
  const syncingRef = useRef(false);
  /* Set when a sync is requested while one is already running. flushQueue reads
     the queue once up front, so ops enqueued mid-flush (e.g. the PR rows written
     right after a workout's save_workout) would otherwise sit until the next
     visibilitychange/online event. null = no rerun; else its forceRefetch. */
  const rerunRef = useRef<boolean | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function runSync(forceRefetch = false, retryAttempt = 0) {
    if (syncingRef.current) {
      rerunRef.current = (rerunRef.current ?? false) || forceRefetch;
      return;
    }
    syncingRef.current = true;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    try {
      if (supabase.auth) {
        // Swallow a timeout and proceed anyway — this is a best-effort session
        // warm-up before flushing, not a gate on whether syncing happens.
        await withTimeout(supabase.auth.getSession(), 4000).catch(() => {});
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
          // A single automatic follow-up covers the common "reconnect landed
          // mid-refresh" blip; the queue's own per-op exponential backoff
          // (lib/offlineQueue.ts) already retries anything still stuck after
          // that, and the next natural trigger (visibilitychange, another
          // online event, or any triggerSync() call) will pick it up too —
          // looping here 3x at 5s apiece just piles latency onto a
          // still-bad connection without changing the eventual outcome.
          if (typeof navigator !== "undefined" && navigator.onLine && retryAttempt < 1) {
            retryTimerRef.current = setTimeout(() => {
              runSync(false, retryAttempt + 1);
            }, 5000);
          }
        } else if (synced === 0 && failed > 0) {
          setSyncState("offline");
          if (typeof navigator !== "undefined" && navigator.onLine && retryAttempt < 1) {
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
      const rerun = rerunRef.current;
      rerunRef.current = null;
      if (rerun !== null) void runSync(rerun);
    }
  }

  useEffect(() => {
    if (!navigator.onLine) return;
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

/**
 * Thin wrapper around the `enqueue(op); triggerSync();` pair that every
 * local-first-always training write repeats (see CLAUDE.md's "Training-specific:
 * local-first-always writes"). Deliberately does nothing else — each call
 * site's own try/catch/finally and local-state-update logic stays exactly as
 * it was, since that part genuinely differs per call site. A thrown error from
 * `enqueue` still propagates to the caller's own catch block.
 */
export function useLocalFirstWrite(): (op: PendingOp) => Promise<void> {
  const { triggerSync } = useOnlineSync();
  return async function localFirstWrite(op: PendingOp): Promise<void> {
    await enqueue(op);
    triggerSync();
  };
}
