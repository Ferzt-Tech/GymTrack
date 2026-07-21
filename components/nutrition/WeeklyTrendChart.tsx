"use client";

import {
  BarChart, Bar, XAxis, YAxis,
  ReferenceLine, Tooltip, ResponsiveContainer,
} from "recharts";
import { useTheme } from "@/lib/context/ThemeContext";
import { useT } from "@/lib/context/LanguageContext";

export interface DayCalories { day: string; calories: number; }

interface Props {
  data: DayCalories[];
  targetCalories: number | null;
}

export default function WeeklyTrendChart({ data, targetCalories }: Props) {
  const { theme } = useTheme();
  const t = useT();
  const isDark = theme === "dark";

  const axisColor = isDark ? "#3a3a3a" : "#b0b0b0";
  const barColor = isDark ? "#67e8f9" : "#22d3ee";

  if (data.length < 2) {
    return (
      <p className="text-[11px] text-[var(--faint)] text-center py-3">
        {t.nutritionTracker.weeklyTrendNoData}
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={110}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }} barSize={18}>
        <XAxis dataKey="day" tick={{ fill: axisColor, fontSize: 9 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: axisColor, fontSize: 9 }} axisLine={false} tickLine={false} />
        {targetCalories != null && (
          <ReferenceLine y={targetCalories} stroke="var(--chart-4)" strokeDasharray="4 3" strokeWidth={1.5} />
        )}
        <Tooltip
          contentStyle={{
            background: isDark ? "rgba(16,16,16,0.82)" : "rgba(255,255,255,0.82)",
            backdropFilter: "blur(16px) saturate(160%)",
            WebkitBackdropFilter: "blur(16px) saturate(160%)",
            border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.70)",
            borderRadius: "12px",
            color: isDark ? "#67e8f9" : "#22d3ee",
            fontSize: "11px",
            fontFamily: "ui-monospace, monospace",
          }}
          formatter={(value: number) => [`${value.toLocaleString()} kcal`, ""]}
        />
        <Bar dataKey="calories" fill={barColor} radius={[4, 4, 0, 0]} opacity={0.85} />
      </BarChart>
    </ResponsiveContainer>
  );
}
