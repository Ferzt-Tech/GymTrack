"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, getStorageUrl } from "@/lib/supabase";
import { useProfile } from "@/lib/hooks/useProfile";
import { todayISO } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  enqueue, getCached, setCache, getPendingSaveWorkouts,
  getPendingUpsertsForTable, getPendingDeletesForTable, overlayUpserts,
} from "@/lib/offlineQueue";
import { resolveUserId, withTimeout } from "@/lib/auth-utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import ExerciseForm       from "@/components/training/ExerciseForm";
import ExerciseLibraryPicker from "@/components/training/ExerciseLibraryPicker";
import ExerciseList       from "@/components/training/ExerciseList";
import WorkoutSessionCard, { toSetPayload } from "@/components/training/WorkoutSession";
import RoutineManager     from "@/components/training/RoutineManager";
import ActiveWorkout      from "@/components/training/ActiveWorkout";
import PRToast            from "@/components/training/PRToast";
import type { Exercise, WorkoutSession, WorkoutSet, WorkoutFolder, RoutineExercise, LoggedSet, WeightUnit } from "@/types";
import { useNav } from "@/lib/context/NavContext";
import { useT } from "@/lib/context/LanguageContext";

type Tab = "log" | "routines" | "exercises";

export default function TrainingPage() {
  const { profile }  = useProfile();
  const { setNavHidden } = useNav();
  const { refetchKey, triggerSync } = useOnlineSync();
  const hasFetched = useRef(false);
  const t = useT();
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window !== "undefined") {
      const openRoutines = localStorage.getItem("gymtrack:open_routines_tab");
      if (openRoutines === "true") {
        localStorage.removeItem("gymtrack:open_routines_tab");
        return "routines";
      }
    }
    return "log";
  });
  const [unit, setUnit] = useState<WeightUnit>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("gymtrack:training_weight_unit") as WeightUnit | null;
      if (stored === "kg" || stored === "lbs") return stored;
    }
    return "kg";
  });

  const toggleUnit = () => {
    const next = unit === "kg" ? "lbs" : "kg";
    setUnit(next);
    localStorage.setItem("gymtrack:training_weight_unit", next);
  };

  const TAB_LABELS: Record<Tab, string> = {
    log:       t.training.workoutLog,
    routines:  t.training.routines,
    exercises: t.training.exercises,
  };

  const [exercises,          setExercises]          = useState<Exercise[]>([]);
  const [sessions,           setSessions]           = useState<WorkoutSession[]>([]);
  const [folders,            setFolders]            = useState<WorkoutFolder[]>([]);
  const [routineExercises,   setRoutineExercises]   = useState<Record<string, RoutineExercise[]>>({});
  const [userId,             setUserId]             = useState<string>("");
  const [showForm,           setShowForm]           = useState(false);
  const [showLibrary,        setShowLibrary]        = useState(false);
  const [editingExercise,    setEditingExercise]    = useState<Exercise | null>(null);
  const [loading,            setLoading]            = useState(true);
  const [selectedDate,       setSelectedDate]       = useState(todayISO());
  const [activeWorkout, setActiveWorkout] = useState<{
    folder: WorkoutFolder;
    exercises: RoutineExercise[];
  } | null>(null);
  const [newPRs, setNewPRs] = useState<{ exerciseName: string; weightKg: number }[]>([]);

  useEffect(() => {
    setNavHidden(activeWorkout !== null);
    return () => setNavHidden(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkout]);

  useEffect(() => {
    let isMounted = true;

    type TrainingCache = {
      exercises:        Exercise[];
      sessions:         WorkoutSession[];
      folders:          WorkoutFolder[];
      routineExercises: RoutineExercise[];
    };

    // Merges anything still sitting in the offline queue on top of a base
    // snapshot (cache or fresh fetch) — so a queued-but-unsynced edit to any
    // training table never silently disappears from view.
    async function overlayTrainingData(base: TrainingCache): Promise<TrainingCache> {
      const [exUpserts, exDeletes, folderUpserts, folderDeletes, reUpserts, reDeletes, pendingWorkouts] =
        await Promise.all([
          getPendingUpsertsForTable("exercises"),
          getPendingDeletesForTable("exercises"),
          getPendingUpsertsForTable("workout_folders"),
          getPendingDeletesForTable("workout_folders"),
          getPendingUpsertsForTable("routine_exercises"),
          getPendingDeletesForTable("routine_exercises"),
          getPendingSaveWorkouts(),
        ]);

      const exDeleted     = new Set(exDeletes.map(d => d.value));
      const folderDeleted = new Set(folderDeletes.map(d => d.value));
      const reDeleted     = new Set(reDeletes.map(d => d.value));

      const exercises = overlayUpserts(
        base.exercises.filter(e => !exDeleted.has(e.id)) as unknown as Record<string, unknown>[],
        exUpserts, "id"
      ) as unknown as Exercise[];

      const folders = overlayUpserts(
        base.folders.filter(f => !folderDeleted.has(f.id)) as unknown as Record<string, unknown>[],
        folderUpserts, "id"
      ) as unknown as WorkoutFolder[];

      const routineExercises = overlayUpserts(
        base.routineExercises.filter(r => !reDeleted.has(r.id)) as unknown as Record<string, unknown>[],
        reUpserts, "id"
      ) as unknown as RoutineExercise[];

      let sessions = base.sessions;
      for (const op of pendingWorkouts) {
        const idx = sessions.findIndex(s => s.id === op.sessionId);
        const overlaidSets = op.sets as unknown as WorkoutSet[];
        if (idx >= 0) {
          sessions = [...sessions];
          sessions[idx] = { ...sessions[idx], sets: overlaidSets };
        } else {
          sessions = [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { ...(op.sessionPayload as any as WorkoutSession), sets: overlaidSets },
            ...sessions,
          ];
        }
      }

      return { exercises, sessions, folders, routineExercises };
    }

    function applyToState(data: TrainingCache) {
      if (!isMounted) return;
      setExercises(data.exercises);
      setSessions(data.sessions);
      setFolders(data.folders);
      const map: Record<string, RoutineExercise[]> = {};
      for (const item of data.routineExercises) {
        if (!map[item.folder_id]) map[item.folder_id] = [];
        map[item.folder_id].push(item);
      }
      setRoutineExercises(map);
    }

    async function load() {
      const uid = await resolveUserId();
      if (!uid || !isMounted) { setLoading(false); return; }
      if (isMounted) setUserId(uid);

      const cacheKey = `training:${uid}`;

      // Always render from cache first (instant), overlaid with anything
      // still queued for sync — this is what makes a queued-but-unsynced
      // edit to exercises/folders/routines/sessions visible immediately,
      // regardless of connectivity.
      const cached = await getCached<TrainingCache>(cacheKey);
      const cacheBase: TrainingCache = cached ?? { exercises: [], sessions: [], folders: [], routineExercises: [] };
      const overlaidCache = await overlayTrainingData(cacheBase);
      applyToState(overlaidCache);
      setLoading(false);

      if (uid === "guest-user") {
        hasFetched.current = true;
        return;
      }

      // Online: fetch fresh data, then re-overlay the same pending ops on
      // top of it so an in-flight offline edit survives the refetch.
      try {
        const [{ data: exData, error: exErr }, { data: sessData, error: sessErr }, { data: folderData, error: folderErr }] =
          await withTimeout(Promise.all([
            supabase.from("exercises").select("*").eq("user_id", uid).order("name"),
            supabase.from("workout_sessions")
              .select("*, sets:workout_sets(*)")
              .eq("user_id", uid)
              .order("session_date", { ascending: false })
              .limit(100),
            supabase.from("workout_folders").select("*").eq("user_id", uid).order("created_at"),
          ]));

        if (exErr || sessErr || folderErr) throw exErr ?? sessErr ?? folderErr;
        if (!isMounted) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exList = (exData ?? []).map((e: any) => ({
          ...e,
          machinePhotoUrl: e.machine_photo_path
            ? getStorageUrl("exercise-photos", e.machine_photo_path)
            : undefined,
        }));
        const folderList = folderData ?? [];

        let routineExList: RoutineExercise[] = [];
        if (folderList.length > 0) {
          const { data: reData, error: reErr } = await withTimeout(
            supabase
              .from("routine_exercises")
              .select("*")
              .in("folder_id", folderList.map((f: any) => f.id))
              .order("order_index")
          );
          if (reErr) throw reErr;
          routineExList = (reData ?? []) as RoutineExercise[];
        }

        const freshBase: TrainingCache = {
          exercises:        exList,
          sessions:         (sessData ?? []) as WorkoutSession[],
          folders:          folderList,
          routineExercises: routineExList,
        };
        const overlaidFresh = await overlayTrainingData(freshBase);

        await setCache(cacheKey, overlaidFresh);
        hasFetched.current = true;
        applyToState(overlaidFresh);
      } catch {
        hasFetched.current = true;
        // Keep the already-rendered (overlaid) cache data.
      }
    }
    load();
    return () => { isMounted = false; };
  }, [refetchKey]);

  async function deleteExercise(id: string) {
    await enqueue({ type: "delete", table: "exercises", column: "id", value: id });
    triggerSync();
    const updatedExercises = exercises.filter(e => e.id !== id);
    setExercises(updatedExercises);
    if (userId) await setCache(`training:${userId}`, {
      exercises: updatedExercises, sessions, folders,
      routineExercises: Object.values(routineExercises).flat(),
    });
  }

  async function startSession(date: string) {
    if (sessions.some(s => s.session_date === date)) return;
    if (!userId) return;

    const fakeId = crypto.randomUUID();
    const fakeSession: WorkoutSession = {
      id: fakeId, user_id: userId, session_date: date,
      notes: null, folder_id: null, created_at: new Date().toISOString(), sets: [],
    };
    const updatedSessions = [fakeSession, ...sessions];
    setSessions(updatedSessions);
    await enqueue({
      type: "save_workout",
      sessionId: fakeId,
      sessionPayload: { id: fakeId, user_id: userId, session_date: date },
      sets: [],
    });
    triggerSync();
    await setCache(`training:${userId}`, {
      exercises, sessions: updatedSessions, folders,
      routineExercises: Object.values(routineExercises).flat(),
    });
  }

  function detectPRs(loggedSets: LoggedSet[]): { exerciseName: string; weightKg: number }[] {
    const historicalMaxes: Record<string, number> = {};
    for (const session of sessions) {
      for (const set of session.sets ?? []) {
        if (set.weight != null) {
          const setUnit = set.weight_unit ?? "kg";
          const weightKg = setUnit === "lbs" ? set.weight / 2.20462 : set.weight;
          const curr = historicalMaxes[set.exercise_name] ?? 0;
          if (weightKg > curr) historicalMaxes[set.exercise_name] = weightKg;
        }
      }
    }
    const newMaxes: Record<string, number> = {};
    for (const s of loggedSets) {
      if (s.weight != null && s.weight > 0 && s.setType !== "warmup") {
        const weightKg = s.weight_unit === "lbs" ? s.weight / 2.20462 : s.weight;
        const curr = newMaxes[s.exerciseName] ?? 0;
        if (weightKg > curr) newMaxes[s.exerciseName] = weightKg;
      }
    }
    return Object.entries(newMaxes)
      .filter(([name, weight]) => weight > (historicalMaxes[name] ?? 0))
      .map(([exerciseName, weightKg]) => ({ exerciseName, weightKg }));
  }

  async function saveWorkout(loggedSets: LoggedSet[]) {
    const uid = await resolveUserId();
    if (!uid) throw new Error("Could not identify user — please check your connection and try again.");

    const today    = todayISO();
    const existing = sessions.find(s => s.session_date === today);
    const prs = detectPRs(loggedSets);

    const setsPayload = loggedSets.map(s => ({
      exercise_id:   s.exerciseId,
      exercise_name: s.exerciseName,
      set_number:    s.setNumber,
      set_type:      s.setType,
      reps:          s.reps,
      weight:        s.weight,
      weight_unit:   s.weight_unit,
      drops:         s.drops.length > 0 ? s.drops : null,
    }));

    // Local-first: write to IndexedDB immediately and sync in the background.
    // A "save_workout" op replaces ALL sets for the session on flush, so the
    // existing (already-saved) sets must be included alongside the new ones —
    // otherwise finishing a second guided workout on the same day would wipe
    // out the sets from the first one.
    const sessionId = existing?.id ?? crypto.randomUUID();
    const existingPayload = (existing?.sets ?? []).map(s => toSetPayload(s, sessionId));

    await enqueue({
      type:           "save_workout",
      sessionId,
      sessionPayload: { id: sessionId, user_id: uid, session_date: today },
      sets:           [...existingPayload, ...setsPayload.map(s => ({ ...s, session_id: sessionId }))],
    });
    triggerSync();

    const baseSession: WorkoutSession = existing ?? {
      id: sessionId, user_id: uid, session_date: today,
      notes: null, folder_id: null, created_at: new Date().toISOString(), sets: [],
    };
    const fakeSets: WorkoutSet[] = setsPayload.map(s => ({
      ...s,
      session_id: sessionId,
      id: crypto.randomUUID(),
      rpe: null, reps_2: null, weight_2: null, reps_3: null, weight_3: null,
      drops: s.drops ?? null, notes: null, created_at: new Date().toISOString(),
    }));
    const updatedSession = { ...baseSession, sets: [...(baseSession.sets ?? []), ...fakeSets] };
    const updatedSessions = existing
      ? sessions.map(s => s.id === sessionId ? updatedSession : s)
      : [updatedSession, ...sessions];
    setSessions(updatedSessions);
    await setCache(`training:${uid}`, {
      exercises, sessions: updatedSessions, folders,
      routineExercises: Object.values(routineExercises).flat(),
    });

    setActiveWorkout(null);
    setTab("log");
    setSelectedDate(today);
    if (prs.length > 0) setNewPRs(prs);
  }

  async function handleExerciseSaved(ex: Exercise) {
    const isEdit = exercises.some(e => e.id === ex.id);
    const updatedExercises = (isEdit ? exercises.map(e => e.id === ex.id ? ex : e) : [...exercises, ex])
      .sort((a, b) => a.name.localeCompare(b.name));
    setExercises(updatedExercises);
    setShowForm(false);
    setEditingExercise(null);

    // A rename must follow into planned routines that reference this exercise
    // (they store a copy of the name). Past sessions keep the name they were
    // logged under.
    let updatedMap = routineExercises;
    if (isEdit) {
      const affected = Object.values(routineExercises).flat()
        .filter(re => re.exercise_id === ex.id && re.exercise_name !== ex.name);
      if (affected.length > 0) {
        updatedMap = Object.fromEntries(
          Object.entries(routineExercises).map(([fid, items]) => [
            fid,
            items.map(re => re.exercise_id === ex.id ? { ...re, exercise_name: ex.name } : re),
          ])
        );
        setRoutineExercises(updatedMap);
        for (const re of affected) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { user_id: _stripped, ...clean } = re as RoutineExercise & { user_id?: string };
          await enqueue({
            type: "upsert",
            table: "routine_exercises",
            payload: { ...clean, exercise_name: ex.name },
            conflictOn: "id",
          });
        }
        triggerSync();
      }
    }

    if (userId) await setCache(`training:${userId}`, {
      exercises: updatedExercises, sessions, folders,
      routineExercises: Object.values(updatedMap).flat(),
    });
  }

  // Propagates RoutineManager's internal map back to parent state + cache
  function handleRoutineMapChanged(map: Record<string, RoutineExercise[]>) {
    setRoutineExercises(map);
    if (userId) setCache(`training:${userId}`, {
      exercises, sessions, folders,
      routineExercises: Object.values(map).flat(),
    });
  }

  const today          = todayISO();
  const sessionForDate = sessions.find(s => s.session_date === selectedDate);
  const prevSessions   = sessions.filter(s => s.session_date !== selectedDate);

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        <div className="skeleton h-8 w-32 mb-4" />
        <div className="skeleton h-11 w-full" />
        <div className="skeleton h-10 w-full" />
        <div className="skeleton h-40 w-full" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }

  return (
    <>
      {newPRs.length > 0 && (
        <PRToast prs={newPRs} unit={unit} onDismiss={() => setNewPRs([])} />
      )}

      {/* ── Active Workout overlay ── */}
      {activeWorkout && (
        <ActiveWorkout
          folder={activeWorkout.folder}
          routineExercises={activeWorkout.exercises}
          exercises={exercises}
          unit={unit}
          onFinish={saveWorkout}
          onCancel={() => setActiveWorkout(null)}
        />
      )}

      <div className="space-y-3 py-2">
        <div className="flex items-center justify-between mb-4 animate-spring-up">
          <h1 className="metric text-2xl font-semibold tracking-tight text-[var(--text)] mb-0">
            {t.training.training}
          </h1>
          <button
            onClick={toggleUnit}
            className="sector-readout text-[11px] font-mono tracking-widest uppercase hover:opacity-80 transition-opacity"
            title="Toggle Weight Unit"
          >
            ◈ {unit.toUpperCase()}
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border border-[var(--border)] rounded-xl overflow-hidden mb-4">
          {(["log", "routines", "exercises"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-2.5 text-[13px] font-medium transition-colors",
                tab === t
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "text-[var(--sub)] hover:text-[var(--muted)]"
              )}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* ── Workout log ── */}
        {tab === "log" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value || today)}
                className="input-base"
              />
              {selectedDate !== today && (
                <button
                  onClick={() => setSelectedDate(today)}
                  className="btn-ghost px-3 text-xs shrink-0"
                >
                  {t.training.today}
                </button>
              )}
            </div>

            {!sessionForDate ? (
              <div className="card-glass p-4 text-center py-8">
                <p className="text-sm text-[var(--faint)] mb-4">
                  {profile?.username
                    ? t.training.readyToTrain(profile.username)
                    : t.training.noSessionForDate}
                </p>
                <button onClick={() => startSession(selectedDate)} className="btn-aqua mx-auto">
                  {t.training.startSession}
                </button>
              </div>
            ) : (
              <WorkoutSessionCard
                session={sessionForDate}
                exercises={exercises}
                unit={unit}
                userId={userId}
                onUpdated={updated => setSessions(prev => prev.map(s => s.id === updated.id ? updated : s))}
                onDeleted={id => setSessions(prev => prev.filter(s => s.id !== id))}
              />
            )}

            {prevSessions.length > 0 && (
              <>
                <p className="section-label pt-2">{t.training.previousSessions}</p>
                {prevSessions.map((s, i) => (
                  <div key={s.id} className="animate-spring-up" style={{ animationDelay: `${i * 55}ms` }}>
                    <WorkoutSessionCard
                      session={s}
                      exercises={exercises}
                      unit={unit}
                      userId={userId}
                      onUpdated={updated => setSessions(prev => prev.map(x => x.id === updated.id ? updated : x))}
                      onDeleted={id => setSessions(prev => prev.filter(x => x.id !== id))}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Routines ── */}
        {tab === "routines" && (
          <RoutineManager
            folders={folders}
            exercises={exercises}
            unit={unit}
            userId={userId}
            initialRoutineMap={routineExercises}
            onFolderCreated={f => {
              const updatedFolders = [...folders, f];
              setFolders(updatedFolders);
              if (userId) setCache(`training:${userId}`, {
                exercises, sessions, folders: updatedFolders,
                routineExercises: Object.values(routineExercises).flat(),
              });
            }}
            onFolderDeleted={id => {
              const updatedFolders = folders.filter(f => f.id !== id);
              setFolders(updatedFolders);
              if (userId) setCache(`training:${userId}`, {
                exercises, sessions, folders: updatedFolders,
                routineExercises: Object.values(routineExercises).flat(),
              });
            }}
            onStartWorkout={(folder, items) => setActiveWorkout({ folder, exercises: items })}
            onRoutineMapChanged={handleRoutineMapChanged}
          />
        )}

        {/* ── Exercises ── */}
        {tab === "exercises" && (
          <div className="space-y-3">
            {showForm || editingExercise ? (
              <ExerciseForm
                key={editingExercise?.id ?? "new"}
                initial={editingExercise}
                onSaved={handleExerciseSaved}
                onCancel={() => { setShowForm(false); setEditingExercise(null); }}
              />
            ) : showLibrary ? (
              <ExerciseLibraryPicker
                existingExercises={exercises}
                onSaved={handleExerciseSaved}
                onCancel={() => setShowLibrary(false)}
              />
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setShowForm(true)} className="btn-outline flex-1 border-dashed">
                  {t.training.addExercise}
                </button>
                <button onClick={() => setShowLibrary(true)} className="btn-outline flex-1 border-dashed">
                  {t.exerciseLibrary.title}
                </button>
              </div>
            )}
            <ExerciseList
              exercises={exercises}
              onDelete={deleteExercise}
              onEdit={ex => { setShowForm(false); setEditingExercise(ex); }}
            />
          </div>
        )}
      </div>
    </>
  );
}
