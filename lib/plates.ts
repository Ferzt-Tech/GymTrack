import type { WeightUnit } from "@/types";

/** Standard plate denominations, heaviest first. */
export const PLATES: Record<WeightUnit, number[]> = {
  kg:  [25, 20, 15, 10, 5, 2.5, 1.25],
  lbs: [45, 35, 25, 10, 5, 2.5],
};

/** Common bar weights, default first. */
export const BARS: Record<WeightUnit, number[]> = {
  kg:  [20, 15, 10],
  lbs: [45, 35, 15],
};

export interface PlateCount { plate: number; count: number; }

export interface PlateLoad {
  /** Plates to put on EACH side, heaviest first. */
  perSide: PlateCount[];
  /** Closest achievable total (bar + 2 × side plates) not exceeding target. */
  achieved: number;
  /** target − achieved (0 when the target is exactly loadable). */
  remainder: number;
}

export function calcPlates(target: number, bar: number, unit: WeightUnit): PlateLoad | null {
  if (!isFinite(target) || target < bar) return null;
  let side = (target - bar) / 2;
  const perSide: PlateCount[] = [];
  for (const plate of PLATES[unit]) {
    const count = Math.floor((side + 1e-9) / plate);
    if (count > 0) {
      perSide.push({ plate, count });
      side -= count * plate;
    }
  }
  const loaded = perSide.reduce((s, p) => s + p.plate * p.count, 0);
  const achieved = Math.round((bar + loaded * 2) * 100) / 100;
  return { perSide, achieved, remainder: Math.round((target - achieved) * 100) / 100 };
}

export interface WarmupSet { pct: number | null; weight: number; reps: number; }

/**
 * Progressive warm-up scheme for a top working weight:
 * bar ×10 → 50% ×5 → 70% ×3 → 85% ×1. Percentages are rounded to the
 * smallest loadable increment (2×1.25 kg / 2×2.5 lbs). Steps that don't
 * exceed the previous one are dropped (light working weights need fewer sets).
 */
export function warmupScheme(working: number, bar: number, unit: WeightUnit): WarmupSet[] {
  if (!isFinite(working) || working <= bar) return [];
  const inc = unit === "kg" ? 2.5 : 5;
  const roundInc = (w: number) => Math.round(w / inc) * inc;
  const steps: WarmupSet[] = [{ pct: null, weight: bar, reps: 10 }];
  for (const { pct, reps } of [
    { pct: 0.5, reps: 5 },
    { pct: 0.7, reps: 3 },
    { pct: 0.85, reps: 1 },
  ]) {
    const w = Math.min(roundInc(working * pct), working);
    if (w > steps[steps.length - 1].weight && w < working) {
      steps.push({ pct: pct * 100, weight: w, reps });
    }
  }
  return steps;
}
