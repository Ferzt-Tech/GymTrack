"use client";

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { useTheme } from "@/lib/context/ThemeContext";
import { useT } from "@/lib/context/LanguageContext";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";
import { chartAxisColor, chartCyan, chartGridColor, chartTextColor, chartTooltipStyle } from "@/lib/chartTheme";

interface Datum { muscle: string; current: number; previous: number; }

export default function MuscleDistribution({ data, isOffline }: { data: Datum[]; isOffline?: boolean }) {
  const { theme } = useTheme();
  const t         = useT();
  const isDark    = theme === "dark";

  if (!data.length) {
    if (isOffline) return <OfflinePlaceholder />;
    return (
      <p className="text-[13px] text-[var(--faint)] text-center py-8">
        {t.muscleDistribution.noData}
      </p>
    );
  }

  const grid       = chartGridColor(isDark);
  const tick       = chartAxisColor(isDark);
  const curStroke  = chartCyan(isDark);
  const prevStroke = isDark ? "#818cf8"                   : "#a5b4fc";  /* --chart-2 violet */
  const curFill    = isDark ? "rgba(103,232,249,0.12)"    : "rgba(34,211,238,0.10)";
  const prevFill   = isDark ? "rgba(129,140,248,0.07)"    : "rgba(129,140,248,0.06)";

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={data} margin={{ top: 8, right: 28, bottom: 8, left: 28 }}>
          <PolarGrid stroke={grid} />
          <PolarAngleAxis dataKey="muscle" tick={{ fill: tick, fontSize: 9 }} />
          <Radar
            name={t.muscleDistribution.thisMonth} dataKey="current"
            stroke={curStroke} fill={curFill} strokeWidth={1.6}
          />
          <Radar
            name={t.muscleDistribution.lastMonth} dataKey="previous"
            stroke={prevStroke} fill={prevFill} strokeWidth={1.2} strokeDasharray="4 3"
          />
          <Tooltip
            contentStyle={chartTooltipStyle(isDark, chartTextColor(isDark))}
            formatter={(value: number, name: string) => [`${value} sets`, name]}
          />
        </RadarChart>
      </ResponsiveContainer>

      <div className="flex justify-center gap-5 mt-1">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-[2px] rounded-full" style={{ background: curStroke }} />
          <span className="text-[10px] font-mono text-[var(--muted)]">{t.muscleDistribution.thisMonth}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-6 h-[2px] rounded-full"
            style={{ backgroundImage: `repeating-linear-gradient(90deg, ${prevStroke} 0 4px, transparent 4px 7px)` }}
          />
          <span className="text-[10px] font-mono text-[var(--muted)]">{t.muscleDistribution.lastMonth}</span>
        </div>
      </div>
    </div>
  );
}
