import { getDb } from "./db";
import { getCached, setCache } from "./offlineQueue";
import { supabaseOnline } from "./supabase";

const TABLES_BACKUP_ORDER = [
  "profiles",
  "exercises",
  "workout_folders",
  "routine_exercises",
  "workout_sessions",
  "workout_sets",
  "daily_weight_logs",
  "water_logs",
  "progress_photos",
  "personal_records",
] as const;

export async function getOnlineSession() {
  if (!supabaseOnline) return { session: null };
  const { data } = await supabaseOnline.auth.getSession();
  return { session: data?.session ?? null };
}

export async function connectBackupAccount(email: string, password: string) {
  if (!supabaseOnline) throw new Error("Supabase Online client is not available.");

  const { data, error } = await supabaseOnline.auth.signInWithPassword({ email, password });
  if (error) return { data: null, error };

  const onlineUserId = data?.user?.id;
  if (onlineUserId) {
    await migrateLocalDataToUserId(onlineUserId);
  }

  return { data, error: null };
}

export async function signUpBackupAccount(email: string, password: string) {
  if (!supabaseOnline) throw new Error("Supabase Online client is not available.");

  const { data, error } = await supabaseOnline.auth.signUp({ email, password });
  if (error) return { data: null, error };

  const onlineUserId = data?.user?.id;
  if (onlineUserId) {
    await migrateLocalDataToUserId(onlineUserId);
  }

  return { data, error: null };
}

export async function disconnectBackupAccount() {
  if (supabaseOnline) {
    await supabaseOnline.auth.signOut();
  }
}

async function migrateLocalDataToUserId(onlineUserId: string) {
  const db = await getDb();
  if (!db) return;

  const localUserId = await getCached<string>("auth:userId");
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

  const { data: { session } } = await supabaseOnline.auth.getSession();
  if (!session) throw new Error("No cloud backup account connected. Please log in to backup.");

  for (const table of TABLES_BACKUP_ORDER) {
    const records = await db.getAll(table as any);
    if (records.length > 0) {
      const onConflict = (table === "daily_weight_logs" || table === "water_logs")
        ? "user_id,logged_date"
        : "id";
      
      const sanitizedRecords = records.map((r: any) => {
        if (table === "water_logs") {
          const { created_at, ...rest } = r;
          return rest;
        }
        return r;
      });

      const { error } = await supabaseOnline.from(table).upsert(sanitizedRecords, { onConflict });
      if (error) throw new Error(`Backup failed on table ${table}: ${error.message}`);
    }
  }
}

export async function restoreFromCloud() {
  if (!supabaseOnline) throw new Error("Not online");
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");

  const { data: { session } } = await supabaseOnline.auth.getSession();
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

  // Clear non-auth cache records so UI reloads fresh data
  const txCache = db.transaction("cache", "readwrite");
  const cacheStore = txCache.objectStore("cache");
  const keys = await cacheStore.getAllKeys();
  for (const key of keys) {
    if (key !== "auth:userId") {
      await cacheStore.delete(key);
    }
  }
  await txCache.done;
}
