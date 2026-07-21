"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Haptics } from "@capacitor/haptics";
import { isNative } from "@/lib/platform";
import { playRestComplete } from "@/lib/sounds";
import PlateCalculator from "@/components/training/PlateCalculator";
import type { Exercise, WorkoutFolder, RoutineExercise, WeightUnit, LoggedSet, Drop } from "@/types";
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

interface Props {
  folder:           WorkoutFolder;
  routineExercises: RoutineExercise[];
  exercises?:       Exercise[];
  unit:             WeightUnit;
  onFinish:         (sets: LoggedSet[]) => void;
  onCancel:         () => void;
}

export default function ActiveWorkout({ folder, routineExercises, exercises = [], unit, onFinish, onCancel }: Props) {
  const t = useT();
  /* ── Mode ── */
  const [mode, setMode] = useState<WorkoutMode | null>(null);

  /* ── Standard mode state ── */
  const [exIdx,        setExIdx]        = useState(0);
  const [setIdx,       setSetIdx]       = useState(0);
  const [phase,        setPhase]        = useState<"workout" | "resting" | "done">("workout");
  const [restSecsLeft, setRestSecsLeft] = useState(0);
  const [restDuration, setRestDuration] = useState(60);

  /* ── Circuit mode state ── */
  const [setsLoggedCount, setSetsLoggedCount] = useState<number[]>([]);
  const [activeCircuitEx, setActiveCircuitEx] = useState(0);

  /* ── Shared state ── */
  const [loggedSets,    setLoggedSets]    = useState<LoggedSet[]>([]);
  const [weightStr,     setWeightStr]     = useState("");
  const [repsStr,       setRepsStr]       = useState("");
  const [drops,         setDrops]         = useState<{weightStr: string; repsStr: string}[]>([{ weightStr: "", repsStr: "" }]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [photoView,     setPhotoView]     = useState<{ url: string; name: string } | null>(null);
  const [showPlates,    setShowPlates]    = useState(false);

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
    setWeightStr(fromKg(currentEx.planned_weight_kg, unit));
    setRepsStr(String(currentEx.planned_reps));
    setDrops([{ weightStr: "", repsStr: "" }]);
  }, [exIdx, setIdx, phase, mode]);

  /* ── Standard: rest countdown ── */
  useEffect(() => {
    if (phase !== "resting" || restSecsLeft <= 0) return;
    const t = setTimeout(() => setRestSecsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, restSecsLeft]);

  useEffect(() => {
    if (phase === "resting" && restSecsLeft === 0) {
      playRestComplete();
      if (isNative) Haptics.vibrate({ duration: 350 }).catch(() => {});
      else navigator.vibrate?.([200, 100, 200]);
      advanceToNextSet();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, restSecsLeft]);

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
    const reps     = parseInt(repsStr) || currentEx.planned_reps;
    const weight   = weightStr ? parseFloat(weightStr) : null;
    const newSet: LoggedSet = {
      exerciseId:   currentEx.exercise_id,
      exerciseName: currentEx.exercise_name,
      setNumber:    setIdx + 1,
      setType:      currentEx.set_type ?? "normal",
      reps,
      weight,
      weight_unit:  unit,
      drops: currentEx.set_type === "dropset" ? buildDrops() : [],
    };
    const updated = [...loggedSets, newSet];
    setLoggedSets(updated);

    if (setIdx + 1 >= currentEx.planned_sets && exIdx + 1 >= routineExercises.length) {
      setPhase("done");
    } else {
      setRestDuration(currentEx.rest_seconds);
      setRestSecsLeft(currentEx.rest_seconds);
      setPhase("resting");
    }
  }

  function skipRest() {
    advanceToNextSet();
  }

  function changeRestPreset(secs: number) {
    setRestDuration(secs);
    setRestSecsLeft(secs);
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
      setWeightStr(fromKg(first.planned_weight_kg, unit));
      setRepsStr(String(first.planned_reps));
    }
    setDrops([{ weightStr: "", repsStr: "" }]);
    setMode("circuit");
  }

  function selectCircuitEx(i: number) {
    if ((setsLoggedCount[i] ?? 0) >= routineExercises[i].planned_sets) return;
    setActiveCircuitEx(i);
    const ex = routineExercises[i];
    setWeightStr(fromKg(ex.planned_weight_kg, unit));
    setRepsStr(String(ex.planned_reps));
    setDrops([{ weightStr: "", repsStr: "" }]);
  }

  function logCircuitSet() {
    const ex        = routineExercises[activeCircuitEx];
    const reps      = parseInt(repsStr) || ex.planned_reps;
    const weight    = weightStr ? parseFloat(weightStr) : null;
    const setNumber = (setsLoggedCount[activeCircuitEx] ?? 0) + 1;

    const newSet: LoggedSet = {
      exerciseId:   ex.exercise_id,
      exerciseName: ex.exercise_name,
      setNumber,
      setType:      ex.set_type ?? "normal",
      reps,
      weight,
      weight_unit:  unit,
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
      setWeightStr(fromKg(nextEx.planned_weight_kg, unit));
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
                    aria-label={`View ${currentEx.exercise_name} machine photo`}
                    className="relative h-32 w-full rounded-xl overflow-hidden ring-1 ring-[var(--border)] -mt-2"
                  >
                    <Image src={url} alt={currentEx.exercise_name} fill className="object-cover" sizes="400px" />
                  </button>
                ) : null;
              })()}

              <div className="grid grid-cols-2 gap-4">
                <div className="card-sm flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider">
                      {t.activeWorkout.weightUnit(unit)}
                    </label>
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
                          <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider">
                            {t.activeWorkout.weightUnit(unit)}
                          </label>
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
                <button onClick={() => setRestSecsLeft(s => s + 30)} className="btn-ghost flex-1 text-sm">
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
              <div className="w-full space-y-3">
                <button onClick={() => onFinish(loggedSets)} className="btn-primary w-full py-4 text-base font-semibold">
                  {t.activeWorkout.saveWorkout}
                </button>
                <button onClick={onCancel} className="w-full text-sm text-[var(--dim)] hover:text-[var(--faint)] transition-colors">
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
                        aria-label={`View ${circuitActiveEx.exercise_name} machine photo`}
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
                    <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider">
                      {t.activeWorkout.weightUnit(unit)}
                    </label>
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
                          <label className="text-[10px] text-[var(--faint)] uppercase tracking-wider">{t.activeWorkout.weightUnit(unit)}</label>
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
        <div className="flex-1 flex flex-col items-center gap-6 justify-center text-center px-6">
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
          <div className="w-full space-y-3">
            <button onClick={() => onFinish(loggedSets)} className="btn-primary w-full py-4 text-base font-semibold">
              {t.activeWorkout.saveWorkout}
            </button>
            <button onClick={onCancel} className="w-full text-sm text-[var(--dim)] hover:text-[var(--faint)] transition-colors">
              {t.activeWorkout.discard}
            </button>
          </div>
        </div>
      )}

      {/* ── Plate calculator sheet ── */}
      {showPlates && (
        <PlateCalculator
          initialTarget={weightStr ? parseFloat(weightStr) : null}
          unit={unit}
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
