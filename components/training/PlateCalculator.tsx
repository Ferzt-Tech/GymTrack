"use client";

import { useState } from "react";
import { BARS, calcPlates, warmupScheme } from "@/lib/plates";
import type { WeightUnit } from "@/types";
import { useT } from "@/lib/context/LanguageContext";

interface Props {
  initialTarget: number | null;
  unit:          WeightUnit;
  onClose:       () => void;
}

export default function PlateCalculator({ initialTarget, unit, onClose }: Props) {
  const t = useT();
  const [targetStr, setTargetStr] = useState(initialTarget != null && initialTarget > 0 ? String(initialTarget) : "");
  const [bar, setBar] = useState(BARS[unit][0]);

  const target = parseFloat(targetStr);
  const load = !isNaN(target) ? calcPlates(target, bar, unit) : null;
  const warmups = !isNaN(target) ? warmupScheme(target, bar, unit) : [];

  return (
    <div className="fixed inset-0 z-[85] bg-black/60 flex items-end" onClick={onClose}>
      <div
        className="glass-sheet w-full rounded-t-2xl p-5 pb-8 space-y-4 max-h-[80vh] overflow-y-auto animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="section-label mb-0">◈ {t.plateCalc.title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.plateCalc.close}
            className="text-[var(--faint)] hover:text-[var(--muted)] text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider block mb-1">
              {t.plateCalc.targetLabel} ({unit})
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              value={targetStr}
              onChange={e => setTargetStr(e.target.value)}
              placeholder="100"
              className="input-base text-lg font-semibold text-center metric py-2"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider block mb-1">
              {t.plateCalc.bar} ({unit})
            </label>
            <div className="flex gap-1.5">
              {BARS[unit].map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBar(b)}
                  className={`btn-outline flex-1 py-2 text-sm metric ${bar === b ? "border-[var(--accent)] text-[var(--accent)]" : ""}`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        </div>

        {load && (
          <div className="card p-3 space-y-2">
            <p className="text-[10px] text-[var(--faint)] uppercase tracking-wider">{t.plateCalc.perSide}</p>
            {load.perSide.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t.plateCalc.emptyBar}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {load.perSide.map(({ plate, count }) => (
                  <span key={plate} className="sector-readout text-xs px-2.5 py-1.5">
                    {count} × {plate} {unit}
                  </span>
                ))}
              </div>
            )}
            <p className="metric text-sm text-[var(--text)]">= {load.achieved} {unit}</p>
            {load.remainder > 0 && (
              <p className="text-[11px]" style={{ color: "var(--chart-4)" }}>
                {t.plateCalc.shortBy(String(load.remainder), unit)}
              </p>
            )}
          </div>
        )}

        {warmups.length > 0 && (
          <div className="card p-3 space-y-1.5">
            <p className="text-[10px] text-[var(--faint)] uppercase tracking-wider mb-1">{t.plateCalc.warmupTitle}</p>
            {warmups.map((w, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">
                  {w.pct == null ? t.plateCalc.barOnly : `${Math.round(w.pct)}%`}
                </span>
                <span className="metric text-[var(--text)]">
                  {w.weight} {unit} × {w.reps}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
