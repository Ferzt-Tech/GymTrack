import { getDb } from "./db";
import { format } from "date-fns";

const EXPORT_TABLES = [
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

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function stamp(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const lines = rows.map(r => columns.map(c => csvEscape(r[c])).join(","));
  return [header, ...lines].join("\n");
}

/** Full dump of every local table as one JSON file (100% data ownership). */
export async function exportAllAsJson(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  const dump: Record<string, unknown[]> = {};
  for (const table of EXPORT_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dump[table] = await db.getAll(table as any);
  }
  download(
    `gymtrack-export-${stamp()}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), data: dump }, null, 2),
    "application/json"
  );
}

/** Workout history (one row per set, joined with its session date) as CSV. */
export async function exportWorkoutsAsCsv(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  const sessions = await db.getAll("workout_sessions");
  const sets = await db.getAll("workout_sets");
  const dateOf = new Map<string, string>(sessions.map((s: { id: string; session_date: string }) => [s.id, s.session_date]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (sets as any[])
    .map(s => ({
      session_date:  dateOf.get(s.session_id) ?? "",
      exercise_name: s.exercise_name,
      set_number:    s.set_number,
      set_type:      s.set_type ?? "normal",
      weight:        s.weight,
      weight_unit:   s.weight_unit ?? "kg",
      reps:          s.reps,
      rpe:           s.rpe,
      notes:         s.notes,
      drops:         s.drops,
    }))
    .sort((a, b) => a.session_date.localeCompare(b.session_date) || a.exercise_name.localeCompare(b.exercise_name) || a.set_number - b.set_number);

  download(
    `gymtrack-workouts-${stamp()}.csv`,
    toCsv(rows, ["session_date", "exercise_name", "set_number", "set_type", "weight", "weight_unit", "reps", "rpe", "notes", "drops"]),
    "text/csv"
  );
}
