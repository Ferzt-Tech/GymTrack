"use client";

import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { format } from "date-fns";
import { useTheme } from "@/lib/context/ThemeContext";
import { useT } from "@/lib/context/LanguageContext";
import type { DailyWeightLog, WeightUnit } from "@/types";
import CachedPill from "@/components/ui/CachedPill";
import OfflinePlaceholder from "@/components/ui/OfflinePlaceholder";

interface Props {
  logs: DailyWeightLog[];
  unit: WeightUnit;
  isOffline?: boolean;
  cachedAt?: Date | null;
}

function Tip({ active, payload, label, unit, isDark }: {
  active?: boolean; payload?: { value: number }[]; label?: string;
  unit: WeightUnit; isDark: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2 text-sm"
      style={{
        background:       isDark ? "rgba(16,16,16,0.82)" : "rgba(255,255,255,0.82)",
        backdropFilter:   "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        border:           isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.70)",
        boxShadow:        isDark ? "0 4px 16px rgba(0,0,0,0.5)" : "0 4px 16px rgba(0,0,0,0.08)",
      }}
    >
      <p style={{ color: isDark ? "#555" : "#aaa" }} className="text-[11px] font-mono">{label}</p>
      <p style={{ color: isDark ? "#67e8f9" : "#22d3ee" }} className="font-semibold metric">
        {payload[0].value.toFixed(1)} {unit}
      </p>
    </div>
  );
}

export default function WeightChart({ logs, unit, isOffline, cachedAt }: Props) {
  const { theme } = useTheme();
  const isDark    = theme === "dark";
  const t = useT();

  const c = {
    grid:    isDark ? "#1a1a1a" : "#ececec",
    axis:    isDark ? "#3a3a3a" : "#b0b0b0",
    line:    isDark ? "#67e8f9" : "#22d3ee",   /* oscilloscope cyan trace */
    ref:     isDark ? "#818cf8" : "#a5b4fc",   /* violet avg reference */
    cursor:  isDark ? "#2a2a2a" : "#d4d4d4",
    dot:     isDark ? "#67e8f9" : "#22d3ee",
    divider: isDark ? "#1a1a1a" : "#e8e8e8",
    dim:     isDark ? "#444"    : "#aaa",
  };

  if (!logs.length) {
    if (isOffline) {
      return (
        <OfflinePlaceholder
          title={t.weightChart.trendUnavailable}
          subtitle={t.weightChart.connectToLoad}
          lastSyncedAt={cachedAt}
        />
      );
    }
    return (
      <div className="card-glass p-4 flex items-center justify-center h-36 text-[var(--muted)] text-sm">
        {t.weightChart.logToSeeTrend}
      </div>
    );
  }

  const sorted = [...logs].sort((a, b) => a.logged_date.localeCompare(b.logged_date));
  const data   = sorted.map(l => ({
    date:   format(new Date(l.logged_date + "T12:00:00"), "MMM d"),
    weight: unit === "lbs"
      ? Math.round(l.weight * 2.20462 * 10) / 10
      : l.weight,
  }));

  const weights = data.map(d => d.weight);
  const avg     = weights.reduce((s, w) => s + w, 0) / weights.length;
  const min     = Math.min(...weights);
  const max     = Math.max(...weights);
  const domain: [number, number] = [Math.floor(min - 1.5), Math.ceil(max + 1.5)];
  const ticks   = data.length > 14
    ? data.filter((_, i) => i % Math.ceil(data.length / 7) === 0).map(d => d.date)
    : undefined;

  return (
    <div className="card-glass p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="section-label mb-0">{t.weightChart.weightTrend}</p>
        <div className="flex items-center gap-2">
          {isOffline && <CachedPill cachedAt={cachedAt} />}
          <span className="metric text-[11px] text-[var(--faint)]">{t.weightChart.avgLabel} {avg.toFixed(1)} {unit}</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 6" stroke={c.grid} vertical={false} />
          <XAxis
            dataKey="date" ticks={ticks}
            tick={{ fill: c.axis, fontSize: 10, fontFamily: "ui-monospace, monospace" }} axisLine={false} tickLine={false}
          />
          <YAxis
            domain={domain}
            tick={{ fill: c.axis, fontSize: 10, fontFamily: "ui-monospace, monospace" }} axisLine={false} tickLine={false}
          />
          <Tooltip content={<Tip unit={unit} isDark={isDark} />} cursor={{ stroke: c.cursor, strokeWidth: 1 }} />
          <ReferenceLine y={avg} stroke={c.ref} strokeDasharray="4 4" strokeWidth={1} />
          <Line
            type="monotone" dataKey="weight"
            stroke={c.line} strokeWidth={2}
            dot={false} activeDot={{ r: 4, fill: c.dot, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>

      <div
        className="flex justify-between metric text-[10px] mt-3 pt-3"
        style={{ color: c.dim, borderTop: `1px solid ${c.divider}` }}
      >
        <span>{t.weightChart.lowLabel} {min.toFixed(1)} {unit}</span>
        <span>{t.weightChart.highLabel} {max.toFixed(1)} {unit}</span>
        <span>{t.weightChart.entriesLabel(data.length)}</span>
      </div>
    </div>
  );
}
