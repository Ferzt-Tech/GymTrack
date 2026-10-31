import { getDb, TABLES_WITH_UPDATED_AT } from "./db";
import { getCached, setCache, reapplyQueuedOps } from "./offlineQueue";
import { supabaseOnline } from "./supabase";
import { withTimeout } from "./auth-utils";
import { SYNCED_TABLE_NAMES, NO_USER_ID_TABLE_NAMES } from "./tables";

// Synced tables keyed by user_id — everything except profiles (keyed by id
// itself, migrated separately below) and the tables ownership flows through
// a parent row for (see NO_USER_ID_TABLE_NAMES). Derived from the registry
// so a newly added table can't silently drift out of this migration path.
const USER_ID_TABLE_NAMES = SYNCED_TABLE_NAMES.filter(
  t => t !== "profiles" && !NO_USER_ID_TABLE_NAMES.includes(t)
);

// Order matters here — parents must precede children (workout_folders before
// routine_exercises, workout_sessions before workout_sets) to avoid
// self-inflicted FK violations. lib/tables.ts's TABLE_REGISTRY is kept in this
// exact order for that reason.
const TABLES_BACKUP_ORDER = SYNCED_TABLE_NAMES;

export async function getOnlineSession() {
  if (!supabaseOnline) return { session: null };
  try {
    const { data } = await withTimeout(supabaseOnline.auth.getSession());
    return { session: data?.session ?? null };
  } catch {
    return { session: null };
  }
}

export async function connectBackupAccount(email: string, password: string) {
  if (!supabaseOnline) throw new Error("Supabase Online client is not available.");

  // Snapshot BEFORE signing in — the auth listener in lib/supabase.ts overwrites
  // this same cache key with the new account's id as part of signInWithPassword
  // itself (onAuthStateChange is awaited before the call returns), so reading it
  // afterwards always yields the new id and silently skips migration.
  const localUserId = await getCached<string>("auth:userId");

  const { data, error } = await supabaseOnline.auth.signInWithPassword({ email, password });
  if (error) return { data: null, error };

  const onlineUserId = data?.user?.id;
  if (onlineUserId) {
    await migrateLocalDataToUserId(onlineUserId, localUserId);
  }

  return { data, error: null };
}

export async function signUpBackupAccount(email: string, password: string) {
  if (!supabaseOnline) throw new Error("Supabase Online client is not available.");

  // See connectBackupAccount — snapshot before signUp for the same reason.
  const localUserId = await getCached<string>("auth:userId");

  const { data, error } = await supabaseOnline.auth.signUp({ email, password });
  if (error) return { data: null, error };

  const onlineUserId = data?.user?.id;
  if (onlineUserId) {
    await migrateLocalDataToUserId(onlineUserId, localUserId);
  }

  return { data, error: null };
}

export async function disconnectBackupAccount() {
  if (supabaseOnline) {
    const { error } = await supabaseOnline.auth.signOut();
    if (error) throw new Error(`Sign out failed: ${error.message}`);
  }
}

async function migrateLocalDataToUserId(onlineUserId: string, localUserId: string | null) {
  const db = await getDb();
  if (!db) return;

  if (localUserId && localUserId !== onlineUserId) {
    // 1. Move profile row
    const profile = await db.get("profiles", localUserId);
    if (profile) {
      await db.delete("profiles", localUserId);
      await db.put("profiles", { ...profile, id: onlineUserId });
    }

    // 2. Migrate tables containing user_id
    for (const table of USER_ID_TABLE_NAMES) {
      const records = await db.getAll(table as any);
      const tx = db.transaction(table as any, "readwrite");
      const store = tx.objectStore(table as any);
      for (const r of records) {
        if ((r as any).user_id === localUserId) {
          store.put({ ...r, user_id: onlineUserId });
        }
      }
      await tx.done;
    }
  }

  // 3. Cache the onlineUserId as our local active user
  await setCache("auth:userId", onlineUserId);
}

export async function backupToCloud() {
  if (!supabaseOnline) throw new Error("Not online");
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");

  const { data: sessionData, error: sessionError } = await withTimeout(supabaseOnline.auth.getSession());
  if (sessionError) throw new Error(`Could not verify cloud session: ${sessionError.message}`);
  const session = sessionData?.session;
  if (!session) throw new Error("No cloud backup account connected. Please log in to backup.");

  // Self-heal #1: an account that connected before the migration-ordering fix
  // can have local rows stamped with a stale *previous real account's* id
  // instead of the current session user id.
  const cachedUserId = await getCached<string>("auth:userId");
  if (cachedUserId && cachedUserId !== session.user.id) {
    await migrateLocalDataToUserId(session.user.id, cachedUserId);
  }

  // Self-heal #2: rows created in guest mode and never migrated (e.g. because
  // the account signed in directly via /login instead of the Settings
  // "Connect Account" flow, which is the only place migration ever ran) are
  // still stamped "guest-user". The cache check above can't catch this — the
  // cache reflects the *session*, not what's actually stored on the rows.
  // Left unfixed, tables without a user_id column (routine_exercises,
  // workout_sets) keep referencing exercises/sessions that got filtered out
  // of the backup for still being guest-owned, and PostgREST rejects the FK.
  await migrateLocalDataToUserId(session.user.id, "guest-user");

  for (const table of TABLES_BACKUP_ORDER) {
    const records = await db.getAll(table as any);
    if (records.length > 0) {
      const onConflict = (table === "daily_weight_logs" || table === "water_logs")
        ? "user_id,logged_date"
        : "id";

      const sanitizedRecords = records
        // Guest-era rows can never belong to the cloud account — a non-uuid
        // "guest-user" id aborts the whole backup with a parse error.
        .filter((r: any) => r.id !== "guest-user" && r.user_id !== "guest-user")
        .map((r: any) => {
          const rest: any = { ...r };
          // Local mirrors can carry columns the remote table doesn't have;
          // PostgREST rejects the entire upsert over one unknown column.
          // updated_at is stripped for every table except the few that actually
          // have the column (older local rows can still carry it from before
          // executeLocalOp started guarding the stamp — see TABLES_WITH_UPDATED_AT).
          if (!TABLES_WITH_UPDATED_AT.includes(table)) delete rest.updated_at;
          if (table === "water_logs") delete rest.created_at;
          if (table === "workout_sets" || table === "routine_exercises") delete rest.user_id;
          if (table === "workout_sessions") delete rest.sets;
          if (table === "exercises") delete rest.machinePhotoUrl;
          if (table === "progress_photos") delete rest.publicUrl;
          return rest;
        });

      if (sanitizedRecords.length === 0) continue;
      // Generous timeout: a table can carry base64 photos, but an unbounded
      // await on a dead connection would hang the Settings spinner forever.
      const { error } = await withTimeout(supabaseOnline.from(table).upsert(sanitizedRecords, { onConflict }), 60000);
      if (error) throw new Error(`Backup failed on table ${table}: ${error.message}`);
    }
  }
}

const RESTORE_PAGE_SIZE = 1000;

async function fetchAllRows(table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += RESTORE_PAGE_SIZE) {
    const { data, error } = await withTimeout(
      supabaseOnline.from(table).select("*").order("id").range(from, from + RESTORE_PAGE_SIZE - 1),
      20000,
    );
    if (error) throw new Error(`Restore failed on table ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < RESTORE_PAGE_SIZE) return rows;
  }
}

export async function restoreFromCloud() {
  if (!supabaseOnline) throw new Error("Not online");
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");

  const { data: sessionData, error: sessionError } = await withTimeout(supabaseOnline.auth.getSession());
  if (sessionError) throw new Error(`Could not verify cloud session: ${sessionError.message}`);
  const session = sessionData?.session;
  if (!session) throw new Error("No cloud backup account connected. Please log in to restore.");

  // Download every table completely BEFORE clearing anything. A bare
  // select("*") is capped by PostgREST's max-rows (1000 by default), so a long
  // workout_sets history came back truncated — and the clear() below then
  // deleted the rest locally. Fetching all of it first also means a failure
  // mid-restore (timeout, network) leaves local data untouched.
  const fetched: Record<string, unknown[]> = {};
  for (const table of TABLES_BACKUP_ORDER) {
    fetched[table] = await fetchAllRows(table);
  }

  for (const table of TABLES_BACKUP_ORDER) {
    const tx = db.transaction(table as any, "readwrite");
    const store = tx.objectStore(table as any);
    store.clear();
    for (const r of fetched[table]) {
      store.put(r);
    }
    await tx.done;
  }

  // The sync queue survives the restore; replay it so edits that haven't
  // reached the cloud yet don't disappear from the device.
  await reapplyQueuedOps();

  // Clear non-auth cache records so UI reloads fresh data.
  // Keys under "auth:" (userId, nutrition targets/inputs) are device-local
  // state that has no cloud copy — deleting them would lose data. "sync:"
  // holds the queue's monotonic version counter: resetting it would hand new
  // ops versions below ones still queued, so a stale op would win supersede
  // and silently undo the user's newer edit.
  const cacheKeys = await db.getAllKeys("cache");
  const txCache = db.transaction("cache", "readwrite");
  const cacheStore = txCache.objectStore("cache");
  for (const key of cacheKeys) {
    const k = String(key);
    if (!k.startsWith("auth:") && !k.startsWith("sync:")) {
      cacheStore.delete(key);
    }
  }
  await txCache.done;
}
