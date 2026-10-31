/* In-progress guided workout, persisted so it survives a reload or the OS
   killing a backgrounded WebView mid-rest (common on Android). Device-local by
   design: it lives in the IndexedDB `cache` store, is never synced, and is
   cleared once the workout is saved or abandoned. The routine itself is
   snapshotted too, so a resume replays exactly the plan that was started even
   if the routine was edited in between. */
import { getCached, setCache, clearCache } from "./offlineQueue";
import type { WorkoutFolder, RoutineExercise, LoggedSet, WeightUnit } from "@/types";
import type { MuscleFeedbackDraft } from "@/components/training/VolumeFeedbackPanel";

const DRAFT_KEY = "activeWorkout:draft";

export interface ActiveWorkoutProgress {
  mode:            "standard" | "circuit";
  exIdx:           number;
  setIdx:          number;
  phase:           "workout" | "resting" | "done";
  restEndsAt:      number | null;
  restDuration:    number;
  setsLoggedCount: number[];
  activeCircuitEx: number;
  loggedSets:      LoggedSet[];
  unitOverrides:   Record<string, WeightUnit>;
  feedback:        Record<string, MuscleFeedbackDraft>;
}

export interface ActiveWorkoutDraft {
  folder:           WorkoutFolder;
  routineExercises: RoutineExercise[];
  progress:         ActiveWorkoutProgress;
  savedAt:          string;
}

export async function loadActiveWorkoutDraft(): Promise<ActiveWorkoutDraft | null> {
  try {
    const draft = await getCached<ActiveWorkoutDraft>(DRAFT_KEY);
    return draft && draft.folder && Array.isArray(draft.routineExercises) && draft.progress ? draft : null;
  } catch {
    return null;
  }
}

export async function saveActiveWorkoutDraft(draft: Omit<ActiveWorkoutDraft, "savedAt">): Promise<void> {
  try {
    await setCache(DRAFT_KEY, { ...draft, savedAt: new Date().toISOString() });
  } catch { /* best effort — the workout itself is still in memory */ }
}

export async function clearActiveWorkoutDraft(): Promise<void> {
  try {
    await clearCache(DRAFT_KEY);
  } catch { /* nothing to clear */ }
}
