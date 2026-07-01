"use client";

import { formatDistanceToNow } from "date-fns";
import { useT } from "@/lib/context/LanguageContext";

interface Props {
  title?: string;
  subtitle?: string;
  lastSyncedAt?: Date | null;
  className?: string;
}

export default function OfflinePlaceholder({ title, subtitle, lastSyncedAt, className }: Props) {
  const t = useT();
  const displayTitle = title ?? t.offline.availableWhenConnected;
  const computedSub = lastSyncedAt ? t.offline.lastSyncedAgo(formatDistanceToNow(lastSyncedAt)) : undefined;
  const displaySub = subtitle ?? computedSub;

  return (
    <div className={`card flex flex-col items-center justify-center py-10 animate-spring-scale gap-3${className ? ` ${className}` : ""}`}>
      <svg
        width="32" height="32" viewBox="0 0 24 24" fill="none"
        stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <div className="text-center">
        <p className="text-sm font-medium" style={{ color: "var(--muted)" }}>{displayTitle}</p>
        {displaySub && (
          <p className="text-[11px] mt-1" style={{ color: "var(--faint)" }}>{displaySub}</p>
        )}
      </div>
    </div>
  );
}
