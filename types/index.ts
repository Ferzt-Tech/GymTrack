export type WeightUnit = "kg" | "lbs";
export type DistanceUnit = "km" | "mi";
export type SetType = "normal" | "warmup" | "dropset";

export interface Drop {
  weight: number | null;
  reps: number | null;
}

export interface Profile {
  id: string;
  username: string | null;
  weight_unit: WeightUnit;
  distance_unit: DistanceUnit;
  water_goal_liters: number;
  water_reminder_enabled: boolean;
  /** Personal Gemini API key for AI meal scanning, synced across devices via
   *  this profile row. Set from Settings → AI Meal Scanner. */
  gemini_api_key?: string | null;
  created_at: string;
  updated_at: string;
}

/** Global app config, single row (id always 1). Readable by anyone, writable
 *  only by the allowlisted admin account (see migrations/add_admin_config.sql). */
export interface AppSettings {
  id: number;
  ai_scanner_global_enabled: boolean;
  updated_at: string;
}

/** Cross-user aggregate stats for the admin panel, returned by the
 *  `admin-stats` Supabase Edge Function (service-role, bypasses RLS). */
export interface AdminStats {
  totalUsers: number;
  totalWorkoutSessions: number;
  totalWorkoutSets: number;
  totalFoodLogs: number;
  totalSavedFoods: number;
  totalExercises: number;
  usersWithOwnAiKey: number;
  newUsersLast30d: number;
  sessionsLast7d: number;
  foodLogsLast7d: number;
  generatedAt: string;
}

export interface DailyWeightLog {
  id: string;
  user_id: string;
  logged_date: string;
  weight: number;
  notes: string | null;
  created_at: string;
}

export interface WaterLog {
  id: string;
  user_id: string;
  logged_date: string;
  amount_liters: number;
  updated_at: string;
}

export interface ProgressPhoto {
  id: string;
  user_id: string;
  photo_date: string;
  storage_path: string;
  notes: string | null;
  created_at: string;
  publicUrl?: string;
}

export interface Exercise {
  id: string;
  user_id: string;
  name: string;
  muscle_group: string | null;
  machine_photo_path: string | null;
  notes: string | null;
  created_at: string;
  machinePhotoUrl?: string;
}

export interface WorkoutFolder {
  id: string;
  user_id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
}

export interface WorkoutSession {
  id: string;
  user_id: string;
  session_date: string;
  notes: string | null;
  folder_id: string | null;
  created_at: string;
  sets?: WorkoutSet[];
}

export interface WorkoutSet {
  id: string;
  session_id: string;
  exercise_id: string | null;
  exercise_name: string;
  set_number: number;
  set_type: SetType;
  reps: number | null;
  weight: number | null;
  weight_unit?: WeightUnit | null;
  rpe: number | null;
  drops: Drop[] | null;
  /* legacy columns kept for reading old data */
  reps_2: number | null;
  weight_2: number | null;
  reps_3: number | null;
  weight_3: number | null;
  notes: string | null;
  created_at: string;
}

export interface RoutineExercise {
  id: string;
  folder_id: string;
  exercise_id: string | null;
  exercise_name: string;
  order_index: number;
  planned_sets: number;
  planned_reps: number;
  planned_weight_kg: number | null;
  rest_seconds: number;
  set_type: SetType;
  created_at: string;
}

export interface LoggedSet {
  exerciseId: string | null;
  exerciseName: string;
  setNumber: number;
  setType: SetType;
  reps: number;
  weight: number | null;
  weight_unit: WeightUnit;
  drops: Drop[];
}

/** Extended nutrition detail, stored as a single jsonb column on food_logs
 *  (per-serving) and saved_foods (per-100g). All numeric nutrient values are in
 *  GRAMS — the unit Open Food Facts normalizes to — so %DV math is unit-agnostic;
 *  the UI converts to g / mg / µg for display. Every field is optional: a food
 *  simply omits what its source doesn't provide. */
export interface FoodDetail {
  brand?: string;
  category?: string;
  code?: string; // barcode
  servingSize?: string; // raw OFF label, e.g. "1 scoop (30 g)"
  servingGrams?: number; // parsed grams
  /** Net content of the whole package, in grams (OFF `product_quantity`, ml
   *  treated 1:1). Lets the detail sheet offer "whole package" as a portion so a
   *  433 g energy drink can be logged/saved as the single unit it's consumed in.
   *  Basis-independent — `scaleDetail` passes it through unscaled. */
  packageGrams?: number;
  packageLabel?: string; // raw OFF `quantity` label, e.g. "473 ml"
  sugars_g?: number;
  fiber_g?: number;
  satFat_g?: number;
  sodium_g?: number;
  salt_g?: number;
  micros?: Record<string, number>; // OFF nutrient id -> grams (e.g. { "vitamin-c": 0.012 })
  nutriScore?: "a" | "b" | "c" | "d" | "e";
  novaGroup?: 1 | 2 | 3 | 4;
  source?: "off" | "manual" | "ai";
}

export interface FoodLog {
  id: string;
  user_id: string;
  logged_date: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  food_name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  weight_g?: number | null;
  detail?: FoodDetail | null;
  created_at: string;
  updated_at?: string | null;
}

export interface SavedFood {
  id: string;
  user_id: string;
  name: string;
  /** Always canonical per-100g, whatever basis the user saved the food at — all
   *  display and logging math derives from these four values. */
  calories_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fats_100g: number;
  /** The portion this favorite is *about*: the grams the user chose when saving
   *  it (e.g. 473 for a whole energy drink, 100 for a per-100g reference). Drives
   *  the basis shown in lists / the favorites subpage and the portion the detail
   *  sheet reopens at. Legacy rows default to 100. */
  default_weight_g: number;
  detail?: FoodDetail | null;
  created_at: string;
}

/* ── Volume auto-regulation (RP-style) ─────────────────────────────────────── */

/** Post-session pump for a muscle group: 0 none · 1 moderate · 2 insane. */
export type PumpRating = 0 | 1 | 2;
/** Soreness from the PREVIOUS session for a muscle group, judged at the start of
 *  this one: 0 none · 1 recovered just in time · 2 still sore. */
export type SorenessRating = 0 | 1 | 2;

/** One muscle group's feedback for one session. Device-local (IndexedDB store
 *  `volume_feedback`) — deliberately outside the Supabase sync pipeline, see
 *  lib/volumeFeedback.ts for why. */
export interface VolumeFeedback {
  id: string;
  user_id: string;
  /** The session this feedback was captured at the end of. */
  session_id: string | null;
  logged_date: string; // yyyy-MM-dd
  muscle_group: string;
  pump: PumpRating;
  soreness: SorenessRating;
  /** Sets logged for this muscle group in that session — the baseline the next
   *  microcycle's recommendation is applied to. */
  sets_performed: number;
  created_at: string;
}

/* ── Recipes (raw → cooked yield) ──────────────────────────────────────────── */

/** One component of a batch recipe. Macros are per-100g of the ingredient **as
 *  weighed**, which for cooked-yield math means per-100g RAW. */
export interface RecipeIngredient {
  id: string;
  name: string;
  /** Weight put into the batch, in the state the macros describe (raw), grams. */
  rawWeightG: number;
  calories100g: number;
  protein100g: number;
  carbs100g: number;
  fats100g: number;
  /** Cooked grams per raw gram. <1 loses water (chicken ≈ 0.75), >1 absorbs it
   *  (dry rice ≈ 2.8). 1 = unchanged (oil, protein powder). */
  yieldFactor: number;
  /** Set when the ingredient was pulled from a saved favorite. */
  savedFoodId?: string | null;
  detail?: FoodDetail | null;
}

/** A user's batch recipe. Device-local (IndexedDB store `recipes`). */
export interface Recipe {
  id: string;
  user_id: string;
  name: string;
  ingredients: RecipeIngredient[];
  /** Weight of the finished batch actually measured on a scale, grams. When set
   *  it overrides the summed per-ingredient yield estimate — a scale beats a
   *  lookup table, and it is what per-portion macros are divided against. */
  cookedWeightG: number | null;
  /** How many portions the batch is cut into, when portioning by count rather
   *  than by grams. */
  servings: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A food normalized for the detail sheet — macros and `detail` are always on a
 *  per-100g basis, regardless of the source (OFF search result, saved favorite,
 *  or a previously logged entry). Lives here rather than in the component so
 *  lib/savedFoods.ts can build one without importing UI. */
export interface DetailFood {
  key: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  cal100: number;
  protein100: number;
  carbs100: number;
  fats100: number;
  detail?: FoodDetail | null; // per-100g
  /** Fallback portion (grams) the sheet opens at when nothing better is known. */
  defaultWeightG: number;
  /** A deliberate portion this food should reopen at — a favorite's saved basis
   *  or the weight a recent log used. Wins over the package serving size. */
  preferredPortionG?: number | null;
}
