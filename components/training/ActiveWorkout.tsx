"use client";

import { useMemo, useState, useEffect } from "react";
import Image from "next/image";
import { Haptics } from "@capacitor/haptics";
import { isNative } from "@/lib/platform";
import { webVibrate } from "@/lib/haptics";
import { playRestComplete } from "@/lib/sounds";
import PlateCalculator from "@/components/training/PlateCalculator";
import VolumeFeedbackPanel, {
  type FeedbackTarget,
  type MuscleFeedbackDraft,
} from "@/components/training/VolumeFeedbackPanel";
import type { VolumeFeedbackInput } from "@/lib/volumeFeedback";
import { saveActiveWorkoutDraft, type ActiveWorkoutProgress } from "@/lib/activeWorkoutDraft";
import type { Exercise, WorkoutFolder, RoutineExercise, WeightUnit, LoggedSet, Drop, PumpRating, SorenessRating } from "@/types";
import { useT } from "@/lib/context/LanguageContext";

/* ── Weight helpers ── */

function fromKg(kg: number | null, unit: WeightUnit): string {
  if (kg == null) return "";
  return unit === "lbs" ? (+(kg * 2.20462).toFixed(1)).toString() : String(kg);
}

function toKg(val: string, unit: WeightUnit): number | null {
  if (!val.trim()) return null;
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  return Math.round((unit === "lbs" ? n / 2.20462 : n) * 100) / 100;
}

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const REST_PRESETS = [30, 60, 90, 120] as const;
const REST_LABELS  = ["30s", "1 min", "1:30", "2 min"] as const;

type WorkoutMode = "standard" | "circuit";

/** The weight field's label, doubling as a tap-to-switch kg/lbs control.
 *  Switching converts what's already typed — see toggleUnitFor. */
function UnitToggleLabel({ label, nextUnit, onToggle }: {
  label: string;
  nextUnit: WeightUnit;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t.activeWorkout.unitToggleAriaLabel(label, nextUnit)}
      className="text-[10px] text-[var(--faint)] uppercase tracking-wider hover:text-[var(--accent)] transition-colors decoration-dotted underline underline-offset-2 text-left"
    >
      {label}
    </button>
  );
}

/* An empty field means "did the plan"; anything typed is taken at face value.
   `parseInt(v) || planned` also swallowed an explicit 0 (a failed set). */
function parseReps(v: string, planned: number): number {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? planned : Math.max(0, n);
}

const REST_NOTIFICATION_ID = 7001;

async function scheduleRestNotification(at: number, title: string, body: string) {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
    const { display } = await LocalNotifications.requestPermissions();
    if (display !== "granted") return;
    await LocalNotifications.schedule({
      notifications: [{
        id: REST_NOTIFICATION_ID, title, body,
        schedule: { at: new Date(at), allowWhileIdle: true },
      }],
    });
  } catch { /* notifications are a nicety; the timer itself still works */ }
}

async function cancelRestNotification() {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
  } catch { /* nothing scheduled, or plugin unavailable */ }
}

interface Props {
  folder:           WorkoutFolder;
  routineExercises: RoutineExercise[];
  exercises?:       Exercise[];
  unit:             WeightUnit;
  /** `feedback` carries the per-muscle pump/soreness ratings the user filled in
   *  on the completion screen — empty when they skipped every question. */
  onFinish:         (sets: LoggedSet[], feedback: VolumeFeedbackInput[]) => void | Promise<void>;
  onCancel:         () => void;
  /** Saved progress to pick up from (see lib/activeWorkoutDraft.ts). */
  resume?:          ActiveWorkoutProgress;
}

export default function ActiveWorkout({ folder, routineExercises, exercises = [], unit, onFinish, onCancel, resume }: Props) {
  const t = useT();
  /* ── Mode ── */
  const [mode, setMode] = useState<WorkoutMode | null>(resume?.mode ?? null);

  /* ── Standard mode state ── */
  const [exIdx,        setExIdx]        = useState(() => Math.min(resume?.exIdx ?? 0, Math.max(0, routineExercises.length - 1)));
  const [setIdx,       setSetIdx]       = useState(resume?.setIdx ?? 0);
  const [phase,        setPhase]        = useState<"workout" | "resting" | "done">(resume?.phase ?? "workout");
  /* Rest is a wall-clock deadline, not a 1 s decrement chain: a backgrounded
     WebView freezes timers, so a countdown paused while the screen was locked
     and resumed from the stale value. Deriving the remaining time from
     Date.now() makes it correct the moment the app is visible again. */
  const [restEndsAt,   setRestEndsAt]   = useState<number | null>(resume?.restEndsAt ?? null);
  const [restDuration, setRestDuration] = useState(resume?.restDuration ?? 60);
  const [now,          setNow]          = useState(() => Date.now());
  const restSecsLeft = restEndsAt == null ? 0 : Math.max(0, Math.ceil((restEndsAt - now) / 1000));

  /* ── Circuit mode state ── */
  const [setsLoggedCount, setSetsLoggedCount] = useState<number[]>(resume?.setsLoggedCount ?? []);
  const [activeCircuitEx, setActiveCircuitEx] = useState(resume?.activeCircuitEx ?? 0);

  /* ── Shared state ── */
  const [loggedSets,    setLoggedSets]    = useState<LoggedSet[]>(resume?.loggedSets ?? []);
  const [weightStr,     setWeightStr]     = useState("");
  const [repsStr,       setRepsStr]       = useState("");
  const [drops,         setDrops]         = useState<{weightStr: string; repsStr: string}[]>([{ weightStr: "", repsStr: "" }]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [photoView,     setPhotoView]     = useState<{ url: string; name: string } | null>(null);
  const [showPlates,    setShowPlates]    = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState<string | null>(null);
  const [feedback,      setFeedback]      = useState<Record<string, MuscleFeedbackDraft>>(resume?.feedback ?? {});
  /* Mid-session unit switches, keyed by routine-exercise id. Session-scoped on
     purpose: swapping to the lbs rack for today shouldn't silently rewrite the
     saved routine. The routine's own weight_unit is the fallback. */
  const [unitOverrides, setUnitOverrides] = useState<Record<string, WeightUnit>>(resume?.unitOverrides ?? {});

  /* Persist progress on every change: everything above lives only in React
     state, and Android routinely kills a backgrounded WebView during a long
     rest — taking every logged set with it. The training page offers to resume
     from this draft and clears it on save/abandon. */
  useEffect(() => {
    if (!mode) return;
    void saveActiveWorkoutDraft({
      folder, routineExercises,
      progress: {
        mode, exIdx, setIdx, phase, restEndsAt, restDuration,
        setsLoggedCount, activeCircuitEx, loggedSets, unitOverrides, feedback,
      },
    });
  }, [folder, routineExercises, mode, exIdx, setIdx, phase, restEndsAt, restDuration,
      setsLoggedCount, activeCircuitEx, loggedSets, unitOverrides, feedback]);

  /* ── Volume feedback targets ──
     Which muscle groups this session actually trained, and how many sets each
     took. Resolved through the exercise library (exercise_id → muscle_group,
     falling back to a name match for routine entries saved before the exercise
     was linked). Warmups don't count toward volume, so they don't count here.
     Sessions whose exercises carry no muscle group produce no targets and the
     panel renders nothing — no point asking about a group we can't attribute. */
  const feedbackTargets = useMemo<FeedbackTarget[]>(() => {
    const counts = new Map<string, number>();
    for (const set of loggedSets) {
      if (set.setType === "warmup") continue;
      const ex = exercises.find(e => e.id === set.exerciseId)
              ?? exercises.find(e => e.name === set.exerciseName);
      const muscle = ex?.muscle_group;
      if (!muscle) continue;
      counts.set(muscle, (counts.get(muscle) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([muscle, sets]) => ({ muscle, sets }))
      .sort((a, b) => b.sets - a.sets);
  }, [loggedSets, exercises]);

  function updateFeedback(muscle: string, patch: Partial<MuscleFeedbackDraft>) {
    setFeedback(prev => {
      const current: MuscleFeedbackDraft = prev[muscle] ?? { pump: null, soreness: null };
      return { ...prev, [muscle]: { ...current, ...patch } };
    });
  }

  /** Only fully-answered groups are stored: a half-filled row can't index the
   *  progression matrix, and guessing the missing axis would fabricate data. */
  function collectFeedback(): VolumeFeedbackInput[] {
    return feedbackTargets.flatMap(({ muscle, sets }) => {
      const draft = feedback[muscle];
      if (!draft || draft.pump == null || draft.soreness == null) return [];
      return [{
        muscleGroup:   muscle,
        pump:          draft.pump as PumpRating,
        soreness:      draft.soreness as SorenessRating,
        setsPerformed: sets,
      }];
    });
  }

  async function handleFinish() {
    setSaveError(null);
    setSaving(true);
    try {
      await onFinish(loggedSets, collectFeedback());
    } catch {
      setSaveError(t.activeWorkout.saveFailed);
      setSaving(false);
    }
  }

  /** The unit an exercise is logged in: a mid-session override, else the unit
   *  saved on the routine, else the profile default. */
  function unitFor(re: RoutineExercise | undefined): WeightUnit {
    if (!re) return unit;
    return unitOverrides[re.id] ?? re.weight_unit ?? unit;
  }

  /* Converts what's already typed instead of just relabelling it — the inputs
     hold display-unit values, so a bare relabel would log 100 lbs as 100 kg.
     Dropset rows are the same set and convert with it. */
  function toggleUnitFor(re: RoutineExercise | undefined) {
    if (!re) return;
    const from = unitFor(re);
    const to: WeightUnit = from === "kg" ? "lbs" : "kg";
    const convert = (v: string) => (v.trim() ? fromKg(toKg(v, from), to) : v);

    setWeightStr(convert);
    setDrops(prev => prev.map(d => ({ ...d, weightStr: convert(d.weightStr) })));
    setUnitOverrides(prev => ({ ...prev, [re.id]: to }));
  }

  function machinePhotoFor(re: RoutineExercise | undefined): string | null {
    if (!re) return null;
    const ex = exercises.find(e => e.id === re.exercise_id)
            ?? exercises.find(e => e.name === re.exercise_name);
    return ex?.machinePhotoUrl || ex?.machine_photo_path || null;
  }

  function addDrop() { setDrops(p => [...p, { weightStr: "", repsStr: "" }]); }
  function removeDrop(i: number) { setDrops(p => p.filter((_, idx) => idx !== i)); }
  function updateDrop(i: number, field: "weightStr" | "repsStr", val: string) {
    setDrops(p => p.map((d, idx) => idx === i ? { ...d, [field]: val } : d));
  }
  function buildDrops(): Drop[] {
    return drops
      .map(d => ({ weight: d.weightStr ? parseFloat(d.weightStr) : null, reps: d.repsStr ? parseInt(d.repsStr) : null }))
      .filter(d => d.weight != null || d.reps != null);
  }

  const currentEx    = routineExercises[exIdx];
  const totalSets    = routineExercises.reduce((s, ex) => s + ex.planned_sets, 0);
  const completedSets = loggedSets.length;

  /* ── Standard: pre-fill inputs when exercise/set changes ── */
  useEffect(() => {
    if (mode !== "standard" || phase !== "workout" || !currentEx) return;
    setWeightStr(fromKg(currentEx.planned_weight_kg, unitFor(currentEx)));
    setRepsStr(String(currentEx.planned_reps));
    setDrops([{ weightStr: "", repsStr: "" }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exIdx, setIdx, phase, mode]);

  /* ── Standard: rest countdown ── */
  useEffect(() => {
    if (phase !== "resting") return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [phase]);

  /* While the app is backgrounded no JS runs, so the sound/haptic below can't
     fire — on native, a scheduled local notification announces the end of rest
     instead. Rescheduled whenever the deadline moves (+30 s, presets). */
  useEffect(() => {
    if (phase !== "resting" || restEndsAt == null || !isNative) return;
    void scheduleRestNotification(restEndsAt, t.activeWorkout.restOverTitle, t.activeWorkout.restOverBody);
    return () => { void cancelRestNotification(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, restEndsAt]);

  useEffect(() => {
    if (phase === "resting" && restEndsAt != null && now >= restEndsAt) {
      playRestComplete();
      if (isNative) Haptics.vibrate({ duration: 350 }).catch(() => {});
      else webVibrate([200, 100, 200]);
      advanceToNextSet();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, now, restEndsAt]);

  /* ══ STANDARD MODE FUNCTIONS ══ */

  function advanceToNextSet() {
    const nextSet = setIdx + 1;
    if (nextSet < currentEx.planned_sets) {
      setSetIdx(nextSet);
      setPhase("workout");
    } else {
      const nextEx = exIdx + 1;
      if (nextEx < routineExercises.length) {
        setExIdx(nextEx);
        setSetIdx(0);
        setPhase("workout");
      } else {
        setPhase("done");
      }
    }
  }

  function handleSetDone() {
    const reps     = parseReps(repsStr, currentEx.planned_reps);
    const weight   = weightStr ? parseFloat(weightStr) : null;
    const newSet: LoggedSet = {
      exerciseId:   currentEx.exercise_id,
      exerciseName: currentEx.exercise_name,
      setNumber:    setIdx + 1,
      setType:      currentEx.set_type ?? "normal",
      reps,
      weight,
      weight_unit:  unitFor(currentEx),
      drops: currentEx.set_type === "dropset" ? buildDrops() : [],
    };
    const updated = [...loggedSets, newSet];
    setLoggedSets(updated);

    if (setIdx + 1 >= currentEx.planned_sets && exIdx + 1 >= routineExercises.length) {
      setPhase("done");
    } else {
      setRestDuration(currentEx.rest_seconds);
      setRestEndsAt(Date.now() + currentEx.rest_seconds * 1000);
      setPhase("resting");
    }
  }

  function skipRest() {
    advanceToNextSet();
  }

  function addThirtySeconds() {
    setRestEndsAt(e => (e ?? Date.now()) + 30_000);
    setRestDuration(d => d + 30);
  }

  function changeRestPreset(secs: number) {
    setRestDuration(secs);
    setRestEndsAt(Date.now() + secs * 1000);
  }

  function nextSetLabel(): string {
    const nextSet = setIdx + 1;
    if (nextSet < currentEx.planned_sets) {
      return t.activeWorkout.nextSetOfEx(nextSet + 1, currentEx.planned_sets, currentEx.exercise_name);
    }
    const nextEx = routineExercises[exIdx + 1];
    return nextEx ? t.activeWorkout.nextExSet(nextEx.exercise_name, nextEx.planned_sets) : t.activeWorkout.lastSetDone;
  }

  /* ══ CIRCUIT MODE FUNCTIONS ══ */

  function startCircuit() {
    const counts = routineExercises.map(() => 0);
    setSetsLoggedCount(counts);
    setActiveCircuitEx(0);
    const first = routineExercises[0];
    if (first) {
      setWeightStr(fromKg(first.planned_weight_kg, unitFor(first)));
      setRepsStr(String(first.planned_reps));
    }
    setDrops([{ weightStr: "", repsStr: "" }]);
    setMode("circuit");
  }

  function selectCircuitEx(i: number) {
    if ((setsLoggedCount[i] ?? 0) >= routineExercises[i].planned_sets) return;
    setActiveCircuitEx(i);
    const ex = routineExercises[i];
    setWeightStr(fromKg(ex.planned_weight_kg, unitFor(ex)));
    setRepsStr(String(ex.planned_reps));
    setDrops([{ weightStr: "", repsStr: "" }]);
  }

  function logCircuitSet() {
    const ex        = routineExercises[activeCircuitEx];
    const reps      = parseReps(repsStr, ex.planned_reps);
    const weight    = weightStr ? parseFloat(weightStr) : null;
    const setNumber = (setsLoggedCount[activeCircuitEx] ?? 0) + 1;

    const newSet: LoggedSet = {
      exerciseId:   ex.exercise_id,
      exerciseName: ex.exercise_name,
      setNumber,
      setType:      ex.set_type ?? "normal",
      reps,
      weight,
      weight_unit:  unitFor(ex),
      drops: ex.set_type === "dropset" ? buildDrops() : [],
    };

    const newCounts = setsLoggedCount.map((c, i) =>
      i === activeCircuitEx ? c + 1 : c
    );
    setSetsLoggedCount(newCounts);
    setLoggedSets(prev => [...prev, newSet]);

    const nextIncomplete = newCounts.findIndex((c, i) => c < routineExercises[i].planned_sets);
    if (nextIncomplete === -1) {
      setPhase("done");
    } else {
      setActiveCircuitEx(nextIncomplete);
      const nextEx = routineExercises[nextIncomplete];
      setWeightStr(fromKg(nextEx.planned_weight_kg, unitFor(nextEx)));
      setRepsStr(String(nextEx.planned_reps));
      setDrops([{ weightStr: "", repsStr: "" }]);
    }
  }

  /* ══ RENDER ══ */

  const circuitActiveEx = routineExercises[activeCircuitEx];

  return (
    <div className="fixed inset-0 z-[60] bg-[var(--bg)] flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--border)] shrink-0">
        <button
          onClick={() => setConfirmCancel(true)}
          className="text-[var(--faint)] hover:text-[var(--muted)] text-sm transition-colors"
        >
          ✕
        </button>

        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-[var(--text)]">{folder.name}</p>
          {mode === "circuit" && (
            <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-full border border-[var(--accent)] text-[var(--accent)]">
              {t.activeWorkout.circuit}
            </span>
          )}
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 items-center">
          {routineExercises.map((ex, i) => {
            const logged = setsLoggedCount[i] ?? 0;
            const done   = mode === "circuit" ? logged >= ex.planned_sets : i < exIdx;
            const active = mode === "circuit" ? i === activeCircuitEx && phase !== "done"
                                              : i === exIdx;
            const partial = mode === "circuit" && logged > 0 && !done;
            return (
              <div
                key={i}
                onClick={() => mode === "circuit" && selectCircuitEx(i)}
                className={`rounded-full transition-all ${mode === "circuit" ? "cursor-pointer" : ""} ${
                  done    ? "w-2 h-2 bg-[var(--accent)]" :
                  active  ? "w-2.5 h-2.5 bg-[var(--text)]" :
                  partial ? "w-2 h-2 border border-[var(--accent)]" :
                            "w-2 h-2 bg-[var(--border)]"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="h-0.5 bg-[var(--border)] shrink-0">
        <div
          className="h-full bg-[var(--accent)] transition-all duration-500"
          style={{ width: `${totalSets > 0 ? (completedSets / totalSets) * 100 : 0}%` }}
        />
      </div>

      {/* ══ MODE PICKER ══ */}
      {mode === null && (
        <div className="flex-1 flex flex-col justify-center px-6 gap-8">
          <div className="text-center">
            <p className="text-[11px] text-[var(--faint)] tracking-widest uppercase mb-2">{t.activeWorkout.trainingStyle}</p>
            <h2 className="text-xl font-semibold text-[var(--text)]">{t.activeWorkout.howToTrain}</h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode("standard")}
              className="card flex flex-col gap-3 text-left hover:border-[var(--muted)] transition-colors active:scale-[0.98]"
            >
              <span className="text-2xl">📋</span>
              <div>
                <p className="font-semibold text-[var(--text)] text-sm">{t.activeWorkout.standardTitle}</p>
                <p className="text-[11px] text-[var(--faint)] mt-1 leading-relaxed">
                  {t.activeWorkout.standardDesc}
                </p>
              </div>
            </button>

            <button
              onClick={startCircuit}
              className="card flex flex-col gap-3 text-left hover:border-[var(--accent)] transition-colors active:scale-[0.98]"
            >
              <span className="text-2xl">🔄</span>
              <div>
                <p className="font-semibold text-[var(--text)] text-sm">{t.activeWorkout.circuitTitle}</p>
                <p className="text-[11px] text-[var(--faint)] mt-1 leading-relaxed">
                  {t.activeWorkout.circuitDesc}
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ══ STANDARD MODE ══ */}
      {mode === "standard" && (
        <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col">

          {/* WORKOUT PHASE */}
          {phase === "workout" && currentEx && (
            <div className="flex flex-col gap-6 flex-1">
              <div>
                <p className="text-[11px] text-[var(--faint)] tracking-widest uppercase mb-1">
                  {t.activeWorkout.exerciseOf(exIdx + 1, routineExercises.length)}
                </p>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-semibold text-[var(--text)] leading-tight">
                    {currentEx.exercise_name}
                  </h2>
                  {currentEx.set_type === "dropset" && (
                    <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-full border border-blue-400/40 text-blue-400">
                      DROP
                    </span>
                  )}
                  {currentEx.set_type === "warmup" && (
                    <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-full border border-amber-400/40 text-amber-400">
                      WARMUP
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--sub)] mt-1">
                  {t.activeWorkout.setOf(setIdx + 1, currentEx.planned_sets)}
                </p>
              </div>

              {(() => {
                const url = machinePhotoFor(currentEx);
                return url ? (
                  <button
                    type="button"
                    onClick={() => setPhotoView({ url, name: currentEx.exercise_name })}
                    aria-label={t.workoutSession.viewMachinePhoto(currentEx.exercise_name)}
                    className="relative h-32 w-full rounded-xl overflow-hidden ring-1 ring-[var(--border)] -mt-2"
                  >
                    <Image src={url} alt={currentEx.exercise_name} fill className="object-cover" sizes="400px" />
                  </button>
                ) : null;
              })()}

              <div className="grid grid-cols-2 gap-4">
                <div className="card-sm flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <UnitToggleLabel
                      label={t.activeWorkout.weightUnit(unitFor(currentEx))}
                      nextUnit={unitFor(currentEx) === "kg" ? "lbs" : "kg"}
                      onToggle={() => toggleUnitFor(currentEx)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPlates(true)}
                      aria-label={t.plateCalc.title}
                      className="text-[10px] text-[var(--accent)] leading-none hover:opacity-80 transition-opacity"
                    >
                      ⚖
                    </button>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={weightStr}
                    onChange={e => setWeightStr(e.target.value)}
                    placeholder="—"
                    className="input-base text-xl font-semibold text-center metric py-2"
                  />
                </div>
                <div className="card-sm flex flex-col gap-1">
                  <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider">
                    {t.activeWorkout.reps}
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={repsStr}
                    onChange={e => setRepsStr(e.target.value)}
                    className="input-base text-xl font-semibold text-center metric py-2"
                  />
                </div>
              </div>

              {currentEx.set_type === "dropset" && (
                <>
                  {drops.map((drop, di) => (
                    <div key={di} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-blue-400/20" />
                        <span className="text-[10px] text-blue-400 font-semibold tracking-widest uppercase">
                          Drop {di + 1}
                        </span>
                        {drops.length > 1 && (
                          <button
                            onClick={() => removeDrop(di)}
                            className="text-[10px] text-[var(--faint)] hover:text-[var(--muted)] transition-colors"
                          >
                            ×
                          </button>
                        )}
                        <div className="flex-1 h-px bg-blue-400/20" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="card-sm flex flex-col gap-1 border-blue-400/20">
                          <UnitToggleLabel
                            label={t.activeWorkout.weightUnit(unitFor(currentEx))}
                            nextUnit={unitFor(currentEx) === "kg" ? "lbs" : "kg"}
                            onToggle={() => toggleUnitFor(currentEx)}
                          />
                          <input
                            type="number" inputMode="decimal"
                            value={drop.weightStr}
                            onChange={e => updateDrop(di, "weightStr", e.target.value)}
                            placeholder="—"
                            className="input-base text-xl font-semibold text-center metric py-2"
                          />
                        </div>
                        <div className="card-sm flex flex-col gap-1 border-blue-400/20">
                          <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider">
                            {t.activeWorkout.reps}
                          </label>
                          <input
                            type="number" inputMode="numeric"
                            value={drop.repsStr}
                            onChange={e => updateDrop(di, "repsStr", e.target.value)}
                            className="input-base text-xl font-semibold text-center metric py-2"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={addDrop}
                    className="text-[11px] text-blue-400/70 hover:text-blue-400 transition-colors text-left"
                  >
                    + drop
                  </button>
                </>
              )}

              <div className="mt-auto">
                <button onClick={handleSetDone} className="btn-primary w-full py-4 text-base font-semibold">
                  {t.activeWorkout.doneStartRest}
                </button>
                {completedSets > 0 && (
                  <p className="text-center text-[11px] text-[var(--faint)] mt-3">
                    {t.activeWorkout.setsCompleted(completedSets, totalSets)}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* RESTING PHASE */}
          {phase === "resting" && (
            <div className="flex flex-col items-center gap-6 flex-1">
              <div className="text-center">
                <p className="text-[11px] text-[var(--faint)] tracking-widest uppercase mb-1">{t.activeWorkout.rest}</p>
                <p className="text-sm text-[var(--sub)]">{nextSetLabel()}</p>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full">
                <p className="metric text-7xl font-semibold text-[var(--text)] tabular-nums">
                  {fmtTime(restSecsLeft)}
                </p>

                <div className="w-full h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all duration-1000"
                    style={{
                      width: `${restDuration > 0 ? ((restDuration - restSecsLeft) / restDuration) * 100 : 100}%`
                    }}
                  />
                </div>

                <div className="grid grid-cols-4 gap-2 w-full">
                  {REST_PRESETS.map((secs, i) => (
                    <button
                      key={secs}
                      onClick={() => changeRestPreset(secs)}
                      className={`btn-outline py-2 text-xs ${restDuration === secs ? "border-[var(--accent)] text-[var(--accent)]" : ""}`}
                    >
                      {REST_LABELS[i]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 w-full">
                <button onClick={addThirtySeconds} className="btn-ghost flex-1 text-sm">
                  {t.activeWorkout.addThirty}
                </button>
                <button onClick={skipRest} className="btn-outline flex-1 text-sm">
                  {t.activeWorkout.skipRest}
                </button>
              </div>
            </div>
          )}

          {/* DONE PHASE — standard */}
          {phase === "done" && (
            <div className="flex flex-col items-center gap-6 flex-1 justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-[var(--accent-faint)] border border-[var(--accent)]/30 flex items-center justify-center">
                <span className="text-2xl text-[var(--accent)]">✓</span>
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-[var(--text)]">{t.activeWorkout.workoutComplete}</h2>
                <p className="text-sm text-[var(--sub)] mt-2">
                  {t.activeWorkout.setsAcross(loggedSets.length, routineExercises.length)}
                </p>
                <p className="text-[11px] text-[var(--faint)] mt-1">
                  {t.activeWorkout.totalVolume(loggedSets.reduce((vol, s) => vol + (s.weight ?? 0) * s.reps, 0).toFixed(0))}
                </p>
              </div>

              <VolumeFeedbackPanel
                targets={feedbackTargets}
                value={feedback}
                onChange={updateFeedback}
              />

              <div className="w-full space-y-3">
                {saveError && (
                  <p className="text-[12px] text-red-400">{saveError}</p>
                )}
                <button onClick={handleFinish} disabled={saving}
                  className="btn-primary w-full py-4 text-base font-semibold disabled:opacity-60">
                  {saving ? t.activeWorkout.saving : t.activeWorkout.saveWorkout}
                </button>
                <button onClick={() => setConfirmCancel(true)} disabled={saving}
                  className="w-full text-sm text-[var(--dim)] hover:text-[var(--faint)] transition-colors disabled:opacity-60">
                  {t.activeWorkout.discard}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ CIRCUIT MODE ══ */}
      {mode === "circuit" && phase !== "done" && (
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Exercise list */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {routineExercises.map((ex, i) => {
              const logged  = setsLoggedCount[i] ?? 0;
              const done    = logged >= ex.planned_sets;
              const isActive = activeCircuitEx === i;
              const rowPhoto = machinePhotoFor(ex);

              return (
                <button
                  key={ex.id}
                  onClick={() => selectCircuitEx(i)}
                  disabled={done}
                  className={`w-full text-left card-sm flex items-center gap-3 transition-all ${
                    isActive ? "border-[var(--accent)]" :
                    done     ? "opacity-40" :
                               "hover:border-[var(--muted)]"
                  }`}
                >
                  {rowPhoto && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); setPhotoView({ url: rowPhoto, name: ex.exercise_name }); }}
                      className="relative h-9 w-9 rounded-lg overflow-hidden ring-1 ring-[var(--border)] shrink-0 block"
                    >
                      <Image src={rowPhoto} alt={ex.exercise_name} fill className="object-cover" sizes="36px" />
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isActive ? "text-[var(--accent)]" : "text-[var(--text)]"}`}>
                      {ex.exercise_name}
                    </p>
                    {/* Per-exercise set dots */}
                    <div className="flex gap-1 mt-1.5">
                      {Array.from({ length: ex.planned_sets }).map((_, j) => (
                        <div
                          key={j}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            j < logged ? "bg-[var(--accent)]" : "border border-[var(--border)]"
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <span className="text-xs text-[var(--faint)] shrink-0 tabular-nums">
                    {logged}/{ex.planned_sets}
                  </span>

                  {done ? (
                    <span className="text-sm text-[var(--accent)] shrink-0">✓</span>
                  ) : (
                    <span className={`text-[11px] shrink-0 px-2 py-0.5 rounded-full border transition-colors ${
                      isActive
                        ? "border-[var(--accent)] text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted)]"
                    }`}>
                      Log
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Pinned input panel */}
          {circuitActiveEx && (
            <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg)] px-6 pt-4 pb-6 space-y-3 overflow-y-auto max-h-[60vh]">
              <div>
                <p className="text-[10px] text-[var(--faint)] tracking-widest uppercase">{t.activeWorkout.nowLogging}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {(() => {
                    const url = machinePhotoFor(circuitActiveEx);
                    return url ? (
                      <button
                        type="button"
                        onClick={() => setPhotoView({ url, name: circuitActiveEx.exercise_name })}
                        aria-label={t.workoutSession.viewMachinePhoto(circuitActiveEx.exercise_name)}
                        className="relative h-10 w-10 rounded-lg overflow-hidden ring-1 ring-[var(--border)] shrink-0"
                      >
                        <Image src={url} alt={circuitActiveEx.exercise_name} fill className="object-cover" sizes="40px" />
                      </button>
                    ) : null;
                  })()}
                  <p className="text-base font-semibold text-[var(--text)]">{circuitActiveEx.exercise_name}</p>
                  {circuitActiveEx.set_type === "dropset" && (
                    <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-full border border-blue-400/40 text-blue-400">DROP</span>
                  )}
                  {circuitActiveEx.set_type === "warmup" && (
                    <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-full border border-amber-400/40 text-amber-400">WARMUP</span>
                  )}
                </div>
                <p className="text-xs text-[var(--sub)]">
                  {t.activeWorkout.setOf((setsLoggedCount[activeCircuitEx] ?? 0) + 1, circuitActiveEx.planned_sets)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="card-sm flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <UnitToggleLabel
                      label={t.activeWorkout.weightUnit(unitFor(circuitActiveEx))}
                      nextUnit={unitFor(circuitActiveEx) === "kg" ? "lbs" : "kg"}
                      onToggle={() => toggleUnitFor(circuitActiveEx)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPlates(true)}
                      aria-label={t.plateCalc.title}
                      className="text-[10px] text-[var(--accent)] leading-none hover:opacity-80 transition-opacity"
                    >
                      ⚖
                    </button>
                  </div>
                  <input
                    type="number" inputMode="decimal"
                    value={weightStr} onChange={e => setWeightStr(e.target.value)}
                    placeholder="—"
                    className="input-base text-xl font-semibold text-center metric py-2"
                  />
                </div>
                <div className="card-sm flex flex-col gap-1">
                  <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider">
                    {t.activeWorkout.reps}
                  </label>
                  <input
                    type="number" inputMode="numeric"
                    value={repsStr} onChange={e => setRepsStr(e.target.value)}
                    className="input-base text-xl font-semibold text-center metric py-2"
                  />
                </div>
              </div>

              {circuitActiveEx.set_type === "dropset" && (
                <>
                  {drops.map((drop, di) => (
                    <div key={di} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-blue-400/20" />
                        <span className="text-[10px] text-blue-400 font-semibold tracking-widest uppercase">
                          Drop {di + 1}
                        </span>
                        {drops.length > 1 && (
                          <button
                            onClick={() => removeDrop(di)}
                            className="text-[10px] text-[var(--faint)] hover:text-[var(--muted)] transition-colors"
                          >
                            ×
                          </button>
                        )}
                        <div className="flex-1 h-px bg-blue-400/20" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="card-sm flex flex-col gap-1 border-blue-400/20">
                          <UnitToggleLabel
                            label={t.activeWorkout.weightUnit(unitFor(circuitActiveEx))}
                            nextUnit={unitFor(circuitActiveEx) === "kg" ? "lbs" : "kg"}
                            onToggle={() => toggleUnitFor(circuitActiveEx)}
                          />
                          <input type="number" inputMode="decimal" value={drop.weightStr}
                            onChange={e => updateDrop(di, "weightStr", e.target.value)} placeholder="—"
                            className="input-base text-xl font-semibold text-center metric py-2" />
                        </div>
                        <div className="card-sm flex flex-col gap-1 border-blue-400/20">
                          <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider">{t.activeWorkout.reps}</label>
                          <input type="number" inputMode="numeric" value={drop.repsStr}
                            onChange={e => updateDrop(di, "repsStr", e.target.value)}
                            className="input-base text-xl font-semibold text-center metric py-2" />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={addDrop}
                    className="text-[11px] text-blue-400/70 hover:text-blue-400 transition-colors text-left"
                  >
                    + drop
                  </button>
                </>
              )}

              <button onClick={logCircuitSet} className="btn-primary w-full py-3 text-base font-semibold">
                {t.activeWorkout.logThisSet}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══ DONE PHASE (circuit) ══ */}
      {mode === "circuit" && phase === "done" && (
        <div className="flex-1 flex flex-col items-center gap-6 justify-center text-center px-6 py-8 overflow-y-auto">
          <div className="w-16 h-16 rounded-full bg-[var(--accent-faint)] border border-[var(--accent)]/30 flex items-center justify-center">
            <span className="text-2xl text-[var(--accent)]">✓</span>
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-[var(--text)]">{t.activeWorkout.circuitComplete}</h2>
            <p className="text-sm text-[var(--sub)] mt-2">
              {t.activeWorkout.setsAcross(loggedSets.length, routineExercises.length)}
            </p>
            <p className="text-[11px] text-[var(--faint)] mt-1">
              {t.activeWorkout.totalVolume(loggedSets.reduce((vol, s) => vol + (s.weight ?? 0) * s.reps, 0).toFixed(0))}
            </p>
          </div>

          <VolumeFeedbackPanel
            targets={feedbackTargets}
            value={feedback}
            onChange={updateFeedback}
          />

          <div className="w-full space-y-3">
            {saveError && (
              <p className="text-[12px] text-red-400">{saveError}</p>
            )}
            <button onClick={handleFinish} disabled={saving}
              className="btn-primary w-full py-4 text-base font-semibold disabled:opacity-60">
              {saving ? t.activeWorkout.saving : t.activeWorkout.saveWorkout}
            </button>
            <button onClick={() => setConfirmCancel(true)} disabled={saving}
              className="w-full text-sm text-[var(--dim)] hover:text-[var(--faint)] transition-colors disabled:opacity-60">
              {t.activeWorkout.discard}
            </button>
          </div>
        </div>
      )}

      {/* ── Plate calculator sheet ── */}
      {showPlates && (
        <PlateCalculator
          initialTarget={weightStr ? parseFloat(weightStr) : null}
          /* initialTarget is whatever is in the weight input, so the plate math
             must use that input's unit, not the profile's. */
          unit={unitFor(mode === "circuit" ? circuitActiveEx : currentEx)}
          onClose={() => setShowPlates(false)}
        />
      )}

      {/* ── Machine photo lightbox ── */}
      {photoView && (
        <div
          className="fixed inset-0 z-[75] bg-black/80 flex items-center justify-center p-6"
          onClick={() => setPhotoView(null)}
        >
          <div className="w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
            <div className="relative w-full aspect-square rounded-2xl overflow-hidden">
              <Image src={photoView.url} alt={photoView.name} fill className="object-contain" sizes="448px" />
            </div>
            <p className="text-center text-sm text-white/80">{photoView.name}</p>
          </div>
        </div>
      )}

      {/* ── Cancel confirmation ── */}
      {confirmCancel && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-end">
          <div className="w-full bg-[var(--bg)] rounded-t-2xl p-6 space-y-3 border-t border-[var(--border)]">
            <p className="text-[var(--text)] font-semibold text-center">{t.activeWorkout.abandonWorkout}</p>
            <p className="text-[var(--faint)] text-sm text-center">{t.activeWorkout.progressNotSaved}</p>
            <button
              onClick={onCancel}
              className="w-full py-3 rounded-xl text-sm font-medium text-red-400 border border-red-400/30"
            >
              {t.activeWorkout.abandon}
            </button>
            <button onClick={() => setConfirmCancel(false)} className="btn-ghost w-full">
              {t.activeWorkout.keepGoing}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
