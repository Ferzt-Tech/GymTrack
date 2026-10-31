import type { CSSProperties } from "react";

/**
 * Shared recharts color/style tokens. Hand-copied identically across
 * WeightChart, WeeklyTrendChart, ExerciseProgress, MonthlyReport, and
 * MuscleDistribution until this file existed — same axis color, same glass
 * tooltip shell, same primary data cyan, verified byte-for-byte equal.
 *
 * The cyan is deliberately NOT var(--chart-1)/var(--accent): light mode's
 * --chart-1 (#0e7490) is tuned for UI chrome (buttons, borders) and reads as
 * too muted for a data bar/line/point on a white card, so data-viz elements
 * use a punchier #22d3ee instead. Dark mode's #67e8f9 already works for both
 * roles, which is why only light mode needs the separate value — this is a
 * deliberate data-viz legibility choice, not drift from the CSS variables.
 */
export function chartAxisColor(isDark: boolean): string {
  return isDark ? "#3a3a3a" : "#b0b0b0";
}

export function chartGridColor(isDark: boolean): string {
  return isDark ? "#1e1e1e" : "#e8e8e8";
}

export function chartCyan(isDark: boolean): string {
  return isDark ? "#67e8f9" : "#22d3ee";
}

/** Secondary series violet (--chart-2 family), lighter in light mode so a
 *  comparison series reads as secondary next to the cyan primary. */
export function chartViolet(isDark: boolean): string {
  return isDark ? "#818cf8" : "#a5b4fc";
}

/** Translucent area fill for a cyan / violet series (radar, area charts). */
export function chartCyanFill(isDark: boolean): string {
  return isDark ? "rgba(103,232,249,0.12)" : "rgba(34,211,238,0.10)";
}

export function chartVioletFill(isDark: boolean): string {
  return isDark ? "rgba(129,140,248,0.07)" : "rgba(129,140,248,0.06)";
}

/** Matches --text exactly (#f0f0f0 dark / #111111 light) — for tooltip text
 *  on charts that don't use the cyan accent for it. */
export function chartTextColor(isDark: boolean): string {
  return isDark ? "#f0f0f0" : "#111";
}

/** The frosted glass tooltip shell shared by every chart. `textColor`
 *  defaults to chartCyan(isDark); pass chartTextColor(isDark) for charts
 *  that want neutral text instead. */
export function chartTooltipStyle(isDark: boolean, textColor?: string): CSSProperties {
  return {
    background: isDark ? "rgba(16,16,16,0.82)" : "rgba(255,255,255,0.82)",
    backdropFilter: "blur(16px) saturate(160%)",
    WebkitBackdropFilter: "blur(16px) saturate(160%)",
    border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.70)",
    borderRadius: "12px",
    color: textColor ?? chartCyan(isDark),
    fontSize: "11px",
    fontFamily: "ui-monospace, monospace",
  };
}
