/**
 * Volume feedback store — pump & soreness ratings captured at the end of a
 * workout, in the IndexedDB `volume_feedback` store.
 *
 * Deliberately device-local: NOT in REMOTE_TABLES / LOCAL_TABLES /
 * TABLES_BACKUP_ORDER, and never queued for sync. Two reasons.
 *
 *  1. A table the client writes but the remote project doesn't have makes
 *     PostgREST reject the *entire* upsert, which breaks cloud sync and backup
 *     wholesale — the failure mode CLAUDE.md documents twice (workout_sets.drops,
 *     food_logs.updated_at). Shipping a new synced table means every existing
 *     install is broken until its owner runs a migration by hand.
 *  2. The data is short-lived by design: `recommendSets` ignores anything older
 *     than two weeks, so there is nothing here worth a cross-device round trip.
 *
 * It is included in the JSON export, so it is not trapped on one device.
 */

import { getDb } from "./db";
import type { PumpRating, SorenessRating, VolumeFeedback } from "@/types";

export interface VolumeFeedbackInput {
  muscleGroup: string;
  pump: PumpRating;
  soreness: SorenessRating;
  setsPerformed: number;
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Persist one session's ratings. Rows are prepared *before* the transaction
 * opens and written without awaiting each put — an idle readwrite transaction
 * auto-commits across an await and the next put then throws
 * TransactionInactiveError (see the offline pattern rules in CLAUDE.md).
 */
export async function saveVolumeFeedback(params: {
  userId: string;
  sessionId: string | null;
  loggedDate: string;
  entries: VolumeFeedbackInput[];
}): Promise<VolumeFeedback[]> {
  const db = await getDb();
  if (!db || params.entries.length === 0) return [];

  const now = new Date().toISOString();
  const rows: VolumeFeedback[] = params.entries.map(entry => ({
    id: generateUUID(),
    user_id: params.userId,
    session_id: params.sessionId,
    logged_date: params.loggedDate,
    muscle_group: entry.muscleGroup,
    pump: entry.pump,
    soreness: entry.soreness,
    sets_performed: entry.setsPerformed,
    created_at: now,
  }));

  // Re-rating the same muscle for the same session replaces the earlier answer
  // rather than stacking a second row on top of it.
  const existing = (await db.getAll("volume_feedback")) as VolumeFeedback[];
  const replaced = existing.filter(
    r =>
      r.user_id === params.userId &&
      r.logged_date === params.loggedDate &&
      r.session_id === params.sessionId &&
      rows.some(n => n.muscle_group === r.muscle_group)
  );

  const tx = db.transaction("volume_feedback", "readwrite");
  const store = tx.objectStore("volume_feedback");
  for (const r of replaced) store.delete(r.id);
  for (const row of rows) store.put(row);
  await tx.done;

  return rows;
}

/** All feedback for a user, newest first, optionally limited to a date window. */
export async function getVolumeFeedback(
  userId: string,
  sinceDate?: string
): Promise<VolumeFeedback[]> {
  const db = await getDb();
  if (!db) return [];
  const all = (await db.getAll("volume_feedback")) as VolumeFeedback[];
  return all
    .filter(r => r.user_id === userId && (!sinceDate || r.logged_date >= sinceDate))
    .sort((a, b) => b.logged_date.localeCompare(a.logged_date) || b.created_at.localeCompare(a.created_at));
}

/** Feedback from the last `days` days — the window the recommender trusts. */
export async function getRecentVolumeFeedback(userId: string, days = 21): Promise<VolumeFeedback[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return getVolumeFeedback(userId, cutoff.toISOString().slice(0, 10));
}

/** The soreness rating a user gave for a muscle at their previous session —
 *  used to pre-fill nothing, but to show "last time you said…" context. */
export async function getLastFeedbackFor(
  userId: string,
  muscleGroup: string
): Promise<VolumeFeedback | null> {
  const all = await getVolumeFeedback(userId);
  return all.find(r => r.muscle_group === muscleGroup) ?? null;
}
