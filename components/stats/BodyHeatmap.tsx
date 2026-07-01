"use client";

import { useT } from "@/lib/context/LanguageContext";

interface Props {
  weeklyMuscles: Record<string, number>;
  isOffline?: boolean;
}

/* Maps workout frequency to chart color scale: cyan → amber → rose */
function heatColor(n: number): string {
  if (n <= 0) return "transparent";
  if (n <= 3) return "rgba(34,211,238,0.55)";   /* --chart-1 cyan  — low */
  if (n <= 8) return "rgba(251,146,60,0.72)";    /* --chart-4 amber — mid */
  return "rgba(248,113,113,0.90)";               /* --chart-5 rose  — high */
}

type BodyProps = { c: (m: string) => string; bf: string; bs: string };

function FrontBody({ c, bf, bs }: BodyProps) {
  return (
    <svg width="74" height="160" viewBox="0 0 74 160">
      <g fill={bf} stroke={bs} strokeWidth="0.9">
        <circle cx="37" cy="11" r="10" />
        <rect x="32" y="21" width="10" height="7" rx="2" />
        <rect x="22" y="27" width="30" height="36" rx="6" />
        <ellipse cx="14" cy="34" rx="9.5" ry="11" />
        <ellipse cx="60" cy="34" rx="9.5" ry="11" />
        <ellipse cx="8"  cy="50" rx="6"   ry="16" />
        <ellipse cx="66" cy="50" rx="6"   ry="16" />
        <ellipse cx="6.5"  cy="73" rx="4.5" ry="11" />
        <ellipse cx="67.5" cy="73" rx="4.5" ry="11" />
        <ellipse cx="5.5"  cy="87" rx="4"   ry="5.5" />
        <ellipse cx="68.5" cy="87" rx="4"   ry="5.5" />
        <ellipse cx="37" cy="65" rx="16" ry="7" />
        <ellipse cx="27" cy="97" rx="11.5" ry="23" />
        <ellipse cx="47" cy="97" rx="11.5" ry="23" />
        <ellipse cx="26.5" cy="123" rx="8" ry="5" />
        <ellipse cx="47.5" cy="123" rx="8" ry="5" />
        <ellipse cx="26"   cy="140" rx="7" ry="13" />
        <ellipse cx="48"   cy="140" rx="7" ry="13" />
        <ellipse cx="23"   cy="155" rx="9" ry="3.5" />
        <ellipse cx="51"   cy="155" rx="9" ry="3.5" />
      </g>
      <ellipse cx="37" cy="43"  rx="12" ry="8.5" fill={c("Chest")} />
      <ellipse cx="14" cy="30"  rx="8"  ry="9"   fill={c("Shoulders")} />
      <ellipse cx="60" cy="30"  rx="8"  ry="9"   fill={c("Shoulders")} />
      <ellipse cx="8"  cy="49"  rx="5"  ry="12"  fill={c("Biceps")} />
      <ellipse cx="66" cy="49"  rx="5"  ry="12"  fill={c("Biceps")} />
      <rect x="28" y="52" width="18" height="14" rx="4" fill={c("Core")} />
      <ellipse cx="27" cy="94"  rx="10" ry="21"  fill={c("Legs")} />
      <ellipse cx="47" cy="94"  rx="10" ry="21"  fill={c("Legs")} />
    </svg>
  );
}

function BackBody({ c, bf, bs }: BodyProps) {
  return (
    <svg width="74" height="160" viewBox="0 0 74 160">
      <g fill={bf} stroke={bs} strokeWidth="0.9">
        <circle cx="37" cy="11" r="10" />
        <rect x="32" y="21" width="10" height="7" rx="2" />
        <rect x="22" y="27" width="30" height="36" rx="6" />
        <ellipse cx="14" cy="34" rx="9.5" ry="11" />
        <ellipse cx="60" cy="34" rx="9.5" ry="11" />
        <ellipse cx="8"  cy="50" rx="6"   ry="16" />
        <ellipse cx="66" cy="50" rx="6"   ry="16" />
        <ellipse cx="6.5"  cy="73" rx="4.5" ry="11" />
        <ellipse cx="67.5" cy="73" rx="4.5" ry="11" />
        <ellipse cx="5.5"  cy="87" rx="4"   ry="5.5" />
        <ellipse cx="68.5" cy="87" rx="4"   ry="5.5" />
        <ellipse cx="37" cy="65" rx="16" ry="7" />
        <ellipse cx="27" cy="97" rx="11.5" ry="23" />
        <ellipse cx="47" cy="97" rx="11.5" ry="23" />
        <ellipse cx="26.5" cy="123" rx="8" ry="5" />
        <ellipse cx="47.5" cy="123" rx="8" ry="5" />
        <ellipse cx="26"   cy="140" rx="7" ry="13" />
        <ellipse cx="48"   cy="140" rx="7" ry="13" />
        <ellipse cx="23"   cy="155" rx="9" ry="3.5" />
        <ellipse cx="51"   cy="155" rx="9" ry="3.5" />
      </g>
      <rect    x="27"  y="28" width="20" height="11" rx="3"  fill={c("Back")} />
      <ellipse cx="14" cy="30" rx="7"  ry="8"   fill={c("Shoulders")} />
      <ellipse cx="60" cy="30" rx="7"  ry="8"   fill={c("Shoulders")} />
      <ellipse cx="23" cy="50" rx="9"  ry="15"  fill={c("Back")} />
      <ellipse cx="51" cy="50" rx="9"  ry="15"  fill={c("Back")} />
      <ellipse cx="8"  cy="50" rx="5"  ry="13"  fill={c("Triceps")} />
      <ellipse cx="66" cy="50" rx="5"  ry="13"  fill={c("Triceps")} />
      <ellipse cx="27" cy="70" rx="11" ry="9.5" fill={c("Glutes")} />
      <ellipse cx="47" cy="70" rx="11" ry="9.5" fill={c("Glutes")} />
      <ellipse cx="27" cy="94" rx="10" ry="21"  fill={c("Legs")} />
      <ellipse cx="47" cy="94" rx="10" ry="21"  fill={c("Legs")} />
    </svg>
  );
}

export default function BodyHeatmap({ weeklyMuscles, isOffline }: Props) {
  const t = useT();
  const lookup = (muscle: string): string => {
    const count = Object.entries(weeklyMuscles).find(
      ([k]) => k.toLowerCase() === muscle.toLowerCase()
    )?.[1] ?? 0;
    return heatColor(count);
  };

  const bf = "var(--surface)";
  const bs = "var(--border-subtle)";
  const hasData = Object.values(weeklyMuscles).some(v => v > 0);

  return (
    <div>
      <div className="flex justify-around items-start px-2">
        <div className="flex flex-col items-center gap-2">
          <span className="text-[9px] tracking-widest uppercase text-[var(--faint)]">{t.bodyHeatmap.front}</span>
          <FrontBody c={lookup} bf={bf} bs={bs} />
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="text-[9px] tracking-widest uppercase text-[var(--faint)]">{t.bodyHeatmap.back}</span>
          <BackBody c={lookup} bf={bf} bs={bs} />
        </div>
      </div>

      {!hasData && (
        <p className="text-[11px] text-center mt-3" style={{ color: "var(--faint)" }}>
          {isOffline ? t.offline.availableWhenConnected : t.bodyHeatmap.noWorkouts}
        </p>
      )}

      <div className="flex items-center justify-center gap-2 mt-4">
        <span className="text-[9px] font-mono text-[var(--faint)]">{t.bodyHeatmap.low}</span>
        <div className="flex gap-1">
          {["rgba(34,211,238,0.55)", "rgba(251,146,60,0.72)", "rgba(248,113,113,0.90)"].map((col, i) => (
            <div key={i} className="w-6 h-2 rounded-sm" style={{ background: col }} />
          ))}
        </div>
        <span className="text-[9px] font-mono text-[var(--faint)]">{t.bodyHeatmap.high}</span>
      </div>
    </div>
  );
}
