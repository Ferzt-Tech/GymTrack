"use client";

import { useT } from "@/lib/context/LanguageContext";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";

export interface RepRangeData { strength: number; hypertrophy: number; endurance: number; }

interface Props {
  data: RepRangeData;
  isOffline?: boolean;
}

export default function RepRangeFocus({ data, isOffline }: Props) {
  const t = useT();
  const total = data.strength + data.hypertrophy + data.endurance;

  if (total === 0) {
    return isOffline
      ? <OfflinePlaceholder className="py-2" />
      : <p className="text-[13px] text-[var(--faint)] text-center py-4">{t.repRangeFocus.noData}</p>;
  }

  const segments = [
    { key: "strength",    label: t.repRangeFocus.strength,    sub: "1-5",  value: data.strength,    color: "var(--chart-5)" },
    { key: "hypertrophy", label: t.repRangeFocus.hypertrophy, sub: "6-12", value: data.hypertrophy, color: "var(--accent)" },
    { key: "endurance",   label: t.repRangeFocus.endurance,   sub: "13+",  value: data.endurance,   color: "var(--chart-4)" },
  ];

  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden mb-4 bg-[var(--border)]">
        {segments.map(s => s.value > 0 && (
          <div key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {segments.map(s => (
          <div key={s.key} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-[11px] font-medium text-[var(--text)]">{s.label}</span>
            </div>
            <span className="metric text-[15px] font-semibold text-[var(--text)] leading-none">
              {Math.round((s.value / total) * 100)}%
            </span>
            <span className="text-[9px] font-mono text-[var(--faint)]">{s.sub} · {s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
