"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, getStorageUrl, waitForAuthReady } from "@/lib/supabase";
import { useProfile } from "@/lib/hooks/useProfile";
import { todayISO, generateUUID } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  enqueue, getCached, setCache, getPendingSaveWorkouts,
  getPendingUpsertsForTable, getPendingDeletesForTable, overlayUpserts,
} from "@/lib/offlineQueue";
import { resolveUserId, withTimeout } from "@/lib/auth-utils";
import { saveVolumeFeedback, type VolumeFeedbackInput } from "@/lib/volumeFeedback";
import { detectWeightPRs, personalRecordPayload, type DetectedPR } from "@/lib/personalRecords";
import { useOnlineSync, useLocalFirstWrite } from "@/lib/hooks/useOnlineSync";
import ExerciseForm       from "@/components/training/ExerciseForm";
import ExerciseLibraryPicker from "@/components/training/ExerciseLibraryPicker";
import ExerciseList       from "@/components/training/ExerciseList";
import WorkoutSessionCard, { toSetPayload } from "@/components/training/WorkoutSession";
import RoutineManager     from "@/components/training/RoutineManager";
import { RECENT_EXERCISE_LIMIT } from "@/components/training/ExercisePickerSheet";
import ActiveWorkout      from "@/components/training/ActiveWorkout";
import {
  loadActiveWorkoutDraft, clearActiveWorkoutDraft,
  type ActiveWorkoutDraft, type ActiveWorkoutProgress,
} from "@/lib/activeWorkoutDraft";
import PRToast            from "@/components/training/PRToast";
import type { Exercise, WorkoutSession, WorkoutSet, WorkoutFolder, RoutineExercise, LoggedSet, WeightUnit } from "@/types";
import { useNav } from "@/lib/context/NavContext";
import { useT } from "@/lib/context/LanguageContext";

type Tab = "log" | "routines" | "exercises";

export default function TrainingPage() {
  const { profile }  = useProfile();
  const { setNavHidden } = useNav();
  const { refetchKey, triggerSync } = useOnlineSync();
  const localFirstWrite = useLocalFirstWrite();
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
    resume?: ActiveWorkoutProgress;
  } | null>(null);
  /* A guided workout left unfinished by a reload or the OS killing the app. */
  const [workoutDraft,   setWorkoutDraft]   = useState<ActiveWorkoutDraft | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    loadActiveWorkoutDraft().then(d => { if (d) setWorkoutDraft(d); });
  }, []);

  function resumeWorkoutDraft() {
    if (!workoutDraft) return;
    setActiveWorkout({ folder: workoutDraft.folder, exercises: workoutDraft.routineExercises, resume: workoutDraft.progress });
    setWorkoutDraft(null);
  }

  function discardWorkoutDraft() {
    if (!confirmDiscard) { setConfirmDiscard(true); return; }
    void clearActiveWorkoutDraft();
    setWorkoutDraft(null);
    setConfirmDiscard(false);
  }

  function cancelActiveWorkout() {
    void clearActiveWorkoutDraft();
    setActiveWorkout(null);
  }
  const [newPRs, setNewPRs] = useState<DetectedPR[]>([]);

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
      const [exUpserts, exDeletes, folderUpserts, folderDeletes, reUpserts, reDeletes, pendingWorkouts, sessionDeletes] =
        await Promise.all([
          getPendingUpsertsForTable("exercises"),
          getPendingDeletesForTable("exercises"),
          getPendingUpsertsForTable("workout_folders"),
          getPendingDeletesForTable("workout_folders"),
          getPendingUpsertsForTable("routine_exercises"),
          getPendingDeletesForTable("routine_exercises"),
          getPendingSaveWorkouts(),
          getPendingDeletesForTable("workout_sessions"),
        ]);

      const exDeleted     = new Set(exDeletes.map(d => d.value));
      const folderDeleted = new Set(folderDeletes.map(d => d.value));
      const reDeleted     = new Set(reDeletes.map(d => d.value));
      const sessionDeleted = new Set(sessionDeletes.map(d => d.value));

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

      // A session deleted while its delete is still queued must stay gone —
      // both from the fetched base and from its own pending save_workout ops,
      // which would otherwise re-add it.
      let sessions = base.sessions.filter(s => !sessionDeleted.has(s.id));
      for (const op of pendingWorkouts) {
        if (sessionDeleted.has(op.sessionId)) continue;
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

      // No remote session (yet) means supabase.from() would answer from the
      // local mock; never let that partial view overwrite the cache.
      if (!(await waitForAuthReady())) {
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
        const sessList = (sessData ?? []) as WorkoutSession[];

        // An empty-but-error-free response across every table may mean an expired
        // JWT filtered all rows via RLS rather than the account genuinely having
        // no data — fall back to the already-rendered cache instead of wiping it.
        const hadCachedData = !!(cached && (
          cached.exercises.length || cached.sessions.length || cached.folders.length || cached.routineExercises.length
        ));
        if (!exList.length && !sessList.length && !folderList.length && hadCachedData) {
          hasFetched.current = true;
          return;
        }

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
          sessions:         sessList,
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
    await localFirstWrite({ type: "delete", table: "exercises", column: "id", value: id });
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

    const fakeId = generateUUID();
    const fakeSession: WorkoutSession = {
      id: fakeId, user_id: userId, session_date: date,
      notes: null, folder_id: null, created_at: new Date().toISOString(), sets: [],
    };
    const updatedSessions = [fakeSession, ...sessions];
    setSessions(updatedSessions);
    await localFirstWrite({
      type: "save_workout",
      sessionId: fakeId,
      sessionPayload: { id: fakeId, user_id: userId, session_date: date },
      sets: [],
    });
    await setCache(`training:${userId}`, {
      exercises, sessions: updatedSessions, folders,
      routineExercises: Object.values(routineExercises).flat(),
    });
  }

  function detectPRs(loggedSets: LoggedSet[]): DetectedPR[] {
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
    return detectWeightPRs(loggedSets, historicalMaxes);
  }

  async function saveWorkout(loggedSets: LoggedSet[], feedback: VolumeFeedbackInput[] = []) {
    const uid = await resolveUserId();
    if (!uid) throw new Error("Could not identify user — please check your connection and try again.");

    const today    = todayISO();
    const existing = sessions.find(s => s.session_date === today);
    const prs = detectPRs(loggedSets);

    const setsPayload = loggedSets.map(s => ({
      id:            generateUUID(),
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
    const sessionId = existing?.id ?? generateUUID();
    const existingPayload = (existing?.sets ?? []).map(s => toSetPayload(s, sessionId));

    await localFirstWrite({
      type:           "save_workout",
      sessionId,
      sessionPayload: { id: sessionId, user_id: uid, session_date: today },
      sets:           [...existingPayload, ...setsPayload.map(s => ({ ...s, session_id: sessionId }))],
    });

    const baseSession: WorkoutSession = existing ?? {
      id: sessionId, user_id: uid, session_date: today,
      notes: null, folder_id: null, created_at: new Date().toISOString(), sets: [],
    };
    const fakeSets: WorkoutSet[] = setsPayload.map(s => ({
      ...s,
      session_id: sessionId,
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

    // Volume feedback is device-local (see lib/volumeFeedback.ts) and must never
    // be able to fail the workout save — the sets are the record, the ratings
    // are commentary on them.
    if (feedback.length > 0) {
      try {
        await saveVolumeFeedback({
          userId:     uid,
          sessionId,
          loggedDate: today,
          entries:    feedback,
        });
      } catch (err) {
        console.error("Failed to store volume feedback:", err);
      }
    }

    // Personal-record rows are commentary on top of the sets too — must never
    // be able to fail the workout save. Append-only: each detected PR gets a
    // fresh row (see lib/personalRecords.ts) rather than overwriting a prior
    // one, so stats/page.tsx keeps a durable history instead of a recompute.
    if (prs.length > 0) {
      try {
        for (const pr of prs) {
          await enqueue({
            type:    "upsert",
            table:   "personal_records",
            payload: personalRecordPayload(uid, pr, sessionId, today),
          });
        }
        triggerSync();
      } catch (err) {
        console.error("Failed to store personal records:", err);
      }
    }

    await clearActiveWorkoutDraft();
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
        // A failed cascade write must not skip the cache write below (the
        // rename itself is already saved by ExerciseForm) or reject unhandled.
        try {
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
        } catch (err) {
          console.error("Failed to rename exercise in routines:", err);
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

  // Session edits/deletes from WorkoutSessionCard must reach the cache too: for
  // guests the cache is the only thing load() reads back (no queue to overlay),
  // so a state-only update vanished on the next visit to /training.
  function commitSessions(next: WorkoutSession[]) {
    setSessions(next);
    if (userId) setCache(`training:${userId}`, {
      exercises, sessions: next, folders,
      routineExercises: Object.values(routineExercises).flat(),
    });
  }

  /* Exercises the user logged most recently, pinned to the top of the exercise
     picker — re-picking something from the last few sessions is the common case,
     and this makes it zero-scroll. Derived from state already in memory (sets are
     inlined on each session, pending ops included), so it costs no query and
     behaves identically offline and for guests. */
  const recentExerciseIds = useMemo(() => {
    const known = new Set(exercises.map(e => e.id));
    const ordered = [...sessions].sort((a, b) => b.session_date.localeCompare(a.session_date));
    const seen: string[] = [];

    for (const session of ordered) {
      for (const set of session.sets ?? []) {
        const id = set.exercise_id;
        // Skip exercises since deleted — a dead id can't be picked.
        if (!id || !known.has(id) || seen.includes(id)) continue;
        seen.push(id);
        if (seen.length >= RECENT_EXERCISE_LIMIT) return seen;
      }
    }
    return seen;
  }, [sessions, exercises]);

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
          onCancel={cancelActiveWorkout}
          resume={activeWorkout.resume}
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
            title={t.training.toggleUnitTitle}
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
        {workoutDraft && !activeWorkout && (
          <div className="card-glass p-4 flex items-center gap-3 animate-spring-up">
            <div className="flex-1 min-w-0">
              <p className="section-label mb-1">{t.training.unfinishedWorkout}</p>
              <p className="text-sm font-semibold text-[var(--text)] truncate">{workoutDraft.folder.name}</p>
              <p className="metric text-[11px] text-[var(--faint)]">
                {t.training.unfinishedSets(workoutDraft.progress.loggedSets.length)}
              </p>
            </div>
            <button onClick={discardWorkoutDraft} className="btn-ghost text-xs px-3 py-2">
              {confirmDiscard ? t.training.discardConfirm : t.training.discardWorkout}
            </button>
            <button onClick={resumeWorkoutDraft} className="btn-aqua text-xs px-4 py-2">
              {t.training.resumeWorkout}
            </button>
          </div>
        )}

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
                recentExerciseIds={recentExerciseIds}
                unit={unit}
                userId={userId}
                onUpdated={updated => commitSessions(sessions.map(s => s.id === updated.id ? updated : s))}
                onDeleted={id => commitSessions(sessions.filter(s => s.id !== id))}
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
                      recentExerciseIds={recentExerciseIds}
                      unit={unit}
                      userId={userId}
                      onUpdated={updated => commitSessions(sessions.map(x => x.id === updated.id ? updated : x))}
                      onDeleted={id => commitSessions(sessions.filter(x => x.id !== id))}
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
            recentExerciseIds={recentExerciseIds}
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
