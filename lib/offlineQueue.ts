import { getDb, TABLES_WITHOUT_USER_ID } from "./db";
import { supabaseOnline } from "./supabase";

export type PendingOp =
  | { type: "upsert";        table: string; payload: Record<string, unknown>; conflictOn?: string }
  | { type: "save_workout";  sessionId: string; sessionPayload: Record<string, unknown>; sets: Record<string, unknown>[] }
  | { type: "delete";        table: string; column: string; value: string };

const LOCAL_TABLES = [
  "profiles",
  "daily_weight_logs",
  "water_logs",
  "food_logs",
  "progress_photos",
  "exercises",
  "workout_folders",
  "workout_sessions",
  "workout_sets",
  "routine_exercises",
  "personal_records",
  "saved_foods",
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
    const sessionEntry = await db.get("cache", "auth:userId");
    const currentUserId = sessionEntry?.data as string | undefined;

    const item = { ...op.payload };

    // Look up any date-keyed duplicate BEFORE opening the write transaction:
    // db.getAll runs in its own transaction, and an idle readwrite transaction
    // auto-commits during that await, making the later put() throw.
    let dateKeyedExisting: any = null;
    if (!item.id && (op.table === "daily_weight_logs" || op.table === "water_logs") && currentUserId) {
      const allRecords = await db.getAll(op.table as any);
      dateKeyedExisting = allRecords.find(
        (r: any) =>
          r.user_id === (item.user_id || currentUserId) &&
          r.logged_date === item.logged_date
      );
    }

    const tx = db.transaction(op.table as any, "readwrite");
    const store = tx.objectStore(op.table as any);

    let existing: any = dateKeyedExisting;
    if (item.id) {
      existing = await store.get(item.id as string);
    }

    if (existing) {
      const merged = {
        ...existing,
        ...item,
        updated_at: new Date().toISOString(),
      };
      await store.put(merged);
      op.payload = merged;
    } else {
      if (!item.id) item.id = generateUUID();
      if (!item.created_at && op.table !== "water_logs") item.created_at = new Date().toISOString();
      if (!item.user_id && currentUserId && !TABLES_WITHOUT_USER_ID.includes(op.table)) item.user_id = currentUserId;
      await store.put(item);
      op.payload = item;
    }
    await tx.done;
  } else if (op.type === "save_workout") {
    const txSess = db.transaction("workout_sessions", "readwrite");
    const storeSess = txSess.objectStore("workout_sessions");
    const sessionPayload = { ...op.sessionPayload };
    if (!sessionPayload.id) sessionPayload.id = op.sessionId;
    await storeSess.put(sessionPayload);
    await txSess.done;

    // Read existing sets BEFORE opening the write transaction — db.getAll runs in its
    // own transaction and an idle readwrite tx auto-commits during the await (see the
    // upsert branch comment above), which is what previously threw here.
    const allSets = await db.getAll("workout_sets");
    const setsToDelete = allSets.filter((s: any) => s.session_id === op.sessionId);

    // Prepare new rows before opening the tx as well.
    const newSets = op.sets.map((setInput) => {
      const set = { ...setInput };
      if (!set.id) set.id = generateUUID();
      if (!set.session_id) set.session_id = op.sessionId;
      return set;
    });

    // Now do only synchronous store ops inside the tx (no awaits between them).
    const txSets = db.transaction("workout_sets", "readwrite");
    const storeSets = txSets.objectStore("workout_sets");
    for (const s of setsToDelete) storeSets.delete(s.id);
    for (const set of newSets) storeSets.put(set);
    await txSets.done;
  } else if (op.type === "delete") {
    // 1. Fetch records to delete before opening the transaction
    let records = await db.getAll(op.table as any);
    records = records.filter((r: any) => r[op.column] === op.value);

    // 2. Open the transaction and queue delete operations
    const tx = db.transaction(op.table as any, "readwrite");
    const store = tx.objectStore(op.table as any);
    for (const r of records) {
      store.delete(r.id);
    }
    await tx.done;

    // Cascade deletes in local IndexedDB
    if (op.table === "workout_sessions" && op.column === "id") {
      const allSets = await db.getAll("workout_sets");
      const setsToDelete = allSets.filter((s: any) => s.session_id === op.value);

      const txSets = db.transaction("workout_sets", "readwrite");
      const storeSets = txSets.objectStore("workout_sets");
      for (const s of setsToDelete) {
        storeSets.delete(s.id);
      }
      await txSets.done;
    }

    if (op.table === "workout_folders" && op.column === "id") {
      const allRE = await db.getAll("routine_exercises");
      const reToDelete = allRE.filter((re: any) => re.folder_id === op.value);

      const txRE = db.transaction("routine_exercises", "readwrite");
      const storeRE = txRE.objectStore("routine_exercises");
      for (const re of reToDelete) {
        storeRE.delete(re.id);
      }
      await txRE.done;
    }
  }
}

export async function enqueue(op: PendingOp): Promise<void> {
  const isLocal =
    op.type === "save_workout" ||
    (op.type === "upsert" && LOCAL_TABLES.includes(op.table)) ||
    (op.type === "delete" && LOCAL_TABLES.includes(op.table));

  if (isLocal) {
    await executeLocalOp(op);
  }

  await queueForSync(op);
}

// Registers an op for later sync, for signed-in (non-guest) users only.
// Assumes the local write (if any) has already happened — via executeLocalOp
// (enqueue's own callers) or some other local write already performed by the
// caller (e.g. MockQueryBuilder, which writes locally itself before calling
// this to also get its writes picked up by flushQueue()).
export async function queueForSync(op: PendingOp): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const sessionEntry = await db.get("cache", "auth:userId");
  const currentUserId = sessionEntry?.data as string | undefined;

  if (currentUserId && currentUserId !== "guest-user") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).add("pendingOps", { ...op, createdAt: new Date().toISOString() });
  }
}

export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, failed: 0 };

  const ops = await db.getAll("pendingOps");
  let synced = 0;
  let failed = 0;

  // Dynamic import avoids a static cycle: lib/auth-utils.ts already imports
  // from this file (getCached/setCache).
  const { withTimeout } = await import("./auth-utils");

  for (const op of ops) {
    try {
      if (!supabaseOnline) {
        failed++;
        continue;
      }

      const anyOp = op as any;
      if (op.type === "save_workout") {
        // 1. Sync session
        const { error: sessErr } = await withTimeout(supabaseOnline
          .from("workout_sessions")
          .upsert(anyOp.sessionPayload));
        if (sessErr) throw sessErr;

        // 2. Sync sets
        if (anyOp.sets && anyOp.sets.length > 0) {
          // Delete existing sets for this session to avoid duplicates
          const { error: delErr } = await withTimeout(supabaseOnline
            .from("workout_sets")
            .delete()
            .eq("session_id", anyOp.sessionId));
          if (delErr) throw delErr;

          const { error: setsErr } = await withTimeout(supabaseOnline
            .from("workout_sets")
            .insert(anyOp.sets));
          if (setsErr) throw setsErr;
        }
      } else if (op.type === "upsert") {
        const conflictOn = anyOp.conflictOn as string | undefined;
        const { error } = await withTimeout(supabaseOnline
          .from(anyOp.table as string)
          .upsert(anyOp.payload as any, conflictOn ? { onConflict: conflictOn } : undefined));
        if (error) throw error;
      } else if (op.type === "delete") {
        const { error } = await withTimeout(supabaseOnline
          .from(anyOp.table as string)
          .delete()
          .eq(anyOp.column as string, anyOp.value as string));
        if (error) throw error;
      }

      await db.delete("pendingOps", op.id as number);
      synced++;
    } catch (err) {
      console.error("Failed to flush op:", op, err);
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

export async function getPendingDeletesForTable(
  table: string
): Promise<Array<{ column: string; value: string }>> {
  const db = await getDb();
  if (!db) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = await db.getAll("pendingOps");
  return ops
    .filter(op => op.type === "delete" && op.table === table)
    .map(op => ({
      column: op.column as string,
      value: op.value as string,
    }));
}

export function overlayUpserts<T extends Record<string, unknown>>(
  base: T[],
  pending: Record<string, unknown>[],
  key: string
): T[] {
  if (!pending.length) return base;
  const copy = [...base];
  for (const op of pending) {
    const idx = copy.findIndex(r => r[key] === op[key]);
    if (idx >= 0) copy[idx] = { ...copy[idx], ...op } as T;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    else copy.push({ ...op, id: `local-${Date.now()}-${Math.random()}` } as any as T);
  }
  return copy;
}
