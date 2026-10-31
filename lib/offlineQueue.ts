import { getDb, TABLES_WITHOUT_USER_ID, TABLES_WITH_UPDATED_AT, cascadeDeleteChildren } from "./db";
import { supabaseOnline } from "./supabase";
import { SYNCED_TABLE_NAMES } from "./tables";
import { generateUUID } from "./utils";
import type { FoodLog } from "@/types";

export type PendingOp =
  | { type: "upsert";        table: string; payload: Record<string, unknown>; conflictOn?: string }
  | { type: "save_workout";  sessionId: string; sessionPayload: Record<string, unknown>; sets: Record<string, unknown>[] }
  | { type: "delete";        table: string; column: string; value: string };

const LOCAL_TABLES = SYNCED_TABLE_NAMES;

/* ══════════════════════════════════════════════════════════════════════════════
   Sync envelope
   ─────────────────────────────────────────────────────────────────────────────
   Every queued op carries sync metadata *on the queue row*, never inside its
   `payload`. That placement is the whole trick: PostgREST rejects an entire
   upsert over one column the remote table doesn't have, so a `sync_version`
   column on the rows themselves would need a migration on every table and would
   break cloud sync wholesale on any project that hadn't applied it. Keeping the
   metadata on the envelope gives ordering, idempotence and retry state with
   ZERO remote schema change.
   ══════════════════════════════════════════════════════════════════════════ */

export type QueueStatus = "pending" | "failed";

export interface QueueMeta {
  /** IndexedDB autoIncrement key. Also the tiebreaker for equal versions. */
  id?: number;
  /** Stable idempotency key for this op — survives retries, so a replay is
   *  recognisable as the same logical write rather than a new one. */
  opId: string;
  createdAt: string;
  /** When the device produced this write. Authoritative for last-write-wins
   *  even if the ops reach the server out of order. */
  client_timestamp: string;
  /** Monotonic per-device counter (Lamport clock, persisted in `cache`). Higher
   *  wins when two ops touch the same row. */
  sync_version: number;
  attempts: number;
  /** Earliest time this op may be retried — exponential backoff. */
  nextAttemptAt: string;
  status: QueueStatus;
  lastError?: string;
}

export type QueuedOp = PendingOp & QueueMeta;

export interface FlushResult {
  synced: number;
  /** Attempted and rejected this round; still queued, now backing off. */
  failed: number;
  /** Skipped because their backoff window hasn't elapsed. */
  deferred: number;
  /** Dropped without sending — a newer op for the same row supersedes them. */
  superseded: number;
  /** Moved to `failed` status: out of attempts, or a permanent schema error. */
  parked: number;
}

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;
const SYNC_VERSION_KEY = "sync:version";

/** Full jitter on top of doubling, so a fleet of ops that failed together
 *  doesn't retry in lockstep. */
function backoffMs(attempts: number): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Errors that will fail identically forever — retrying only burns battery and
 *  keeps a poison pill at the head of the queue. Schema-shape problems only:
 *  anything that could resolve itself (auth, network, a parent row that hasn't
 *  synced yet — 23503) stays on normal backoff. */
const PERMANENT_ERROR_CODES = new Set([
  "PGRST204", // column not found in schema cache
  "PGRST205", // table not found in schema cache
  "42703",    // undefined_column
  "42P01",    // undefined_table
  "22P02",    // invalid text representation (e.g. "guest-user" as a uuid)
  "23502",    // not_null_violation
]);

function isPermanentError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e && PERMANENT_ERROR_CODES.has(String(e.code ?? ""))) return true;
  const msg = String(e?.message ?? "").toLowerCase();
  return msg.includes("could not find the") && msg.includes("column");
}

/** Identity of the row an op ultimately writes. Two ops sharing a key are
 *  redundant — only the highest `sync_version` needs to reach the server.
 *
 *  `save_workout` gets its own namespace even though it targets
 *  `workout_sessions`: it also carries the session's sets, so letting a plain
 *  session upsert supersede it would silently drop every set. */
function supersedeKeyOf(op: PendingOp): string | null {
  if (op.type === "save_workout") return `save_workout#${op.sessionId}`;
  if (op.type === "upsert") {
    const id = op.payload?.id;
    return typeof id === "string" ? `${op.table}#id:${id}` : null;
  }
  return `${op.table}#${op.column}:${op.value}`;
}

/** Reads a queue row written by any past version of this file. Rows predating
 *  the envelope have no metadata at all; they get version 0 so they still flush
 *  ahead of anything stamped since, ordered among themselves by insert key.
 *  This is the queue's own "safe fallback migration" — no rewrite pass, no
 *  chance of an upgrade dropping writes that were waiting to sync. */
function normalizeQueuedOp(raw: Record<string, unknown>): QueuedOp {
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
  return {
    ...(raw as unknown as PendingOp),
    id: typeof raw.id === "number" ? raw.id : undefined,
    opId: typeof raw.opId === "string" ? raw.opId : `legacy-${String(raw.id ?? generateUUID())}`,
    createdAt,
    client_timestamp: typeof raw.client_timestamp === "string" ? raw.client_timestamp : createdAt,
    sync_version: typeof raw.sync_version === "number" ? raw.sync_version : 0,
    attempts: typeof raw.attempts === "number" ? raw.attempts : 0,
    nextAttemptAt: typeof raw.nextAttemptAt === "string" ? raw.nextAttemptAt : createdAt,
    status: raw.status === "failed" ? "failed" : "pending",
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
  };
}

function isNewer(a: QueuedOp, b: QueuedOp): boolean {
  if (a.sync_version !== b.sync_version) return a.sync_version > b.sync_version;
  return (a.id ?? 0) > (b.id ?? 0);
}

async function readQueue(): Promise<QueuedOp[]> {
  const db = await getDb();
  if (!db) return [];
  const raw = (await db.getAll("pendingOps")) as Record<string, unknown>[];
  return raw.map(normalizeQueuedOp);
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
        ...(TABLES_WITH_UPDATED_AT.includes(op.table) ? { updated_at: new Date().toISOString() } : {}),
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
    // Merge onto the stored session rather than replacing it: callers send only
    // {id, user_id, session_date}, and a bare put() wiped notes, folder_id and
    // created_at on every set edit. Read before opening the write tx (rule 6).
    const existingSession = await db.get("workout_sessions", op.sessionId);
    const sessionPayload: Record<string, unknown> = { ...(existingSession ?? {}), ...op.sessionPayload };
    if (!sessionPayload.id) sessionPayload.id = op.sessionId;
    if (!sessionPayload.created_at) sessionPayload.created_at = new Date().toISOString();
    const txSess = db.transaction("workout_sessions", "readwrite");
    txSess.objectStore("workout_sessions").put(sessionPayload);
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
    // The queued op must carry the same ids, or the server mints its own and
    // the device and cloud disagree about every set — backupToCloud (upsert on
    // id) then inserts a second copy of each one.
    op.sets = newSets;
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
    await cascadeDeleteChildren(db, op.table, new Set(records.map((r: any) => r.id)));
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

/** Monotonic device clock. Persisted so an app restart can never hand out a
 *  version below one already sitting in the queue. */
async function nextSyncVersion(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const entry = await db.get("cache", SYNC_VERSION_KEY);
  const current = typeof entry?.data === "number" ? entry.data : 0;
  const next = current + 1;
  await db.put("cache", { key: SYNC_VERSION_KEY, data: next, cachedAt: new Date().toISOString() });
  return next;
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
  if (!currentUserId || currentUserId === "guest-user") return;

  const now = new Date().toISOString();
  const envelope: QueuedOp = {
    ...op,
    opId: generateUUID(),
    createdAt: now,
    client_timestamp: now,
    sync_version: await nextSyncVersion(),
    attempts: 0,
    nextAttemptAt: now,
    status: "pending",
  };

  // Collapse the previous op for this same row. `executeLocalOp` always hands
  // back the *merged* row, so the newest payload is the complete final state and
  // the older ones carry nothing extra. Without this the queue grows one op per
  // tap for repeatedly-edited values (water, body weight) while offline.
  // Restricted to same-kind pairs: an upsert replacing a delete (or vice versa)
  // is resolved at flush time by version instead, where the ordering rules live.
  const key = supersedeKeyOf(op);
  if (key) {
    const stale = (await readQueue()).filter(
      q => q.status === "pending" && q.type === op.type && q.id != null && supersedeKeyOf(q) === key
    );
    if (stale.length > 0) {
      const staleTx = db.transaction("pendingOps", "readwrite");
      const staleStore = staleTx.objectStore("pendingOps");
      for (const s of stale) {
        staleStore.delete(s.id as number);
      }
      await staleTx.done;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).add("pendingOps", envelope);
}

/** Serialises concurrent flushes. Mount, the `online` event, `visibilitychange`
 *  and every component's `triggerSync()` can all fire at once; without this two
 *  passes could read the same op and send it twice. */
let flushInFlight: Promise<FlushResult> | null = null;

export function flushQueue(): Promise<FlushResult> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = doFlush().finally(() => { flushInFlight = null; });
  return flushInFlight;
}

async function sendOp(op: QueuedOp): Promise<void> {
  const { withTimeout } = await import("./auth-utils");
  const anyOp = op as any;

  if (op.type === "save_workout") {
    const { error: sessErr } = await withTimeout(supabaseOnline
      .from("workout_sessions")
      .upsert(anyOp.sessionPayload));
    if (sessErr) throw sessErr;

    // Replace-all semantics: clearing first is what makes a replay of this op
    // idempotent — re-running it can never duplicate the session's sets. The
    // delete runs even for an empty list: removing a session's last exercise
    // sends `sets: []`, and skipping the delete left those sets on the server
    // to reappear on the next refetch (executeLocalOp already clears locally).
    const { error: delErr } = await withTimeout(supabaseOnline
      .from("workout_sets")
      .delete()
      .eq("session_id", anyOp.sessionId));
    if (delErr) throw delErr;

    if (anyOp.sets && anyOp.sets.length > 0) {
      const { error: setsErr } = await withTimeout(supabaseOnline
        .from("workout_sets")
        .insert(anyOp.sets));
      if (setsErr) throw setsErr;
    }
    return;
  }

  if (op.type === "upsert") {
    const conflictOn = anyOp.conflictOn as string | undefined;
    const payload = { ...anyOp.payload };
    // Ops queued before executeLocalOp started guarding the updated_at stamp
    // (or a parked op being retried) can still carry it — strip it here too so
    // an old queued row doesn't keep failing forever on a table that never had
    // the column remotely.
    if (!TABLES_WITH_UPDATED_AT.includes(anyOp.table)) delete payload.updated_at;
    const { error } = await withTimeout(supabaseOnline
      .from(anyOp.table as string)
      .upsert(payload, conflictOn ? { onConflict: conflictOn } : undefined));
    if (error) throw error;
    return;
  }

  const { error } = await withTimeout(supabaseOnline
    .from(anyOp.table as string)
    .delete()
    .eq(anyOp.column as string, anyOp.value as string));
  if (error) throw error;
}

// Tables with a real cross-table foreign-key relationship to another synced
// table (verified against migrations/schema.sql: workout_folders is even
// self-referential via parent_folder_id, workout_sessions.folder_id ->
// workout_folders, routine_exercises/workout_sets -> workout_folders /
// workout_sessions / exercises). Every other table only ever references
// auth.users, so ops that target them carry no ordering constraint against
// anything else and can safely flush concurrently.
const TRAINING_LANE_TABLES = new Set([
  "exercises", "workout_folders", "workout_sessions", "workout_sets", "routine_exercises",
]);

function isTrainingOp(op: QueuedOp): boolean {
  return op.type === "save_workout" || TRAINING_LANE_TABLES.has(op.table);
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

async function doFlush(): Promise<FlushResult> {
  const result: FlushResult = { synced: 0, failed: 0, deferred: 0, superseded: 0, parked: 0 };
  const db = await getDb();
  if (!db) return result;
  if (!supabaseOnline) return result;

  const all = await readQueue();
  const live = all.filter(op => op.status === "pending");

  // ── Version locking: one winner per row ────────────────────────────────────
  // Two queued ops for the same row mean the older one's payload was already
  // overwritten locally; sending it would push a stale value at the server and,
  // if it landed after the newer one, silently undo the user's last edit.
  const winners = new Map<string, QueuedOp>();
  const superseded = new Set<number>();
  for (const op of live) {
    const key = supersedeKeyOf(op);
    if (!key) continue; // unkeyed op — always sent, never collapsed
    const current = winners.get(key);
    if (!current) {
      winners.set(key, op);
      continue;
    }
    const opWins = isNewer(op, current);
    winners.set(key, opWins ? op : current);
    const loser = opWins ? current : op;
    if (loser.id != null) superseded.add(loser.id);
  }

  if (superseded.size > 0) {
    const supersedeTx = db.transaction("pendingOps", "readwrite");
    const supersedeStore = supersedeTx.objectStore("pendingOps");
    for (const id of superseded) supersedeStore.delete(id);
    await supersedeTx.done;
    result.superseded = superseded.size;
  }

  // Ascending version keeps parents ahead of children (a folder before its
  // routine_exercises), which is what stops avoidable FK violations.
  const ordered = live
    .filter(op => op.id == null || !superseded.has(op.id))
    .sort((a, b) => (a.sync_version - b.sync_version) || ((a.id ?? 0) - (b.id ?? 0)));

  const now = Date.now();
  const dueOps: QueuedOp[] = [];
  for (const op of ordered) {
    if (Date.parse(op.nextAttemptAt) > now) result.deferred++;
    else dueOps.push(op);
  }

  const processOp = async (op: QueuedOp): Promise<void> => {
    try {
      await sendOp(op);
      if (op.id != null) await db.delete("pendingOps", op.id);
      result.synced++;
    } catch (err) {
      const attempts = op.attempts + 1;
      const permanent = isPermanentError(err);
      const park = permanent || attempts >= MAX_ATTEMPTS;

      console.error(
        `Failed to flush op ${op.opId} (attempt ${attempts}${permanent ? ", permanent" : ""}):`,
        op,
        err
      );

      if (op.id != null) {
        await db.put("pendingOps", {
          ...(op as unknown as Record<string, unknown>),
          id: op.id,
          attempts,
          status: park ? "failed" : "pending",
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)).toISOString(),
          lastError: String((err as { message?: unknown })?.message ?? err),
        } as never);
      }

      if (park) result.parked++;
      result.failed++;
    }
  };

  // Training-table ops carry real cross-table FK dependencies and must stay
  // strictly sequential in their existing sync_version order (see
  // TRAINING_LANE_TABLES above). Every other table has no relationship to
  // anything else, so those ops have no ordering constraint and can all
  // flush concurrently — this is what turns "N sequential round-trips" into
  // "as long as the slowest one takes" for the common case of a mix of
  // unrelated edits (food/weight/water) queued together. A modest concurrency
  // cap avoids firing an unbounded burst at Supabase if the queue is large.
  const trainingOps    = dueOps.filter(isTrainingOp);
  const independentOps = dueOps.filter(op => !isTrainingOp(op));

  async function runTrainingLane(): Promise<void> {
    for (const op of trainingOps) await processOp(op);
  }

  await Promise.all([
    runTrainingLane(),
    runWithConcurrency(independentOps, 6, processOp),
  ]);

  return result;
}

/** Ops still on their way to the server. Excludes parked (`failed`) ops on
 *  purpose: they will not move on their own, so counting them would keep the
 *  sync banner spinning and permanently block the stats page's fetch. */
export async function getPendingCount(): Promise<number> {
  const ops = await readQueue();
  return ops.filter(op => op.status === "pending").length;
}

/** Ops that gave up — out of retries, or rejected by a schema the server does
 *  not have. Their data is already safe in IndexedDB; only the upload stalled. */
export async function getFailedCount(): Promise<number> {
  const ops = await readQueue();
  return ops.filter(op => op.status === "failed").length;
}

export async function getQueueStats(): Promise<{ pending: number; failed: number; oldest: string | null }> {
  const ops = await readQueue();
  const pending = ops.filter(op => op.status === "pending");
  const failed = ops.filter(op => op.status === "failed");
  const oldest = ops.reduce<string | null>(
    (acc, op) => (acc == null || op.client_timestamp < acc ? op.client_timestamp : acc),
    null
  );
  return { pending: pending.length, failed: failed.length, oldest };
}

/** Puts parked ops back in rotation — e.g. after the missing migration finally
 *  ran. Resets the backoff so the next flush picks them up immediately. */
export async function retryFailedOps(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const ops = await readQueue();
  const parked = ops.filter(op => op.status === "failed" && op.id != null);
  if (parked.length > 0) {
    const now = new Date().toISOString();
    const tx = db.transaction("pendingOps", "readwrite");
    const store = tx.objectStore("pendingOps");
    for (const op of parked) {
      store.put({
        ...(op as unknown as Record<string, unknown>),
        id: op.id,
        attempts: 0,
        status: "pending",
        nextAttemptAt: now,
      } as never);
    }
    await tx.done;
  }
  return parked.length;
}

/* ── Overlay readers ─────────────────────────────────────────────────────────
   These deliberately include parked ops: their writes are already in IndexedDB
   and must keep showing in the UI whether or not the upload ever succeeds. */

export async function getPendingUpsertsForTable(table: string): Promise<Record<string, unknown>[]> {
  const ops = await readQueue();
  return ops
    .filter(op => op.type === "upsert" && op.table === table)
    .map(op => (op as Extract<QueuedOp, { type: "upsert" }>).payload);
}

export async function getPendingSaveWorkouts(): Promise<Array<{
  sessionId:      string;
  sessionPayload: Record<string, unknown>;
  sets:           Record<string, unknown>[];
}>> {
  const ops = await readQueue();
  return ops
    .filter(op => op.type === "save_workout")
    .map(op => {
      const w = op as Extract<QueuedOp, { type: "save_workout" }>;
      return { sessionId: w.sessionId, sessionPayload: w.sessionPayload, sets: w.sets };
    });
}

export async function getPendingDeletesForTable(
  table: string
): Promise<Array<{ column: string; value: string }>> {
  const ops = await readQueue();
  return ops
    .filter(op => op.type === "delete" && op.table === table)
    .map(op => {
      const d = op as Extract<QueuedOp, { type: "delete" }>;
      return { column: d.column, value: d.value };
    });
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
    // Keep the row's real id — executeLocalOp always assigns one, and the queued
    // op will sync under it. A made-up id here leaks into page caches, and
    // children/renames/deletes written against it can never reach the server.
    else copy.push((op.id != null ? { ...op } : { ...op, id: generateUUID() }) as T);
  }
  return copy;
}

/** Most-recently-logged distinct foods for a user, one entry per food name
 *  (keeping the latest log), within the last `days` days. Local-only read. */
export async function getRecentFoodLogs(userId: string, days = 30, limit = 8): Promise<FoodLog[]> {
  const db = await getDb();
  if (!db) return [];
  const allLogs: FoodLog[] = await db.getAll("food_logs");
  const deletedIds = new Set((await getPendingDeletesForTable("food_logs")).map(d => d.value));
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  const byName = new Map<string, FoodLog>();
  allLogs
    .filter(l => l.user_id === userId && l.logged_date >= cutoff && !deletedIds.has(l.id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .forEach(l => {
      if (!byName.has(l.food_name)) byName.set(l.food_name, l);
    });

  return Array.from(byName.values()).slice(0, limit);
}
