"use client";

import { useT } from "@/lib/context/LanguageContext";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";

export interface PRRecord {
  name:      string;
  e1rm:      number;
  e1rmDate:  string;
  isRecent:  boolean;
}

interface Props {
  records: PRRecord[];
  unit: string;
  isOffline?: boolean;
}

export default function PersonalRecords({ records, unit, isOffline }: Props) {
  const t = useT();

  if (!records.length) {
    return isOffline
      ? <OfflinePlaceholder className="py-2" />
      : <p className="text-[13px] text-[var(--faint)] text-center py-4">{t.personalRecords.noData}</p>;
  }

  return (
    <div className="space-y-2.5">
      {records.map(r => (
        <div key={r.name} className="flex items-center justify-between gap-2 rounded-xl p-3 bg-[var(--accent-faint)]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-[var(--text)] truncate">{r.name}</span>
              {r.isRecent && (
                <span className="sector-readout px-1.5 py-0 text-[8px] shrink-0">{t.personalRecords.new}</span>
              )}
            </div>
            <p className="text-[9px] font-mono text-[var(--faint)] mt-0.5">{r.e1rmDate}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="metric text-[16px] font-semibold text-[var(--accent)] leading-none">
              {r.e1rm} {unit}
            </p>
            <p className="text-[9px] font-mono text-[var(--faint)] mt-0.5 uppercase tracking-wider">
              {t.personalRecords.e1rm}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
