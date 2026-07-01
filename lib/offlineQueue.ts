import { getDb } from "./db";
import { supabase } from "./supabase";

export type PendingOp =
  | { type: "upsert";        table: string; payload: Record<string, unknown>; conflictOn?: string }
  | { type: "save_workout";  sessionId: string; sessionPayload: Record<string, unknown>; sets: Record<string, unknown>[] }
  | { type: "delete";        table: string; column: string; value: string };

export async function enqueue(op: PendingOp): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).add("pendingOps", { ...op, createdAt: new Date().toISOString() });
}

export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, failed: 0 };

  const ops = await db.getAll("pendingOps");
  let synced = 0;
  let failed = 0;

  for (const op of ops) {
    try {
      if (op.type === "save_workout") {
        const { error: sessErr } = await supabase
          .from("workout_sessions")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .upsert(op.sessionPayload as any);
        if (sessErr) throw sessErr;

        const sets = op.sets as Record<string, unknown>[];
        if (sets.length > 0) {
          await supabase.from("workout_sets").delete().eq("session_id", op.sessionId as string);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: setsErr } = await supabase.from("workout_sets").insert(sets as any);
          if (setsErr) throw setsErr;
        }
      } else if (op.type === "upsert") {
        const conflictOn = op.conflictOn as string | undefined;
        const { error } = await supabase
          .from(op.table as string)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .upsert(op.payload as any, conflictOn ? { onConflict: conflictOn } : undefined);
        if (error) throw error;
      } else if (op.type === "delete") {
        const { error } = await supabase
          .from(op.table as string)
          .delete()
          .eq(op.column as string, op.value as string);
        if (error) throw error;
      }

      await db.delete("pendingOps", op.id as number);
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}

export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  return db.count("pendingOps");
}

export async function getPendingUpsertsForTable(table: string): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  if (!db) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = await db.getAll("pendingOps");
  return ops
    .filter(op => op.type === "upsert" && op.table === table)
    .map(op => op.payload as Record<string, unknown>);
}

export async function getPendingSaveWorkouts(): Promise<Array<{
  sessionId:      string;
  sessionPayload: Record<string, unknown>;
  sets:           Record<string, unknown>[];
}>> {
  const db = await getDb();
  if (!db) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = await db.getAll("pendingOps");
  return ops
    .filter(op => op.type === "save_workout")
    .map(op => ({
      sessionId:      op.sessionId      as string,
      sessionPayload: op.sessionPayload as Record<string, unknown>,
      sets:           op.sets           as Record<string, unknown>[],
    }));
}

export async function getCached<T>(key: string): Promise<T | null> {
  const db = await getDb();
  if (!db) return null;
  const entry = await db.get("cache", key);
  return entry ? (entry.data as T) : null;
}

export async function setCache(key: string, data: unknown): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.put("cache", { key, data, cachedAt: new Date().toISOString() });
}

export async function getCachedAt(key: string): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const entry = await db.get("cache", key);
  return entry ? new Date(entry.cachedAt) : null;
}

export async function clearCache(key: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete("cache", key);
}
