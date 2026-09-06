"use client";

import { useEffect, useState } from "react";
import { getQueueStats, retryFailedOps } from "@/lib/offlineQueue";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import { useT } from "@/lib/context/LanguageContext";

/**
 * Surfaces permanently-parked sync ops (see lib/offlineQueue.ts's exponential
 * backoff + poison-pill parking) that getPendingCount() deliberately excludes
 * — that exclusion keeps the main sync banner from spinning forever on an op
 * that will never resolve on its own, but before this component existed a
 * parked op was otherwise invisible: its write stayed safe in IndexedDB, but
 * nothing ever told the user the upload had given up.
 *
 * Deliberately a separate, additive check rather than folded into the main
 * banner's isOnline/syncState — those two signals must stay orthogonal (see
 * getPendingCount's own doc comment).
 */
export default function SyncStatusBadge() {
  const t = useT();
  const { syncState, triggerSync } = useOnlineSync();
  const [failedCount, setFailedCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getQueueStats().then(stats => { if (!cancelled) setFailedCount(stats.failed); });
    return () => { cancelled = true; };
    // Recheck whenever a flush cycle finishes — that's the only time the
    // parked count can change on its own (a fresh op giving up after 8
    // attempts); a manual retry below re-checks explicitly too.
  }, [syncState]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryFailedOps();
      triggerSync();
      const stats = await getQueueStats();
      setFailedCount(stats.failed);
    } finally {
      setRetrying(false);
    }
  }

  if (failedCount === 0) return null;

  return (
    <div className="mx-4 mb-1 px-3 py-1.5 rounded-xl text-[11px] font-medium flex items-center justify-between gap-2 bg-amber-500/15 text-amber-600 dark:text-amber-400">
      <span>{t.nav.syncFailed(failedCount)}</span>
      <button
        type="button"
        onClick={handleRetry}
        disabled={retrying}
        className="shrink-0 underline underline-offset-2 disabled:opacity-50"
      >
        {retrying ? t.nav.retrying : t.nav.retry}
      </button>
    </div>
  );
}
