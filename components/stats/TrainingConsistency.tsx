"use client";

import { useT } from "@/lib/context/LanguageContext";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";

export interface WeekFrequency { week: string; count: number; }

interface Props {
  /** Last 12 weeks, oldest → newest, ending at the current week. */
  weeks: WeekFrequency[];
  streakWeeks: number;
  isOffline?: boolean;
}

export default function TrainingConsistency({ weeks, streakWeeks, isOffline }: Props) {
  const t = useT();
  const hasData = weeks.some(w => w.count > 0);

  if (!hasData) {
    return isOffline
      ? <OfflinePlaceholder className="py-2" />
      : <p className="text-[13px] text-[var(--faint)] text-center py-4">{t.trainingConsistency.noData}</p>;
  }

  const max = Math.max(1, ...weeks.map(w => w.count));
  const avg = Math.round((weeks.reduce((s, w) => s + w.count, 0) / weeks.length) * 10) / 10;
  const thisWeek = weeks[weeks.length - 1]?.count ?? 0;

  const tiles = [
    { value: streakWeeks, label: t.trainingConsistency.streak, accent: true },
    { value: thisWeek,    label: t.trainingConsistency.thisWeek },
    { value: avg,         label: t.trainingConsistency.weeklyAvg },
  ];

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-5">
        {tiles.map(({ value, label, accent }) => (
          <div key={label} className="rounded-xl p-3 flex flex-col gap-1 bg-[var(--accent-faint)]">
            <span
              className="metric text-[20px] font-semibold leading-none"
              style={{ color: accent ? "var(--accent)" : "var(--text)" }}
            >
              {value}
            </span>
            <span className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider leading-tight mt-0.5">
              {label}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-end justify-between gap-1 h-14">
        {weeks.map((w, i) => (
          <div key={i} className="flex-1 h-full flex items-end" title={`${w.week} · ${w.count}`}>
            <div
              className="w-full rounded-sm transition-all duration-500"
              style={{
                height:     `${w.count > 0 ? Math.max(10, (w.count / max) * 100) : 4}%`,
                background: w.count > 0 ? "var(--accent)" : "var(--border)",
                opacity:    w.count > 0 ? 0.45 + 0.55 * (w.count / max) : 1,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[9px] font-mono text-[var(--faint)]">{weeks[0]?.week}</span>
        <span className="text-[9px] font-mono text-[var(--faint)]">{weeks[weeks.length - 1]?.week}</span>
      </div>
    </div>
  );
}
