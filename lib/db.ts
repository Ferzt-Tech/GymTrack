import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const DB_NAME = "gymtrack";

/** Bumped to 6 for the `volume_feedback` and `recipes` stores. Upgrades here are
 *  strictly *additive*: every version creates whatever stores are missing and
 *  never drops or rewrites one, so a device sitting on any older version lands
 *  on the full set without touching a byte of existing data. */
export const DB_VERSION = 6;

interface GymTrackDB extends DBSchema {
  pendingOps: {
    key: number;
    value: Record<string, unknown> & {
      id?: number;
      type: string;
      createdAt: string;
      /** Sync envelope — see lib/offlineQueue.ts. These live on the queue row,
       *  never inside `payload`, so they are never uploaded to PostgREST. */
      opId?: string;
      sync_version?: number;
      client_timestamp?: string;
      attempts?: number;
      nextAttemptAt?: string;
      status?: "pending" | "failed";
      lastError?: string;
    };
  };
  cache: {
    key: string;
    value: { key: string; data: unknown; cachedAt: string };
  };
  profiles: {
    key: string;
    value: any;
  };
  daily_weight_logs: {
    key: string;
    value: any;
  };
  water_logs: {
    key: string;
    value: any;
  };
  progress_photos: {
    key: string;
    value: any;
  };
  exercises: {
    key: string;
    value: any;
  };
  workout_folders: {
    key: string;
    value: any;
  };
  workout_sessions: {
    key: string;
    value: any;
  };
  workout_sets: {
    key: string;
    value: any;
  };
  routine_exercises: {
    key: string;
    value: any;
  };
  personal_records: {
    key: string;
    value: any;
  };
  food_logs: {
    key: string;
    value: any;
  };
  saved_foods: {
    key: string;
    value: any;
  };
  volume_feedback: {
    key: string;
    value: any;
  };
  recipes: {
    key: string;
    value: any;
  };
}

/** Every `id`-keyed data store. Adding a name here is all an upgrade needs —
 *  `ensureStores` creates whatever is missing at any version. */
export const DATA_STORES = [
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
  "volume_feedback",
  "recipes",
] as const;

/** Stores that hold data the Supabase pipeline never sees — they exist only on
 *  this device (see lib/volumeFeedback.ts / lib/recipes.ts). Kept out of
 *  REMOTE_TABLES / LOCAL_TABLES / TABLES_BACKUP_ORDER on purpose; listed here so
 *  the data export can still include them. */
export const LOCAL_ONLY_STORES = ["volume_feedback", "recipes"] as const;

// Tables whose remote schema has NO user_id column — ownership is derived
// through a parent row (workout_sets → workout_sessions, routine_exercises →
// workout_folders). Stamping a user_id on their local rows makes any raw push
// (backup, flush) fail with PostgREST "could not find the 'user_id' column".
export const TABLES_WITHOUT_USER_ID = ["workout_sets", "routine_exercises"];

// Tables whose remote schema HAS an updated_at column. executeLocalOp's merge
// path must only stamp updated_at for these — every other table (routine_exercises,
// exercises, workout_folders, workout_sets, workout_sessions, daily_weight_logs,
// progress_photos, saved_foods) has no such column remotely, and PostgREST
// rejects the entire upsert over one unknown column (same failure class as
// TABLES_WITHOUT_USER_ID above). Stamping it unconditionally on every table's
// update-merge was the bug behind "Backup failed on table routine_exercises:
// Could not find the 'updated_at' column".
export const TABLES_WITH_UPDATED_AT = ["profiles", "water_logs", "food_logs"];

let _db: Promise<IDBPDatabase<GymTrackDB> | null> | null = null;

/** Idempotent, order-independent store creation. Safe to run from any
 *  `oldVersion` — it only ever adds what is absent. */
function ensureStores(db: IDBPDatabase<GymTrackDB>): void {
  if (!db.objectStoreNames.contains("pendingOps")) {
    db.createObjectStore("pendingOps", { keyPath: "id", autoIncrement: true });
  }
  if (!db.objectStoreNames.contains("cache")) {
    db.createObjectStore("cache", { keyPath: "key" });
  }
  for (const table of DATA_STORES) {
    if (!db.objectStoreNames.contains(table)) {
      db.createObjectStore(table, { keyPath: "id" });
    }
  }
}

/** Drop our handle so another tab's upgrade (or a terminated connection) can
 *  proceed; the next getDb() transparently reopens. */
function releaseHandle(): void {
  const pending = _db;
  _db = null;
  pending?.then(d => d?.close()).catch(() => {});
}

/** True only for a genuine version mismatch (this device already ran a NEWER
 *  build, so its on-disk version is above DB_VERSION and requesting ours
 *  throws). Its schema is necessarily complete — stores are only ever added,
 *  never removed — so attaching to it as-is is safe. Any other failure (most
 *  notably a quota error aborting the upgrade transaction mid-way, which
 *  leaves the on-disk database at its OLD version) is not this case and must
 *  not be treated as one. */
function isVersionMismatch(err: unknown): boolean {
  return err instanceof DOMException && err.name === "VersionError";
}

/** Whether `db` is missing any store `ensureStores` is supposed to have
 *  created — the symptom of attaching to a database whose upgrade transaction
 *  aborted partway through instead of a clean version mismatch. */
function isMissingStores(db: IDBPDatabase<GymTrackDB>): boolean {
  return !db.objectStoreNames.contains("pendingOps")
    || !db.objectStoreNames.contains("cache")
    || !DATA_STORES.every(table => db.objectStoreNames.contains(table));
}

async function openGymTrackDb(): Promise<IDBPDatabase<GymTrackDB> | null> {
  if (typeof indexedDB === "undefined") return null;

  try {
    return await openDB<GymTrackDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        ensureStores(db);
      },
      blocked() {
        // Another tab still holds an older connection. It will close eventually;
        // idb keeps waiting, so this is informational only.
        console.warn(`[db] upgrade to v${DB_VERSION} blocked by another open tab`);
      },
      blocking() {
        releaseHandle();
      },
      terminated() {
        releaseHandle();
      },
    });
  } catch (err) {
    // Reopen without a version to attach to whatever is there — a downgrade must
    // degrade to "read the newer schema", never to "wipe and start over".
    // deleteDatabase is never an option here: that is the user's entire history.
    const versionMismatch = isVersionMismatch(err);
    console.error(
      `[db] open at v${DB_VERSION} failed${versionMismatch ? " (version mismatch)" : ""}, retrying without a version:`,
      err
    );

    let fallback: IDBPDatabase<GymTrackDB>;
    try {
      fallback = await openDB<GymTrackDB>(DB_NAME);
    } catch (fallbackErr) {
      // IndexedDB genuinely unavailable (private mode, quota, corrupt profile).
      // Resolve null rather than reject: every call site already guards on a
      // falsy db, so the app degrades to in-memory instead of throwing on load.
      console.error("[db] IndexedDB unavailable — local persistence disabled:", fallbackErr);
      return null;
    }

    // A version mismatch's schema is trusted as complete (see isVersionMismatch).
    // Anything else — the fallback attached to a database that never finished
    // its upgrade — needs verifying: attaching to it silently would mean some
    // call sites' `db.transaction(missingStore, ...)` throws a raw NotFoundError
    // for the rest of the session.
    if (versionMismatch || !isMissingStores(fallback)) return fallback;

    console.error("[db] fallback database is missing expected stores — retrying a versioned upgrade");
    fallback.close();
    try {
      return await openDB<GymTrackDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          ensureStores(db);
        },
      });
    } catch (retryErr) {
      console.error("[db] versioned upgrade retry also failed — reopening without a version as a last resort:", retryErr);
      try {
        return await openDB<GymTrackDB>(DB_NAME);
      } catch {
        return null;
      }
    }
  }
}

export function getDb(): Promise<IDBPDatabase<GymTrackDB> | null> | null {
  if (typeof window === "undefined") return null;
  if (!_db) {
    _db = openGymTrackDb();
  }
  return _db;
}
