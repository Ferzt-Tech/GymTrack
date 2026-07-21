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
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at?: string | null;
}

export interface SavedFood {
  id: string;
  user_id: string;
  name: string;
  calories_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fats_100g: number;
  default_weight_g: number;
  created_at: string;
}
