/**
 * Single source of truth for every per-user data table/store.
 *
 * Before this file, the same set of table names was hand-copied across five
 * places (DATA_STORES/LOCAL_ONLY_STORES/TABLES_WITHOUT_USER_ID/TABLES_WITH_UPDATED_AT
 * in lib/db.ts, LOCAL_TABLES in lib/offlineQueue.ts, REMOTE_TABLES in
 * lib/supabase.ts, TABLES_BACKUP_ORDER in lib/backupService.ts, EXPORT_TABLES in
 * lib/exportData.ts) and had already drifted once (see CLAUDE.md's
 * food_logs/saved_foods incidents). Add a table here once; every derived list
 * below picks it up automatically.
 *
 * Order matters: this is also backupToCloud/restoreFromCloud's upload order, so
 * parents must precede children (workout_folders before routine_exercises,
 * workout_sessions before workout_sets) to avoid self-inflicted FK violations.
 *
 * app_settings deliberately has NO entry here: it's a global singleton (see
 * CLAUDE.md's "Admin panel" section), not per-user local-first data, and must
 * never be synced/backed-up/exported through this pipeline.
 */

export interface TableConfig {
  name: string;
  /** Device-local only — never synced to Supabase (no LOCAL_TABLES/REMOTE_TABLES/
   *  TABLES_BACKUP_ORDER membership). See lib/volumeFeedback.ts / lib/recipes.ts. */
  localOnly?: boolean;
  /** Remote schema has no user_id column — ownership flows through a parent row
   *  (workout_sets → workout_sessions, routine_exercises → workout_folders). */
  noUserId?: boolean;
  /** Remote schema has an updated_at column executeLocalOp's merge path may stamp. */
  hasUpdatedAt?: boolean;
}

export const TABLE_REGISTRY: readonly TableConfig[] = [
  { name: "profiles", hasUpdatedAt: true },
  { name: "exercises" },
  { name: "workout_folders" },
  { name: "routine_exercises", noUserId: true },
  { name: "workout_sessions" },
  { name: "workout_sets", noUserId: true },
  { name: "daily_weight_logs" },
  { name: "water_logs", hasUpdatedAt: true },
  { name: "food_logs", hasUpdatedAt: true },
  { name: "saved_foods" },
  { name: "progress_photos" },
  // Remote table added in migrations/add_personal_records.sql (also folded
  // into reconcile_schema.sql) — must be applied by hand in the Supabase SQL
  // editor before this ships. Until then, any enqueued write 42P01
  // poison-pills safely (see offlineQueue.ts's permanent-error list) rather
  // than looping, but stays silently inert.
  { name: "personal_records" },
  { name: "volume_feedback", localOnly: true },
  { name: "recipes", localOnly: true },
] as const;

const namesOf = (pred: (t: TableConfig) => boolean): string[] =>
  TABLE_REGISTRY.filter(pred).map(t => t.name);

/** Every id-keyed IndexedDB store — synced and local-only alike. */
export const ALL_TABLE_NAMES: string[] = TABLE_REGISTRY.map(t => t.name);
/** Tables mirrored to/from Supabase (local-first queue + online reads). */
export const SYNCED_TABLE_NAMES: string[] = namesOf(t => !t.localOnly);
/** Tables that exist only on-device (see lib/volumeFeedback.ts / lib/recipes.ts). */
export const LOCAL_ONLY_TABLE_NAMES: string[] = namesOf(t => !!t.localOnly);
/** Tables whose remote schema has no user_id column. */
export const NO_USER_ID_TABLE_NAMES: string[] = namesOf(t => !!t.noUserId);
/** Tables whose remote schema has an updated_at column. */
export const UPDATED_AT_TABLE_NAMES: string[] = namesOf(t => !!t.hasUpdatedAt);
