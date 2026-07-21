/** Estimated 1-rep-max formulas. Weights are unit-agnostic (same unit in/out). */

export function epley1RM(weight: number, reps: number): number {
  return reps <= 1 ? weight : weight * (1 + reps / 30);
}

export function brzycki1RM(weight: number, reps: number): number {
  return reps <= 1 ? weight : (weight * 36) / (37 - reps);
}

/**
 * Average of Epley and Brzycki — the two diverge in opposite directions at
 * higher reps, so the mean tracks tested 1RMs better than either alone.
 * Returns null outside the 1–12 rep range where both formulas lose accuracy.
 */
export function e1RM(weight: number | null, reps: number | null): number | null {
  if (weight == null || weight <= 0 || reps == null || reps < 1 || reps > 12) return null;
  return Math.round(((epley1RM(weight, reps) + brzycki1RM(weight, reps)) / 2) * 10) / 10;
}
