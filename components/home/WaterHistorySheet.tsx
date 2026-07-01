"use client";

import { useMemo } from "react";
import type { WaterLog } from "@/types";
import { useT } from "@/lib/context/LanguageContext";

interface Props {
  open: boolean;
  onClose: () => void;
  logs: WaterLog[];
  goal: number;
}

export default function WaterHistorySheet({ open, onClose, logs, goal }: Props) {
  const t = useT();

  const { days, streak, sevenDayAvg } = useMemo(() => {
    const logMap = new Map(logs.map(l => [l.logged_date, l.amount_liters]));

    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
      const label = d.toLocaleDateString(t.locale, { month: "short", day: "numeric" });
      const amount = logMap.get(iso) ?? 0;
      return { iso, label, amount };
    });

    // Skip today if no data yet so a partial day doesn't break the streak
    let streak = 0;
    const start = days[0].amount === 0 ? 1 : 0;
    for (let i = start; i < days.length; i++) {
      if (days[i].amount >= goal) streak++;
      else break;
    }

    const sevenDayAvg = days.slice(0, 7).reduce((s, d) => s + d.amount, 0) / 7;

    return { days, streak, sevenDayAvg };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, goal, t.locale]);

  const maxAmount = Math.max(goal * 1.2, ...days.map(d => d.amount));
  const chartDays = [...days].reverse();

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div
        className={`glass-sheet absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-[var(--border)] transition-transform duration-300 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
        </div>

        <div className="px-4 pb-8 space-y-4">
          <div className="flex items-center justify-between">
            <p className="section-label mb-0">{t.waterHistory.waterHistory}</p>
            <button
              onClick={onClose}
              className="text-[var(--faint)] hover:text-[var(--muted)] text-xl leading-none transition-colors"
            >
              ×
            </button>
          </div>

          <div className="flex gap-3">
            <div className="card-glass p-3 flex-1 text-center">
              <p className="text-[11px] text-[var(--faint)] mb-0.5">{t.waterHistory.streak}</p>
              <p className="text-[var(--text)] font-semibold text-sm">
                {t.waterHistory.streakDays(streak)}
              </p>
            </div>
            <div className="card-glass p-3 flex-1 text-center">
              <p className="text-[11px] text-[var(--faint)] mb-0.5">{t.waterHistory.sevenDayAvg}</p>
              <p className="text-[var(--text)] font-semibold text-sm metric">
                {sevenDayAvg.toFixed(1)}L
              </p>
            </div>
          </div>

          <div className="flex items-end gap-0.5 h-16">
            {chartDays.map(day => {
              const pct = maxAmount > 0 ? Math.max(4, (day.amount / maxAmount) * 100) : 4;
              const color =
                day.amount >= goal ? "var(--accent)" :
                day.amount > 0    ? "var(--text)"   :
                                    "var(--border)";
              return (
                <div
                  key={day.iso}
                  className="flex-1 rounded-sm transition-all duration-300"
                  style={{ height: `${pct}%`, backgroundColor: color }}
                />
              );
            })}
          </div>
          <p className="text-[10px] text-[var(--faint)] text-center -mt-2">{t.waterHistory.last30Days}</p>

          <div className="divider" />

          <div className="space-y-2.5 max-h-56 overflow-y-auto">
            {days.map(day => {
              const pct = goal > 0 ? Math.min(100, Math.round((day.amount / goal) * 100)) : 0;
              const barColor =
                day.amount >= goal ? "var(--accent)" :
                day.amount > 0    ? "var(--text)"   :
                                    "var(--border)";
              return (
                <div key={day.iso} className="flex items-center gap-3 text-[12px]">
                  <span className="text-[var(--faint)] w-14 shrink-0">{day.label}</span>
                  <span className="text-[var(--text)] w-12 shrink-0 metric">{day.amount.toFixed(2)}L</span>
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: barColor }}
                    />
                  </div>
                  <span className="text-[var(--faint)] w-9 text-right shrink-0">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
