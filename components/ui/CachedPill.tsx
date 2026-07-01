"use client";

import { formatDistanceToNow } from "date-fns";
import { useT } from "@/lib/context/LanguageContext";

interface Props {
  cachedAt?: Date | null;
}

export default function CachedPill({ cachedAt }: Props) {
  const t = useT();
  const label = cachedAt
    ? t.offline.cachedAgo(formatDistanceToNow(cachedAt))
    : t.offline.cached;
  return (
    <span className="bg-amber-500/10 text-amber-500 dark:text-amber-400 text-[10px] font-medium px-2 py-0.5 rounded-full">
      {label}
    </span>
  );
}
