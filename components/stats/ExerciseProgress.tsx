"use client";

import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { useTheme } from "@/lib/context/ThemeContext";
import { useT } from "@/lib/context/LanguageContext";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";
import { chartAxisColor, chartCyan, chartTooltipStyle } from "@/lib/chartTheme";

export interface ProgressPoint { date: string; e1rm: number; top: number; }

interface Props {
  /** Per-exercise e1RM series, already in the display unit, oldest first. */
  data: Record<string, ProgressPoint[]>;
  unit: string;
  isOffline?: boolean;
}

export default function ExerciseProgress({ data, unit, isOffline }: Props) {
  const { theme } = useTheme();
  const t         = useT();
  const isDark    = theme === "dark";

  const names = Object.keys(data);
  const [selected, setSelected] = useState<string>(names[0] ?? "");
  const active = names.includes(selected) ? selected : names[0] ?? "";
  const series = data[active] ?? [];

  const axisColor = chartAxisColor(isDark);
  const e1rmColor = chartCyan(isDark);
  const topColor  = isDark ? "#a78bfa" : "#8b5cf6";  /* violet secondary */

  if (names.length === 0) {
    return isOffline
      ? <OfflinePlaceholder className="py-2" />
      : <p className="text-[13px] text-[var(--faint)] text-center py-4">{t.exerciseProgress.noData}</p>;
  }

  const latest = series[series.length - 1];

  return (
    <div>
      <select
        value={active}
        onChange={e => setSelected(e.target.value)}
        className="input-base mb-3 text-sm"
      >
        {names.map(n => <option key={n} value={n}>{n}</option>)}
      </select>

      {latest && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="rounded-xl p-3 flex flex-col gap-1 bg-[var(--accent-faint)]">
            <span className="metric text-[20px] font-semibold text-[var(--text)] leading-none">
              {latest.e1rm} {unit}
            </span>
            <span className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider leading-tight mt-0.5">
              {t.exerciseProgress.e1rm}
            </span>
          </div>
          <div className="rounded-xl p-3 flex flex-col gap-1 bg-[var(--accent-faint)]">
            <span className="metric text-[20px] font-semibold text-[var(--text)] leading-none">
              {latest.top} {unit}
            </span>
            <span className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider leading-tight mt-0.5">
              {t.exerciseProgress.topSet}
            </span>
          </div>
        </div>
      )}

      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={series} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fill: axisColor, fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis domain={["auto", "auto"]} tick={{ fill: axisColor, fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={chartTooltipStyle(isDark)}
            formatter={(value: number, name: string) => [
              `${value} ${unit}`,
              name === "e1rm" ? t.exerciseProgress.e1rm : t.exerciseProgress.topSet,
            ]}
          />
          <Line type="monotone" dataKey="e1rm" stroke={e1rmColor} strokeWidth={2} dot={{ r: 2.5, fill: e1rmColor }} />
          <Line type="monotone" dataKey="top" stroke={topColor} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
