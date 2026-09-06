/**
 * Personal records — one durable, append-only history instead of two
 * independent, inconsistent definitions (a raw-max-weight toast trigger in
 * training/page.tsx and a from-scratch e1RM recompute over a 60-day session
 * window in stats/page.tsx). Rows are written here on workout save and read
 * back here for the stats page's PersonalRecords card — see
 * migrations/add_personal_records.sql.
 */

import { getDb } from "./db";
import { e1RM } from "./oneRepMax";
import type { LoggedSet, PersonalRecord } from "@/types";

function toKg(weight: number, unit: string | null | undefined): number {
  return unit === "lbs" ? weight / 2.20462 : weight;
}

export interface DetectedPR {
  exerciseId: string | null;
  exerciseName: string;
  weightKg: number;
  reps: number;
  /** Epley/Brzycki average — null outside the 1-12 rep range it's valid for. */
  e1rm: number | null;
}

/**
 * Compares each newly-logged non-warmup set's weight (in kg) against the
 * historical max for that exercise and returns the ones that beat it — the
 * heaviest new set per exercise. This is the weight-based definition
 * PRToast has always used, not e1RM: a heavy low-rep single is real PR news
 * even when e1RM can't be estimated for it. e1RM is attached alongside for
 * the durable row, not used as the trigger condition.
 */
export function detectWeightPRs(
  loggedSets: LoggedSet[],
  historicalMaxKgByExercise: Record<string, number>
): DetectedPR[] {
  const best: Record<string, DetectedPR> = {};
  for (const s of loggedSets) {
    if (s.weight == null || s.weight <= 0 || s.setType === "warmup") continue;
    const weightKg = toKg(s.weight, s.weight_unit);
    if (weightKg > (best[s.exerciseName]?.weightKg ?? 0)) {
      best[s.exerciseName] = {
        exerciseId:   s.exerciseId,
        exerciseName: s.exerciseName,
        weightKg,
        reps:         s.reps,
        e1rm:         e1RM(weightKg, s.reps),
      };
    }
  }
  return Object.values(best).filter(
    pr => pr.weightKg > (historicalMaxKgByExercise[pr.exerciseName] ?? 0)
  );
}

/** Upsert payload for one detected PR. Every call gets a fresh id —
 *  personal_records is append-only, never updated in place. */
export function personalRecordPayload(
  userId: string,
  pr: DetectedPR,
  sessionId: string | null,
  achievedAt: string
): Record<string, unknown> {
  return {
    id:            crypto.randomUUID(),
    user_id:       userId,
    exercise_id:   pr.exerciseId,
    exercise_name: pr.exerciseName,
    weight_kg:     Math.round(pr.weightKg * 100) / 100,
    reps:          pr.reps,
    e1rm:          pr.e1rm,
    session_id:    sessionId,
    achieved_at:   achievedAt,
  };
}

/** Every PR row for a user, read straight from the local IndexedDB mirror —
 *  same offline-first shape as everything else in this app. */
export async function getPersonalRecords(userId: string): Promise<PersonalRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const all = (await db.getAll("personal_records")) as PersonalRecord[];
  return all.filter(r => r.user_id === userId);
}

/** Best (highest e1RM) record per exercise, most recently achieved first,
 *  capped at `limit`. Rows with no e1rm (outside the 1-12 rep range) are
 *  excluded — the old stats-page recompute only ever considered sets it
 *  could estimate e1RM for either. */
export function bestPerExercise(records: PersonalRecord[], limit = 8): PersonalRecord[] {
  const best: Record<string, PersonalRecord> = {};
  for (const r of records) {
    if (r.e1rm == null) continue;
    const curr = best[r.exercise_name];
    if (!curr || r.e1rm > (curr.e1rm as number)) best[r.exercise_name] = r;
  }
  return Object.values(best)
    .sort((a, b) => b.achieved_at.localeCompare(a.achieved_at))
    .slice(0, limit);
}
