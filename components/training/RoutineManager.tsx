"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { enqueue } from "@/lib/offlineQueue";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import { withTimeout } from "@/lib/auth-utils";
import type { WorkoutFolder, Exercise, RoutineExercise, WeightUnit, SetType } from "@/types";
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

/* ── Sub-components ── */

interface RowProps {
  item: RoutineExercise;
  unit: WeightUnit;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onUpdate: (item: RoutineExercise) => void;
  onDelete: (item: RoutineExercise) => void;
  onMove: (dir: -1 | 1) => void;
}

const SET_TYPE_LABELS: Record<SetType, string> = {
  normal:  "Normal",
  warmup:  "Warmup",
  dropset: "Dropset",
};

function RoutineExerciseRow({ item, unit, canMoveUp, canMoveDown, onUpdate, onDelete, onMove }: RowProps) {
  const [sets,       setSets]       = useState(String(item.planned_sets));
  const [reps,       setReps]       = useState(String(item.planned_reps));
  const [weight,     setWeight]     = useState(fromKg(item.planned_weight_kg, unit));
  const [rest,       setRest]       = useState(item.rest_seconds);
  const [setType,    setSetType]    = useState<SetType>(item.set_type ?? "normal");
  const [confirmDel, setConfirmDel] = useState(false);

  function save(overrides: { sets?: string; reps?: string; weight?: string; rest?: number; setType?: SetType } = {}) {
    const s  = overrides.sets    ?? sets;
    const r  = overrides.reps    ?? reps;
    const w  = overrides.weight  ?? weight;
    const rs = overrides.rest    ?? rest;
    const st = overrides.setType ?? setType;
    onUpdate({
      ...item,
      planned_sets:      Math.max(1, parseInt(s)  || item.planned_sets),
      planned_reps:      Math.max(1, parseInt(r)  || item.planned_reps),
      planned_weight_kg: toKg(w, unit),
      rest_seconds:      rs,
      set_type:          st,
    });
  }

  return (
    <div className="space-y-2 py-3 border-b border-[var(--border-subtle)] last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--text)]">{item.exercise_name}</span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => onMove(-1)} disabled={!canMoveUp}
            className="w-7 h-7 flex items-center justify-center text-[var(--faint)] hover:text-[var(--muted)] disabled:opacity-20 transition-colors text-sm">↑</button>
          <button onClick={() => onMove(1)} disabled={!canMoveDown}
            className="w-7 h-7 flex items-center justify-center text-[var(--faint)] hover:text-[var(--muted)] disabled:opacity-20 transition-colors text-sm">↓</button>
          {confirmDel ? (
            <div className="flex items-center gap-1 ml-2 pl-2 border-l border-[var(--border)]">
              <button onClick={() => setConfirmDel(false)} className="text-[10px] text-[var(--muted)] px-1 py-0.5">Cancel</button>
              <button onClick={() => onDelete(item)} className="text-[10px] text-red-400 font-medium px-1 py-0.5">Del</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDel(true)}
              className="w-7 h-7 flex items-center justify-center text-[var(--faint)] hover:text-red-400 transition-colors text-base ml-2 pl-2 border-l border-[var(--border)]">×</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <p className="text-[10px] text-[var(--faint)] text-center">Sets</p>
        <p className="text-[10px] text-[var(--faint)] text-center">Reps</p>
        <p className="text-[10px] text-[var(--faint)] text-center">{unit === "lbs" ? "lbs" : "kg"}</p>
        <p className="text-[10px] text-[var(--faint)] text-center">Rest</p>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <input type="number" min="1" value={sets}
          onChange={e => setSets(e.target.value)} onBlur={() => save()} className="input-pill" />
        <input type="number" min="1" value={reps}
          onChange={e => setReps(e.target.value)} onBlur={() => save()} className="input-pill" />
        <input type="number" min="0" step={unit === "lbs" ? "2.5" : "1"} value={weight}
          onChange={e => setWeight(e.target.value)} onBlur={() => save()} placeholder="—" className="input-pill" />
        <select value={rest}
          onChange={e => { const v = parseInt(e.target.value); setRest(v); save({ rest: v }); }}
          className="input-pill px-1 cursor-pointer">
          <option value="30">30s</option>
          <option value="60">1 min</option>
          <option value="90">1:30</option>
          <option value="120">2 min</option>
          <option value="180">3 min</option>
        </select>
      </div>

      <div className="flex gap-1.5 pt-0.5">
        {(["normal", "warmup", "dropset"] as SetType[]).map(tp => (
          <button key={tp} type="button"
            onClick={() => { setSetType(tp); save({ setType: tp }); }}
            className={`flex-1 text-[10px] py-1 rounded-lg transition-colors font-medium ${
              setType === tp
                ? tp === "warmup"
                  ? "bg-amber-400/15 text-amber-400"
                  : tp === "dropset"
                  ? "bg-blue-400/15 text-blue-400"
                  : "bg-[var(--accent)]/15 text-[var(--accent)]"
                : "text-[var(--dim)] hover:text-[var(--faint)]"
            }`}>
            {SET_TYPE_LABELS[tp]}
          </button>
        ))}
      </div>
    </div>
  );
}

interface AddProps {
  exercises: Exercise[];
  onAdd: (exerciseId: string) => void;
}

function AddExerciseRow({ exercises, onAdd }: AddProps) {
  const [selected, setSelected] = useState("");
  const [adding,   setAdding]   = useState(false);
  const t = useT();

  async function handleAdd() {
    if (!selected) return;
    setAdding(true);
    await onAdd(selected);
    setSelected("");
    setAdding(false);
  }

  if (exercises.length === 0) {
    return (
      <p className="text-[11px] text-[var(--faint)] text-center py-2">
        {t.routineManager.addExercisesFirst}
      </p>
    );
  }

  return (
    <div className="flex gap-2 pt-2">
      <select value={selected} onChange={e => setSelected(e.target.value)}
        className="input-pill flex-1 text-left px-4 cursor-pointer" style={{ textAlign: "left" }}>
        <option value="">{t.routineManager.addExercisePicker}</option>
        {exercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
      </select>
      <button onClick={handleAdd} disabled={!selected || adding}
        className="btn-primary !rounded-full text-sm px-5 py-1.5 shrink-0">
        {t.routineManager.add}
      </button>
    </div>
  );
}

function friendlyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network"))
    return "Network error — check your connection.";
  if (m.includes("schema cache") || m.includes("column"))
    return "Database error — try refreshing the app.";
  if (m.includes("policy") || m.includes("rls") || m.includes("permission"))
    return "Not authorised. Try signing out and back in.";
  return "Something went wrong. Please try again.";
}

/* ── Main component ── */

interface Props {
  folders:              WorkoutFolder[];
  exercises:            Exercise[];
  unit:                 WeightUnit;
  userId:               string;
  initialRoutineMap:    Record<string, RoutineExercise[]>;
  onFolderCreated:      (f: WorkoutFolder) => void;
  onFolderDeleted:      (id: string) => void;
  onStartWorkout:       (folder: WorkoutFolder, items: RoutineExercise[]) => void;
  onRoutineMapChanged?: (map: Record<string, RoutineExercise[]>) => void;
}

export default function RoutineManager({
  folders, exercises, unit, userId, initialRoutineMap,
  onFolderCreated, onFolderDeleted, onStartWorkout, onRoutineMapChanged,
}: Props) {
  const t = useT();
  const { isOnline, triggerSync } = useOnlineSync();
  const [routineMap,      setRoutineMap]      = useState<Record<string, RoutineExercise[]>>(initialRoutineMap);
  const [expandedId,      setExpandedId]      = useState<string | null>(null);
  const [showNewFolder,   setShowNewFolder]   = useState(false);
  const [newFolderName,   setNewFolderName]   = useState("");
  const [saving,          setSaving]          = useState(false);
  const [folderError,     setFolderError]     = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const folderIds = folders.map(f => f.id).join(",");

  /* Sync initial map when parent data loads */
  useEffect(() => {
    setRoutineMap(initialRoutineMap);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderIds]);

  /* Load from DB only when online */
  useEffect(() => {
    if (folders.length === 0 || !isOnline || userId === "guest-user") return;
    withTimeout(
      supabase
        .from("routine_exercises")
        .select("*")
        .in("folder_id", folders.map(f => f.id))
        .order("order_index")
    )
      .then(({ data }: any) => {
        if (!data) return;
        const map: Record<string, RoutineExercise[]> = {};
        for (const item of data as RoutineExercise[]) {
          if (!map[item.folder_id]) map[item.folder_id] = [];
          map[item.folder_id].push(item);
        }
        setRoutineMap(map);
        onRoutineMapChanged?.(map);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderIds, isOnline]);

  /* ── Folder operations ── */

  async function createFolder() {
    if (!newFolderName.trim()) return;
    setSaving(true);
    setFolderError(null);

    if (!isOnline || userId === "guest-user") {
      const fakeId = crypto.randomUUID();
      const fakeFolder: WorkoutFolder = {
        id: fakeId, user_id: userId, name: newFolderName.trim(),
        parent_folder_id: null, created_at: new Date().toISOString(),
      };
      await enqueue({
        type:       "upsert",
        table:      "workout_folders",
        payload:    { id: fakeId, user_id: userId, name: newFolderName.trim() },
        conflictOn: "id",
      });
      onFolderCreated(fakeFolder);
      const newMap = { ...routineMap, [fakeId]: [] };
      setRoutineMap(newMap);
      onRoutineMapChanged?.(newMap);
      setNewFolderName("");
      setShowNewFolder(false);
      setExpandedId(fakeId);
      setSaving(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("workout_folders")
        .insert({ user_id: userId, name: newFolderName.trim() })
        .select().single();

      if (error) throw error;
      if (data) {
        onFolderCreated(data as WorkoutFolder);
        const newMap = { ...routineMap, [data.id]: [] };
        setRoutineMap(newMap);
        onRoutineMapChanged?.(newMap);
        setNewFolderName("");
        setShowNewFolder(false);
        setExpandedId(data.id);
      }
    } catch {
      const fakeId = crypto.randomUUID();
      const fakeFolder: WorkoutFolder = {
        id: fakeId, user_id: userId, name: newFolderName.trim(),
        parent_folder_id: null, created_at: new Date().toISOString(),
      };
      await enqueue({
        type:       "upsert",
        table:      "workout_folders",
        payload:    { id: fakeId, user_id: userId, name: newFolderName.trim() },
        conflictOn: "id",
      });
      onFolderCreated(fakeFolder);
      const newMap = { ...routineMap, [fakeId]: [] };
      setRoutineMap(newMap);
      onRoutineMapChanged?.(newMap);
      setNewFolderName("");
      setShowNewFolder(false);
      setExpandedId(fakeId);
      triggerSync();
    }
    setSaving(false);
  }

  async function deleteFolder(id: string) {
    if (!isOnline || userId === "guest-user") {
      await enqueue({ type: "delete", table: "workout_folders", column: "id", value: id });
    } else {
      try {
        const { error } = await supabase.from("workout_folders").delete().eq("id", id);
        if (error) throw error;
      } catch {
        await enqueue({ type: "delete", table: "workout_folders", column: "id", value: id });
        triggerSync();
      }
    }
    onFolderDeleted(id);
    const { [id]: _omit, ...newMap } = routineMap;
    setRoutineMap(newMap);
    onRoutineMapChanged?.(newMap);
    if (expandedId === id) setExpandedId(null);
  }

  /* ── Routine exercise operations ── */

  async function addRoutineExercise(folderId: string, exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId);
    if (!ex) return;
    const items = routineMap[folderId] ?? [];
    const payload = {
      folder_id:         folderId,
      exercise_id:       exerciseId,
      exercise_name:     ex.name,
      order_index:       items.length,
      planned_sets:      3,
      planned_reps:      10,
      planned_weight_kg: null,
      rest_seconds:      60,
      set_type:          "normal" as SetType,
    };

    if (!isOnline || userId === "guest-user") {
      const fakeId = crypto.randomUUID();
      const fakeItem: RoutineExercise = {
        ...payload,
        id:         fakeId,
        created_at: new Date().toISOString(),
      };
      await enqueue({ type: "upsert", table: "routine_exercises", payload: { ...payload, id: fakeId }, conflictOn: "id" });
      const newMap = { ...routineMap, [folderId]: [...(routineMap[folderId] ?? []), fakeItem] };
      setRoutineMap(newMap);
      onRoutineMapChanged?.(newMap);
      return;
    }

    try {
      const { data, error } = await supabase.from("routine_exercises").insert(payload).select().single();
      if (error) throw error;
      if (data) {
        const newMap = { ...routineMap, [folderId]: [...(routineMap[folderId] ?? []), data as RoutineExercise] };
        setRoutineMap(newMap);
        onRoutineMapChanged?.(newMap);
      }
    } catch {
      const fakeId = crypto.randomUUID();
      const fakeItem: RoutineExercise = { ...payload, id: fakeId, created_at: new Date().toISOString() };
      await enqueue({ type: "upsert", table: "routine_exercises", payload: { ...payload, id: fakeId }, conflictOn: "id" });
      const newMap = { ...routineMap, [folderId]: [...(routineMap[folderId] ?? []), fakeItem] };
      setRoutineMap(newMap);
      onRoutineMapChanged?.(newMap);
      triggerSync();
    }
  }

  async function updateRoutineExercise(item: RoutineExercise) {
    const updatePayload = {
      planned_sets:      item.planned_sets,
      planned_reps:      item.planned_reps,
      planned_weight_kg: item.planned_weight_kg,
      rest_seconds:      item.rest_seconds,
      set_type:          item.set_type,
    };
    if (!isOnline || userId === "guest-user") {
      await enqueue({ type: "upsert", table: "routine_exercises", payload: { id: item.id, ...updatePayload }, conflictOn: "id" });
    } else {
      try {
        const { error } = await supabase.from("routine_exercises").update(updatePayload).eq("id", item.id);
        if (error) throw error;
      } catch {
        await enqueue({ type: "upsert", table: "routine_exercises", payload: { id: item.id, ...updatePayload }, conflictOn: "id" });
        triggerSync();
      }
    }
    const newMap = {
      ...routineMap,
      [item.folder_id]: (routineMap[item.folder_id] ?? []).map(i => i.id === item.id ? item : i),
    };
    setRoutineMap(newMap);
    onRoutineMapChanged?.(newMap);
  }

  async function deleteRoutineExercise(item: RoutineExercise) {
    if (!isOnline || userId === "guest-user") {
      await enqueue({ type: "delete", table: "routine_exercises", column: "id", value: item.id });
    } else {
      try {
        const { error } = await supabase.from("routine_exercises").delete().eq("id", item.id);
        if (error) throw error;
      } catch {
        await enqueue({ type: "delete", table: "routine_exercises", column: "id", value: item.id });
        triggerSync();
      }
    }
    const newMap = {
      ...routineMap,
      [item.folder_id]: (routineMap[item.folder_id] ?? []).filter(i => i.id !== item.id),
    };
    setRoutineMap(newMap);
    onRoutineMapChanged?.(newMap);
  }

  async function moveRoutineExercise(folderId: string, idx: number, dir: -1 | 1) {
    const items = [...(routineMap[folderId] ?? [])];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    const updated = items.map((item, i) => ({ ...item, order_index: i }));
    const newMap = { ...routineMap, [folderId]: updated };
    setRoutineMap(newMap);
    onRoutineMapChanged?.(newMap);

    if (!isOnline || userId === "guest-user") {
      await Promise.all(
        updated.map(item =>
          enqueue({ type: "upsert", table: "routine_exercises", payload: { id: item.id, order_index: item.order_index }, conflictOn: "id" })
        )
      );
    } else {
      try {
        const results = await Promise.all(
          updated.map(item =>
            supabase.from("routine_exercises").update({ order_index: item.order_index }).eq("id", item.id)
          )
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const failed = results.find((r: any) => r?.error);
        if (failed) throw failed.error;
      } catch {
        await Promise.all(
          updated.map(item =>
            enqueue({ type: "upsert", table: "routine_exercises", payload: { id: item.id, order_index: item.order_index }, conflictOn: "id" })
          )
        );
        triggerSync();
      }
    }
  }

  return (
    <div className="space-y-3">
      {folders.length === 0 && !showNewFolder && (
        <div className="card-glass p-4 text-center py-10">
          <p className="text-sm text-[var(--faint)] mb-1">{t.routineManager.noRoutinesYet}</p>
          <p className="text-[11px] text-[var(--dim)]">{t.routineManager.createFolderHint}</p>
        </div>
      )}

      {folders.map((folder, fi) => {
        const items      = routineMap[folder.id] ?? [];
        const isExpanded = expandedId === folder.id;

        return (
          <div key={folder.id} className="card-glass p-4 animate-spring-up" style={{ animationDelay: `${fi * 50}ms` }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-[var(--text)]">{folder.name}</p>
                <p className="text-[11px] text-[var(--faint)] mt-0.5">
                  {t.routineManager.exercises(items.length)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onStartWorkout(folder, items)}
                  disabled={items.length === 0}
                  className="btn-aqua !rounded-full text-xs px-4 py-1.5 disabled:opacity-40"
                >
                  {t.routineManager.start}
                </button>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : folder.id)}
                  className="btn-ghost !rounded-full text-xs px-3 py-1.5"
                >
                  {isExpanded ? t.routineManager.done : t.routineManager.edit}
                </button>
              </div>
            </div>

            {isExpanded && (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                {items.length === 0 && (
                  <p className="text-[11px] text-[var(--faint)] text-center py-3">
                    {t.routineManager.noExercisesYet}
                  </p>
                )}

                {items.map((item, idx) => (
                  <RoutineExerciseRow
                    key={item.id}
                    item={item}
                    unit={unit}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < items.length - 1}
                    onUpdate={updateRoutineExercise}
                    onDelete={deleteRoutineExercise}
                    onMove={dir => moveRoutineExercise(folder.id, idx, dir)}
                  />
                ))}

                <div className="pt-1">
                  <AddExerciseRow
                    exercises={exercises}
                    onAdd={exId => addRoutineExercise(folder.id, exId)}
                  />
                </div>

                <div className="mt-5 border-t border-[var(--border)] pt-3">
                  {confirmDeleteId === folder.id ? (
                    <div className="flex items-center justify-center gap-5">
                      <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] text-[var(--muted)]">
                        {t.routineManager.cancel}
                      </button>
                      <button
                        onClick={() => { deleteFolder(folder.id); setConfirmDeleteId(null); }}
                        className="text-[11px] text-red-400 font-medium"
                      >
                        {t.routineManager.deleteFolder}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(folder.id)}
                      className="w-full text-[11px] text-[var(--dim)] hover:text-red-400 transition-colors text-center"
                    >
                      {t.routineManager.deleteFolder}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {showNewFolder ? (
        <div className="card-glass p-4 space-y-3 animate-spring-up">
          <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest">{t.routineManager.newRoutineFolder}</p>
          <input
            autoFocus
            value={newFolderName}
            onChange={e => { setNewFolderName(e.target.value); setFolderError(null); }}
            onKeyDown={e => {
              if (e.key === "Enter") createFolder();
              if (e.key === "Escape") setShowNewFolder(false);
            }}
            placeholder={t.routineManager.folderPlaceholder}
            className="input-base"
          />
          {folderError && (
            <p className="text-[11px] text-red-400">{friendlyError(folderError)}</p>
          )}
          <div className="flex gap-2">
            <button onClick={createFolder} disabled={saving || !newFolderName.trim()} className="btn-primary !rounded-full flex-1">
              {saving ? t.routineManager.creating : t.routineManager.create}
            </button>
            <button onClick={() => { setShowNewFolder(false); setFolderError(null); }} className="btn-ghost !rounded-full">
              {t.routineManager.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewFolder(true)}
          className="w-full py-3 rounded-full border border-dashed border-[var(--border)] text-sm text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--muted)] transition-colors"
        >
          {t.routineManager.newRoutineFolderBtn}
        </button>
      )}
    </div>
  );
}
