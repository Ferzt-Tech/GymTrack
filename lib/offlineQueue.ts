import { getDb } from "./db";
import { supabaseOnline } from "./supabase";

export type PendingOp =
  | { type: "upsert";        table: string; payload: Record<string, unknown>; conflictOn?: string }
  | { type: "save_workout";  sessionId: string; sessionPayload: Record<string, unknown>; sets: Record<string, unknown>[] }
  | { type: "delete";        table: string; column: string; value: string };

const LOCAL_TABLES = [
  "profiles",
  "daily_weight_logs",
  "water_logs",
  "progress_photos",
  "exercises",
  "workout_folders",
  "workout_sessions",
  "workout_sets",
  "routine_exercises",
  "personal_records",
];

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

export async function executeLocalOp(op: PendingOp): Promise<void> {
  const db = await getDb();
  if (!db) return;

  if (op.type === "upsert") {
    const tx = db.transaction(op.table as any, "readwrite");
    const store = tx.objectStore(op.table as any);
    const item = { ...op.payload };
    
    const sessionEntry = await db.get("cache", "auth:userId");
    const currentUserId = sessionEntry?.data as string | undefined;

    let existing: any = null;
    if (item.id) {
      existing = await store.get(item.id as string);
    } else if ((op.table === "daily_weight_logs" || op.table === "water_logs") && currentUserId) {
      const allRecords = await db.getAll(op.table as any);
      existing = allRecords.find(
        (r: any) =>
          r.user_id === (item.user_id || currentUserId) &&
          r.logged_date === item.logged_date
      );
    }

    if (existing) {
      const merged = {
        ...existing,
        ...item,
        updated_at: new Date().toISOString(),
      };
      await store.put(merged);
    } else {
      if (!item.id) item.id = generateUUID();
      if (!item.created_at && op.table !== "water_logs") item.created_at = new Date().toISOString();
      if (!item.user_id && currentUserId) item.user_id = currentUserId;
      await store.put(item);
    }
    await tx.done;
  } else if (op.type === "save_workout") {
    const txSess = db.transaction("workout_sessions", "readwrite");
    const storeSess = txSess.objectStore("workout_sessions");
    const sessionPayload = { ...op.sessionPayload };
    if (!sessionPayload.id) sessionPayload.id = op.sessionId;
    await storeSess.put(sessionPayload);
    await txSess.done;

    const txSets = db.transaction("workout_sets", "readwrite");
    const storeSets = txSets.objectStore("workout_sets");
    
    const allSets = await db.getAll("workout_sets");
    for (const s of allSets) {
      if (s.session_id === op.sessionId) {
        await storeSets.delete(s.id);
      }
    }

    for (const setInput of op.sets) {
      const set = { ...setInput };
      if (!set.id) set.id = generateUUID();
      if (!set.session_id) set.session_id = op.sessionId;
      await storeSets.put(set);
    }
    await txSets.done;
  } else if (op.type === "delete") {
    const tx = db.transaction(op.table as any, "readwrite");
    const store = tx.objectStore(op.table as any);
    
    let records = await db.getAll(op.table as any);
    records = records.filter((r: any) => r[op.column] === op.value);
    
    for (const r of records) {
      await store.delete(r.id);
    }
    await tx.done;
  }
}

export async function enqueue(op: PendingOp): Promise<void> {
  const isLocal =
    op.type === "save_workout" ||
    (op.type === "upsert" && LOCAL_TABLES.includes(op.table)) ||
    (op.type === "delete" && LOCAL_TABLES.includes(op.table));

  if (isLocal) {
    await executeLocalOp(op);
    return;
  }

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
      const isLocal =
        op.type === "save_workout" ||
        (op.type === "upsert" && LOCAL_TABLES.includes((op as any).table)) ||
        (op.type === "delete" && LOCAL_TABLES.includes((op as any).table));

      if (isLocal) {
        await db.delete("pendingOps", op.id as number);
        synced++;
        continue;
      }

      if (!supabaseOnline) {
        failed++;
        continue;
      }

      if (op.type === "upsert") {
        const conflictOn = op.conflictOn as string | undefined;
        const { error } = await supabaseOnline
          .from(op.table as string)
          .upsert(op.payload as any, conflictOn ? { onConflict: conflictOn } : undefined);
        if (error) throw error;
      } else if (op.type === "delete") {
        const { error } = await supabaseOnline
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
