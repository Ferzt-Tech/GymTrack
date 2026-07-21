"use client";

import {
  BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { useTheme } from "@/lib/context/ThemeContext";
import { useT } from "@/lib/context/LanguageContext";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";

interface WeekDatum { week: string; volume: number; sessions: number; sets: number; }
interface Totals    { volume: number; sessions: number; sets: number; avgRpe: number | null; }

interface Props {
  data: { weeks: WeekDatum[]; totals: Totals };
  unit: string;
  isOffline?: boolean;
}

export default function MonthlyReport({ data, unit, isOffline }: Props) {
  const { theme } = useTheme();
  const t         = useT();
  const isDark    = theme === "dark";

  const { weeks, totals } = data;
  const axisColor = isDark ? "#3a3a3a"  : "#b0b0b0";
  const barColor  = isDark ? "#67e8f9"  : "#22d3ee";  /* --chart-1 cyan bars */

  const volDisplay = totals.volume > 0 ? totals.volume.toLocaleString() : "—";

  const summaryItems = [
    { label: t.monthlyReport.sessions,     value: totals.sessions || "—" },
    { label: t.monthlyReport.totalSets,    value: totals.sets     || "—" },
    { label: t.monthlyReport.volume(unit), value: volDisplay        },
    ...(totals.avgRpe != null ? [{ label: t.monthlyReport.avgRpe, value: totals.avgRpe }] : []),
  ];

  return (
    <div>
      <div className={`grid gap-2 mb-5 ${summaryItems.length === 4 ? "grid-cols-2" : "grid-cols-3"}`}>
        {summaryItems.map(({ label, value }) => (
          <div
            key={label}
            className="rounded-xl p-3 flex flex-col gap-1 bg-[var(--accent-faint)]"
          >
            <span className="metric text-[20px] font-semibold text-[var(--text)] leading-none">
              {value}
            </span>
            <span className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider leading-tight mt-0.5">
              {label}
            </span>
          </div>
        ))}
      </div>

      {weeks.length > 0 ? (
        <>
          <p className="section-label mb-3">
            {t.monthlyReport.weeklyVolume(unit)}
          </p>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={weeks} margin={{ top: 0, right: 0, left: -28, bottom: 0 }} barSize={20}>
              <XAxis
                dataKey="week"
                tick={{ fill: axisColor, fontSize: 9 }} axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fill: axisColor, fontSize: 9 }} axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background:           isDark ? "rgba(16,16,16,0.82)" : "rgba(255,255,255,0.82)",
                  backdropFilter:       "blur(16px) saturate(160%)",
                  WebkitBackdropFilter: "blur(16px) saturate(160%)",
                  border:               isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.70)",
                  borderRadius:         "12px",
                  color:                isDark ? "#67e8f9" : "#22d3ee",
                  fontSize:             "11px",
                  fontFamily:           "ui-monospace, monospace",
                }}
                formatter={(value: number) => [`${value.toLocaleString()} ${unit}`, t.monthlyReport.volumeTooltip]}
              />
              <Bar dataKey="volume" fill={barColor} radius={[4, 4, 0, 0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </>
      ) : (
        isOffline
          ? <OfflinePlaceholder className="py-2" />
          : <p className="text-[13px] text-[var(--faint)] text-center py-4">
              {t.monthlyReport.noData}
            </p>
      )}
    </div>
  );
}
