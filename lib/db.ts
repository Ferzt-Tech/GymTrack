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
}

let _db: Promise<IDBPDatabase<GymTrackDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<GymTrackDB>> | null {
  if (typeof window === "undefined") return null;
  if (!_db) {
    _db = openDB<GymTrackDB>("gymtrack", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("pendingOps")) {
          db.createObjectStore("pendingOps", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("cache")) {
          db.createObjectStore("cache", { keyPath: "key" });
        }
      },
    });
  }
  return _db;
}
