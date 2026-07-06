import { getDb } from "./db";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export const supabaseOnline = typeof window !== "undefined" ? createClientComponentClient() : null as any;

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

// Simple event listeners for auth changes (if components listen to mock, though they should listen to real auth)
const authListeners = new Set<(event: string, session: any) => void>();

// Subscribe to real auth state changes to update the local cached user ID
if (typeof window !== "undefined" && supabaseOnline) {
  supabaseOnline.auth.onAuthStateChange(async (event: any, session: any) => {
    const db = await getDb();
    if (db) {
      if (session?.user) {
        await db.put("cache", {
          key: "auth:userId",
          data: session.user.id,
          cachedAt: new Date().toISOString(),
        });
      } else {
        await db.delete("cache", "auth:userId");
      }
    }
    authListeners.forEach((cb) => cb(event, session));
  });
}

class MockQueryBuilder {
  private table: string;
  private method: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: any = null;
  private filters: Array<(item: any) => boolean> = [];
  private orderByField: string | null = null;
  private orderAscending = true;
  private isSingle = false;
  private isMaybeSingle = false;
  private limitCount: number | null = null;
  private selectString = "";

  constructor(table: string) {
    this.table = table;
  }

  select(fields = "*") {
    this.selectString = fields;
    return this;
  }

  insert(payload: any) {
    this.method = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: any) {
    this.method = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: any, options?: any) {
    this.method = "upsert";
    this.payload = payload;
    return this;
  }

  delete() {
    this.method = "delete";
    return this;
  }

  eq(field: string, value: any) {
    this.filters.push((item) => item[field] === value);
    return this;
  }

  in(field: string, values: any[]) {
    this.filters.push((item) => values.includes(item[field]));
    return this;
  }

  gte(field: string, value: any) {
    this.filters.push((item) => item[field] >= value);
    return this;
  }

  lte(field: string, value: any) {
    this.filters.push((item) => item[field] <= value);
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderByField = field;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  async execute() {
    const db = await getDb();
    if (!db) {
      return { data: null, error: new Error("Database not initialized") };
    }

    try {
      if (this.method === "select") {
        let records = await db.getAll(this.table as any);
        
        // Filter
        for (const filter of this.filters) {
          records = records.filter(filter);
        }

        // Sort
        if (this.orderByField) {
          records.sort((a, b) => {
            const valA = a[this.orderByField!];
            const valB = b[this.orderByField!];
            if (valA === valB) return 0;
            if (valA == null) return 1;
            if (valB == null) return -1;
            const comp = valA < valB ? -1 : 1;
            return this.orderAscending ? comp : -comp;
          });
        }

        // Limit
        if (this.limitCount !== null) {
          records = records.slice(0, this.limitCount);
        }

        // Relationships (sets for workout_sessions)
        if (this.table === "workout_sessions" && this.selectString.includes("sets:workout_sets")) {
          const allSets = await db.getAll("workout_sets");
          records = records.map((session: any) => {
            const sets = allSets.filter((s: any) => s.session_id === session.id);
            return { ...session, sets };
          });
        }

        // Single vs list
        if (this.isSingle || this.isMaybeSingle) {
          if (records.length === 0) {
            if (this.isMaybeSingle) return { data: null, error: null };
            return { data: null, error: new Error("Row not found") };
          }
          return { data: records[0], error: null };
        }

        return { data: records, error: null };
      }

      if (this.method === "insert") {
        const isArray = Array.isArray(this.payload);
        const items = isArray ? this.payload : [this.payload];
        const inserted: any[] = [];

        const sessionEntry = await db.get("cache", "auth:userId");
        const currentUserId = sessionEntry?.data as string | undefined;

        const tx = db.transaction(this.table as any, "readwrite");
        const store = tx.objectStore(this.table as any);

        for (const inputItem of items) {
          const item = { ...inputItem };
          if (!item.id) {
            item.id = generateUUID();
          }
          if (!item.created_at && this.table !== "water_logs") {
            item.created_at = new Date().toISOString();
          }
          if (!item.user_id && currentUserId) {
            item.user_id = currentUserId;
          }
          await store.put(item);
          inserted.push(item);
        }
        await tx.done;

        if (this.isSingle) {
          return { data: inserted[0] || null, error: null };
        }
        return { data: inserted, error: null };
      }

      if (this.method === "update") {
        let records = await db.getAll(this.table as any);
        for (const filter of this.filters) {
          records = records.filter(filter);
        }

        const updated: any[] = [];
        const tx = db.transaction(this.table as any, "readwrite");
        const store = tx.objectStore(this.table as any);

        for (const r of records) {
          const merged = {
            ...r,
            ...this.payload,
            updated_at: new Date().toISOString(),
          };
          await store.put(merged);
          updated.push(merged);
        }
        await tx.done;

        if (this.isSingle) {
          return { data: updated[0] || null, error: null };
        }
        return { data: updated, error: null };
      }

      if (this.method === "upsert") {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        const upserted: any[] = [];
        
        const sessionEntry = await db.get("cache", "auth:userId");
        const currentUserId = sessionEntry?.data as string | undefined;

        const tx = db.transaction(this.table as any, "readwrite");
        const store = tx.objectStore(this.table as any);

        let allRecords: any[] = [];
        if (this.table === "daily_weight_logs" || this.table === "water_logs") {
          allRecords = await db.getAll(this.table as any);
        }

        for (const inputItem of items) {
          const item = { ...inputItem };
          let existing: any = null;

          if (item.id) {
            existing = await store.get(item.id);
          } else if ((this.table === "daily_weight_logs" || this.table === "water_logs") && currentUserId) {
            existing = allRecords.find(
              (r) =>
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
            upserted.push(merged);
          } else {
            if (!item.id) item.id = generateUUID();
            if (!item.created_at && this.table !== "water_logs") item.created_at = new Date().toISOString();
            if (!item.user_id && currentUserId) item.user_id = currentUserId;
            await store.put(item);
            upserted.push(item);
          }
        }
        await tx.done;

        if (this.isSingle) {
          return { data: upserted[0] || null, error: null };
        }
        return { data: upserted, error: null };
      }

      if (this.method === "delete") {
        let records = await db.getAll(this.table as any);
        for (const filter of this.filters) {
          records = records.filter(filter);
        }

        const tx = db.transaction(this.table as any, "readwrite");
        const store = tx.objectStore(this.table as any);

        for (const r of records) {
          await store.delete(r.id);
        }
        await tx.done;

        return { data: records, error: null };
      }

      return { data: null, error: new Error("Unsupported method") };
    } catch (err: any) {
      console.error(`MockQueryBuilder error on table ${this.table}:`, err);
      return { data: null, error: err };
    }
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

const REMOTE_TABLES: string[] = [];

export const supabase = {
  get auth() {
    return supabaseOnline?.auth;
  },
  get storage() {
    return supabaseOnline?.storage;
  },
  from(table: string): any {
    if (supabaseOnline && REMOTE_TABLES.includes(table)) {
      return supabaseOnline.from(table);
    }
    return new MockQueryBuilder(table);
  },
};

export function getStorageUrl(bucket: string, path: string): string {
  if (path.startsWith("data:") || path.startsWith("blob:") || !supabaseOnline) return path;
  const { data } = supabaseOnline.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

export async function uploadFile(
  bucket: string,
  userId: string,
  file: File
): Promise<string> {
  if (!supabaseOnline) throw new Error("Supabase Online client is not available.");
  const ext = file.name.split(".").pop();
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabaseOnline.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}
