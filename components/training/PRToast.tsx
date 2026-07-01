"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { WeightUnit } from "@/types";
import { useT } from "@/lib/context/LanguageContext";
import { playPR } from "@/lib/sounds";

interface PR {
  exerciseName: string;
  weightKg: number;
}

interface Props {
  prs: PR[];
  unit: WeightUnit;
  onDismiss: () => void;
}

export default function PRToast({ prs, unit, onDismiss }: Props) {
  const t = useT();

  useEffect(() => {
    playPR();
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fmtWeight(kg: number): string {
    if (unit === "lbs") return `${(kg * 2.20462).toFixed(1)} lbs`;
    return `${kg} kg`;
  }

  return createPortal(
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[200] w-[calc(100%-2rem)] max-w-sm animate-spring-scale"
      style={{ bottom: "calc(max(1.25rem, env(safe-area-inset-bottom) + 0.5rem) + 4.5rem)" }}
    >
      <button
        onClick={onDismiss}
        className="w-full text-left card-glass p-4"
        style={{
          borderColor: "rgba(var(--accent-rgb), 0.45)",
          boxShadow: "0 0 0 1px rgba(var(--accent-rgb), 0.45), 0 8px 32px rgba(var(--accent-rgb), 0.18), 0 2px 8px rgba(0,0,0,0.15), inset 0 1.5px 0 rgba(255,255,255,0.85)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg"
            style={{ background: "rgba(var(--accent-rgb), 0.12)", border: "1px solid rgba(var(--accent-rgb), 0.25)" }}
          >
            🏆
          </div>
          <div className="flex-1 min-w-0">
            <p className="sector-readout inline-flex mb-1.5">{t.pr.newPR}</p>
            {prs.map((pr, i) => (
              <p key={i} className="text-[13px] text-[var(--text)] font-medium truncate leading-snug">
                {pr.exerciseName}
                <span className="text-[var(--accent)] ml-2 metric font-semibold">↑ {fmtWeight(pr.weightKg)}</span>
              </p>
            ))}
          </div>
        </div>
      </button>
    </div>,
    document.body,
  );
}
