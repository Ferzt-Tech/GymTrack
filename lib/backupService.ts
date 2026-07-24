import { getDb } from "./db";
import { getCached, setCache } from "./offlineQueue";
import { supabaseOnline } from "./supabase";
import { withTimeout } from "./auth-utils";

const TABLES_BACKUP_ORDER = [
  "profiles",
  "exercises",
  "workout_folders",
  "routine_exercises",
  "workout_sessions",
  "workout_sets",
  "daily_weight_logs",
  "water_logs",
  "food_logs",
  "saved_foods",
  "progress_photos",
  "personal_records",
] as const;

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
    await supabaseOnline.auth.signOut();
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
    const userTables = [
      "daily_weight_logs",
      "water_logs",
      "food_logs",
      "saved_foods",
      "progress_photos",
      "exercises",
      "workout_folders",
      "workout_sessions",
      "personal_records",
    ] as const;

    for (const table of userTables) {
      const records = await db.getAll(table);
      const tx = db.transaction(table, "readwrite");
      const store = tx.objectStore(table);
      for (const r of records) {
        if (r.user_id === localUserId) {
          await store.put({ ...r, user_id: onlineUserId });
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

  const { data: { session } } = await withTimeout(supabaseOnline.auth.getSession());
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
          if (table === "water_logs") delete rest.created_at;
          if (table === "workout_sets" || table === "routine_exercises") delete rest.user_id;
          if (table === "workout_sessions") delete rest.sets;
          if (table === "exercises") delete rest.machinePhotoUrl;
          if (table === "progress_photos") delete rest.publicUrl;
          return rest;
        });

      if (sanitizedRecords.length === 0) continue;
      const { error } = await supabaseOnline.from(table).upsert(sanitizedRecords, { onConflict });
      if (error) throw new Error(`Backup failed on table ${table}: ${error.message}`);
    }
  }
}

export async function restoreFromCloud() {
  if (!supabaseOnline) throw new Error("Not online");
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");

  const { data: { session } } = await withTimeout(supabaseOnline.auth.getSession());
  if (!session) throw new Error("No cloud backup account connected. Please log in to restore.");

  for (const table of TABLES_BACKUP_ORDER) {
    const { data, error } = await supabaseOnline.from(table).select("*");
    if (error) throw new Error(`Restore failed on table ${table}: ${error.message}`);

    if (data) {
      const tx = db.transaction(table as any, "readwrite");
      const store = tx.objectStore(table as any);
      await store.clear();
      for (const r of data) {
        await store.put(r);
      }
      await tx.done;
    }
  }

  // Clear non-auth cache records so UI reloads fresh data.
  // Keys under "auth:" (userId, nutrition targets/inputs) are device-local
  // state that has no cloud copy — deleting them would lose data.
  const txCache = db.transaction("cache", "readwrite");
  const cacheStore = txCache.objectStore("cache");
  const keys = await cacheStore.getAllKeys();
  for (const key of keys) {
    if (!String(key).startsWith("auth:")) {
      await cacheStore.delete(key);
    }
  }
  await txCache.done;
}
