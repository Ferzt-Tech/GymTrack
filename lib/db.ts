import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface GymTrackDB extends DBSchema {
  pendingOps: {
    key: number;
    value: Record<string, unknown> & { id?: number; type: string; createdAt: string };
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
}

let _db: Promise<IDBPDatabase<GymTrackDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<GymTrackDB>> | null {
  if (typeof window === "undefined") return null;
  if (!_db) {
    _db = openDB<GymTrackDB>("gymtrack", 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("pendingOps")) {
          db.createObjectStore("pendingOps", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("cache")) {
          db.createObjectStore("cache", { keyPath: "key" });
        }
        const tables = [
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
        ] as const;
        for (const table of tables) {
          if (!db.objectStoreNames.contains(table)) {
            db.createObjectStore(table, { keyPath: "id" });
          }
        }
      },
    });
  }
  return _db;
}
