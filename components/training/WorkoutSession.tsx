"use client";

import { useState } from "react";
import Image from "next/image";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { enqueue } from "@/lib/offlineQueue";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import type { Exercise, WorkoutSession, WorkoutSet, WeightUnit, SetType, Drop } from "@/types";
import { useT } from "@/lib/context/LanguageContext";

/* ── Types ── */

interface DropRow { weight: string; reps: string; }

interface SetRow {
  set_type: SetType;
  reps: string; weight: string; rpe: string;
  drops: DropRow[];
}
type EditRow = SetRow & { id: string };

interface Draft {
  exercise_name: string;
  exercise_id:   string | null;
  sets:          SetRow[];
  unit:          WeightUnit;
}

/* ── Helpers ── */

function blank(): SetRow {
  return { set_type: "normal", reps: "", weight: "", rpe: "", drops: [{ weight: "", reps: "" }] };
}

function dropsToPayload(drops: DropRow[]): Drop[] {
  return drops
    .map(d => ({ weight: d.weight ? parseFloat(d.weight) : null, reps: d.reps ? parseInt(d.reps) : null }))
    .filter(d => d.weight != null || d.reps != null);
}

function getSetWeightAndUnit(s: WorkoutSet, defaultUnit: WeightUnit): { weight: number | null; unit: WeightUnit } {
  if (s.weight_unit) {
    return { weight: s.weight, unit: s.weight_unit };
  }
  // Legacy set: weight is stored in kg. Convert to defaultUnit if defaultUnit is 'lbs'.
  const unit = defaultUnit;
  const weight = unit === "lbs" && s.weight != null
    ? Math.round(s.weight * 2.20462 * 100) / 100
    : s.weight;
  return { weight, unit };
}

function getSetDrops(s: WorkoutSet, defaultUnit: WeightUnit): DropRow[] {
  const setUnit = s.weight_unit ?? defaultUnit;
  const needConversion = !s.weight_unit && defaultUnit === "lbs";

  if (s.drops && s.drops.length > 0) {
    return s.drops.map(d => {
      const w = needConversion && d.weight != null ? (d.weight * 2.20462) : d.weight;
      return {
        weight: w != null ? (+(w).toFixed(1)).toString() : "",
        reps: d.reps != null ? String(d.reps) : ""
      };
    });
  }

  const legacy: DropRow[] = [];
  if (s.weight_2 != null || s.reps_2 != null) {
    const w = needConversion && s.weight_2 != null ? (s.weight_2 * 2.20462) : s.weight_2;
    legacy.push({ weight: w != null ? (+(w).toFixed(1)).toString() : "", reps: s.reps_2 != null ? String(s.reps_2) : "" });
  }
  if (s.weight_3 != null || s.reps_3 != null) {
    const w = needConversion && s.weight_3 != null ? (s.weight_3 * 2.20462) : s.weight_3;
    legacy.push({ weight: w != null ? (+(w).toFixed(1)).toString() : "", reps: s.reps_3 != null ? String(s.reps_3) : "" });
  }
  return legacy.length > 0 ? legacy : [{ weight: "", reps: "" }];
}

const CYCLE: SetType[] = ["normal", "warmup", "dropset"];
const nextType = (t: SetType): SetType => CYCLE[(CYCLE.indexOf(t) + 1) % CYCLE.length];

function toKg(val: string, unit: WeightUnit): number | null {
  if (!val) return null;
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  return Math.round((unit === "lbs" ? n / 2.20462 : n) * 100) / 100;
}

function fromKg(kg: number | null, unit: WeightUnit): string {
  if (kg == null) return "";
  return unit === "lbs" ? (+(kg * 2.20462).toFixed(1)).toString() : String(kg);
}

function setLabel(type: SetType, num: number): string {
  return type === "warmup" ? "W" : type === "dropset" ? "D" : String(num);
}

function typeCls(type: SetType): string {
  return cn(
    type === "warmup"  && "text-amber-400 font-medium",
    type === "dropset" && "text-blue-400 font-medium",
    type === "normal"  && "text-[var(--muted)]",
  );
}

function toSetPayload(s: WorkoutSet, sessionId: string): Record<string, unknown> {
  let drops = s.drops;
  if (!drops || drops.length === 0) {
    const legacy = [
      ...(s.weight_2 != null || s.reps_2 != null ? [{ weight: s.weight_2, reps: s.reps_2 }] : []),
      ...(s.weight_3 != null || s.reps_3 != null ? [{ weight: s.weight_3, reps: s.reps_3 }] : []),
    ];
    drops = legacy.length > 0 ? legacy : null;
  }
  return {
    session_id:    sessionId,
    exercise_id:   s.exercise_id,
    exercise_name: s.exercise_name,
    set_number:    s.set_number,
    set_type:      s.set_type ?? "normal",
    reps:          s.reps,
    weight:        s.weight,
    weight_unit:   s.weight_unit ?? null,
    rpe:           s.rpe ?? null,
    notes:         s.notes ?? null,
    drops:         drops && drops.length > 0 ? drops : null,
  };
}

function exercisePhoto(ex: Exercise | undefined): string | null {
  return ex?.machinePhotoUrl || ex?.machine_photo_path || null;
}

function friendlyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network"))
    return "Could not save — check your connection.";
  if (m.includes("schema cache") || m.includes("column"))
    return "Database error — try refreshing the app.";
  if (m.includes("policy") || m.includes("rls") || m.includes("row-level"))
    return "Not authorised. Try signing out and back in.";
  return "Could not save. Please try again.";
}

/* ── Component ── */

interface Props {
  session:   WorkoutSession;
  exercises: Exercise[];
  unit:      WeightUnit;
  userId:    string;
  onUpdated: (s: WorkoutSession) => void;
  onDeleted: (id: string) => void;
}

export default function WorkoutSessionCard({ session, exercises, unit, userId, onUpdated, onDeleted }: Props) {
  const t = useT();
  const { isOnline, triggerSync } = useOnlineSync();
  const [open,          setOpen]          = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState<string | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [drafts,        setDrafts]        = useState<Draft[]>([]);
  const [editEx,           setEditEx]           = useState<string | null>(null);
  const [editRows,         setEditRows]         = useState<EditRow[]>([]);
  const [editUnit,         setEditUnit]         = useState<WeightUnit>(unit);
  const [updating,         setUpdating]         = useState(false);
  const [confirmDeleteEx,  setConfirmDeleteEx]  = useState<string | null>(null);
  const [photoView,        setPhotoView]        = useState<{ url: string; name: string } | null>(null);

  function findExercise(id: string | null | undefined, name: string): Exercise | undefined {
    return exercises.find(e => e.id === id) ?? exercises.find(e => e.name === name);
  }

  /* Delete session */
  async function deleteSession() {
    setDeleting(true);
    if (!isOnline) {
      await enqueue({ type: "delete", table: "workout_sessions", column: "id", value: session.id });
      onDeleted(session.id);
      return;
    }
    try {
      const { error } = await supabase.from("workout_sessions").delete().eq("id", session.id);
      if (error) throw error;
    } catch {
      await enqueue({ type: "delete", table: "workout_sessions", column: "id", value: session.id });
      triggerSync();
    }
    onDeleted(session.id);
  }

  /* Delete a single exercise from the session */
  async function deleteExerciseFromSession(exerciseName: string) {
    const remaining = (session.sets ?? []).filter(s => s.exercise_name !== exerciseName);
    const toDelete  = (session.sets ?? []).filter(s => s.exercise_name === exerciseName);
    if (!isOnline) {
      await enqueue({
        type:           "save_workout",
        sessionId:      session.id,
        sessionPayload: { id: session.id, user_id: userId || session.user_id, session_date: session.session_date },
        sets:           remaining.map(s => toSetPayload(s, session.id)),
      });
      onUpdated({ ...session, sets: remaining });
      setConfirmDeleteEx(null);
      return;
    }
    const ids = toDelete.map(s => s.id);
    if (ids.length) {
      try {
        const { error: delErr } = await supabase.from("workout_sets").delete().in("id", ids);
        if (delErr) throw delErr;
      } catch {
        await enqueue({
          type:           "save_workout",
          sessionId:      session.id,
          sessionPayload: { id: session.id, user_id: userId || session.user_id, session_date: session.session_date },
          sets:           remaining.map(s => toSetPayload(s, session.id)),
        });
        triggerSync();
      }
    }
    onUpdated({ ...session, sets: remaining });
    setConfirmDeleteEx(null);
  }

  /* Draft helpers */
  function addDraft() {
    setDrafts(p => [...p, { exercise_name: "", exercise_id: null, sets: [blank()], unit }]);
  }
  function removeDraft(i: number) { setDrafts(p => p.filter((_, idx) => idx !== i)); }
  function toggleDraftUnit(i: number) {
    setDrafts(p => p.map((d, idx) => idx === i ? { ...d, unit: d.unit === "kg" ? "lbs" : "kg" } : d));
  }
  function pickExercise(i: number, id: string) {
    const ex = exercises.find(e => e.id === id);
    setDrafts(p => p.map((d, idx) =>
      idx === i ? { ...d, exercise_id: ex?.id ?? null, exercise_name: ex?.name ?? "" } : d
    ));
  }
  function typeName(i: number, v: string) {
    setDrafts(p => p.map((d, idx) => idx === i ? { ...d, exercise_name: v, exercise_id: null } : d));
  }
  function addSet(i: number) {
    setDrafts(p => p.map((d, idx) => idx === i ? { ...d, sets: [...d.sets, blank()] } : d));
  }
  function removeSet(ei: number, si: number) {
    setDrafts(p => p.map((d, idx) =>
      idx === ei ? { ...d, sets: d.sets.filter((_, s) => s !== si) } : d
    ));
  }
  function updateSet(ei: number, si: number, field: keyof SetRow, v: string) {
    setDrafts(p => p.map((d, idx) =>
      idx === ei ? { ...d, sets: d.sets.map((s, j) => j === si ? { ...s, [field]: v } : s) } : d
    ));
  }
  function cycleSetType(ei: number, si: number) {
    setDrafts(p => p.map((d, idx) =>
      idx !== ei ? d : {
        ...d,
        sets: d.sets.map((s, j) => j !== si ? s : { ...s, set_type: nextType(s.set_type) }),
      }
    ));
  }
  function addDraftDrop(ei: number, si: number) {
    setDrafts(p => p.map((d, idx) =>
      idx !== ei ? d : {
        ...d,
        sets: d.sets.map((s, j) => j !== si ? s : { ...s, drops: [...s.drops, { weight: "", reps: "" }] }),
      }
    ));
  }
  function removeDraftDrop(ei: number, si: number, di: number) {
    setDrafts(p => p.map((d, idx) =>
      idx !== ei ? d : {
        ...d,
        sets: d.sets.map((s, j) => j !== si ? s : { ...s, drops: s.drops.filter((_, k) => k !== di) }),
      }
    ));
  }
  function updateDraftDrop(ei: number, si: number, di: number, field: keyof DropRow, val: string) {
    setDrafts(p => p.map((d, idx) =>
      idx !== ei ? d : {
        ...d,
        sets: d.sets.map((s, j) => j !== si ? s : {
          ...s,
          drops: s.drops.map((dr, k) => k !== di ? dr : { ...dr, [field]: val }),
        }),
      }
    ));
  }
  function addEditDrop(i: number) {
    setEditRows(p => p.map((r, idx) => idx !== i ? r : { ...r, drops: [...r.drops, { weight: "", reps: "" }] }));
  }
  function removeEditDrop(i: number, di: number) {
    setEditRows(p => p.map((r, idx) => idx !== i ? r : { ...r, drops: r.drops.filter((_, k) => k !== di) }));
  }
  function updateEditDrop(i: number, di: number, field: keyof DropRow, val: string) {
    setEditRows(p => p.map((r, idx) => idx !== i ? r : {
      ...r,
      drops: r.drops.map((dr, k) => k !== di ? dr : { ...dr, [field]: val }),
    }));
  }

  async function save() {
    if (!drafts.length) return;
    setSaveError(null);
    setSaving(true);
    const newRows: Record<string, unknown>[] = [];
    for (const d of drafts) {
      if (!d.exercise_name.trim()) continue;
      d.sets.forEach((s, si) => {
        const dropsPayload = s.set_type === "dropset" ? dropsToPayload(s.drops) : null;
        newRows.push({
          session_id:    session.id,
          exercise_id:   d.exercise_id,
          exercise_name: d.exercise_name.trim(),
          set_number:    si + 1,
          set_type:      s.set_type,
          reps:          s.reps ? parseInt(s.reps) : null,
          weight:        s.weight ? parseFloat(s.weight) : null,
          weight_unit:   d.unit,
          drops:         dropsPayload && dropsPayload.length > 0 ? dropsPayload : null,
        });
      });
    }
    if (!newRows.length) {
      setSaveError("Select an exercise and fill in the name first.");
      setSaving(false);
      return;
    }

    if (!isOnline) {
      /* Enqueue full session state: existing sets + new rows */
      const existingPayload = (session.sets ?? []).map(s => toSetPayload(s, session.id));
      await enqueue({
        type:           "save_workout",
        sessionId:      session.id,
        sessionPayload: { id: session.id, user_id: userId || session.user_id, session_date: session.session_date },
        sets:           [...existingPayload, ...newRows],
      });
      const fakeSets: WorkoutSet[] = newRows.map(r => ({
        ...(r as any),
        id:         crypto.randomUUID(),
        rpe:        null,
        notes:      null,
        created_at: new Date().toISOString(),
      }));
      onUpdated({ ...session, sets: [...(session.sets ?? []), ...fakeSets] });
      setDrafts([]);
      setSaving(false);
      return;
    }

    try {
      const { data, error } = await supabase.from("workout_sets").insert(newRows).select();
      if (error) throw error;
      if (data && data.length > 0) {
        onUpdated({ ...session, sets: [...(session.sets ?? []), ...(data as WorkoutSet[])] });
        setDrafts([]);
      } else {
        const { data: freshSets } = await supabase
          .from("workout_sets")
          .select("*")
          .eq("session_id", session.id);
        if (freshSets) {
          onUpdated({ ...session, sets: freshSets as WorkoutSet[] });
          setDrafts([]);
        }
      }
    } catch {
      const existingPayload = (session.sets ?? []).map(s => toSetPayload(s, session.id));
      await enqueue({
        type:           "save_workout",
        sessionId:      session.id,
        sessionPayload: { id: session.id, user_id: userId || session.user_id, session_date: session.session_date },
        sets:           [...existingPayload, ...newRows],
      });
      triggerSync();
      const fakeSets: WorkoutSet[] = newRows.map(r => ({
        ...(r as any),
        id:         crypto.randomUUID(),
        rpe:        null,
        notes:      null,
        created_at: new Date().toISOString(),
      }));
      onUpdated({ ...session, sets: [...(session.sets ?? []), ...fakeSets] });
      setDrafts([]);
    }
    setSaving(false);
  }

  /* Edit helpers */
  function startEdit(name: string, sets: WorkoutSet[]) {
    setEditEx(name);
    const initialEditUnit = sets[0]?.weight_unit ?? unit;
    setEditUnit(initialEditUnit);
    setEditRows(sets.map(s => {
      const resolved = getSetWeightAndUnit(s, unit);
      return {
        id:       s.id,
        set_type: s.set_type ?? "normal",
        reps:     s.reps != null ? String(s.reps) : "",
        weight:   resolved.weight != null ? String(resolved.weight) : "",
        rpe:      s.rpe  != null ? String(s.rpe)  : "",
        drops:    getSetDrops(s, resolved.unit),
      };
    }));
  }
  function updateEditRow(i: number, field: keyof SetRow, v: string) {
    setEditRows(p => p.map((r, idx) => idx === i ? { ...r, [field]: v } : r));
  }
  function cycleEditType(i: number) {
    setEditRows(p => p.map((r, idx) => idx === i ? { ...r, set_type: nextType(r.set_type) } : r));
  }
  function addEditRow() { setEditRows(p => [...p, { ...blank(), id: "" }]); }
  function removeEditRow(i: number) {
    if (editRows.length <= 1) return;
    setEditRows(p => p.filter((_, idx) => idx !== i));
  }

  async function saveEdit(exerciseName: string) {
    setUpdating(true);
    const exerciseId = session.sets?.find(s => s.exercise_name === exerciseName)?.exercise_id ?? null;
    const newRows = editRows.map((r, si) => {
      const dropsPayload = r.set_type === "dropset" ? dropsToPayload(r.drops) : null;
      return {
        session_id:    session.id,
        exercise_id:   exerciseId,
        exercise_name: exerciseName,
        set_number:    si + 1,
        set_type:      r.set_type,
        reps:          r.reps ? parseInt(r.reps) : null,
        weight:        r.weight ? parseFloat(r.weight) : null,
        weight_unit:   editUnit,
        drops:         dropsPayload && dropsPayload.length > 0 ? dropsPayload : null,
      };
    });

    if (!isOnline) {
      /* Enqueue full session state: other-exercise sets + edited sets */
      const otherSets = (session.sets ?? []).filter(s => s.exercise_name !== exerciseName);
      const allPayload = [
        ...otherSets.map(s => toSetPayload(s, session.id)),
        ...newRows,
      ];
      await enqueue({
        type:           "save_workout",
        sessionId:      session.id,
        sessionPayload: { id: session.id, user_id: userId || session.user_id, session_date: session.session_date },
        sets:           allPayload,
      });
      const fakeSets: WorkoutSet[] = newRows.map(r => ({
        ...(r as any),
        id:         crypto.randomUUID(),
        rpe:        null,
        notes:      null,
        created_at: new Date().toISOString(),
      }));
      onUpdated({ ...session, sets: [...otherSets, ...fakeSets] });
      setEditEx(null);
      setUpdating(false);
      return;
    }

    const otherSets = (session.sets ?? []).filter(s => s.exercise_name !== exerciseName);
    try {
      const existingIds = editRows.map(r => r.id).filter(Boolean);
      if (existingIds.length) {
        const { error: delErr } = await supabase.from("workout_sets").delete().in("id", existingIds);
        if (delErr) throw delErr;
      }
      const { data, error } = await supabase.from("workout_sets").insert(newRows).select();
      if (error) throw error;
      if (data && data.length > 0) {
        onUpdated({ ...session, sets: [...otherSets, ...(data as WorkoutSet[])] });
      } else {
        const { data: freshSets } = await supabase
          .from("workout_sets")
          .select("*")
          .eq("session_id", session.id);
        if (freshSets) onUpdated({ ...session, sets: freshSets as WorkoutSet[] });
      }
    } catch {
      // Network/auth error — queue the full rewrite so no data is lost
      await enqueue({
        type:           "save_workout",
        sessionId:      session.id,
        sessionPayload: { id: session.id, user_id: userId || session.user_id, session_date: session.session_date },
        sets:           [...otherSets.map(s => toSetPayload(s, session.id)), ...newRows],
      });
      triggerSync();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeSets: WorkoutSet[] = newRows.map(r => ({
        ...(r as any),
        id:         crypto.randomUUID(),
        rpe:        null,
        notes:      null,
        created_at: new Date().toISOString(),
      }));
      onUpdated({ ...session, sets: [...otherSets, ...fakeSets] });
    } finally {
      setEditEx(null);
      setUpdating(false);
    }
  }

  function displayWeight(val: number | null, setUnit?: WeightUnit | null): string {
    if (val == null) return "—";
    const u = setUnit ?? "kg";
    return `${val} ${u}`;
  }

  /* Data */
  const saved = session.sets ?? [];
  const savedGroups = saved.reduce<Record<string, WorkoutSet[]>>((acc, s) => {
    acc[s.exercise_name] = [...(acc[s.exercise_name] ?? []), s];
    return acc;
  }, {});
  const dateLabel = format(new Date(session.session_date + "T12:00:00"), "EEE, MMM d");

  return (
    <div className="card-glass p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          <span className="text-sm font-medium text-[var(--text)]">{dateLabel}</span>
          <span className="text-[var(--faint)] text-xs ml-auto">{open ? "▲" : "▼"}</span>
        </button>

        {confirmDelete ? (
          <div className="flex items-center gap-3 shrink-0">
            <button type="button" onClick={() => setConfirmDelete(false)}
              className="text-xs text-[var(--muted)]">{t.workoutSession.cancel}</button>
            <button type="button" onClick={deleteSession} disabled={deleting}
              className="text-xs text-red-400 font-medium">
              {deleting ? t.workoutSession.deleting : t.workoutSession.delete}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete session"
            className="text-[var(--dim)] hover:text-red-400 transition-colors text-lg leading-none shrink-0 px-1"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3 animate-slide-up">

          {/* Saved exercise groups */}
          {Object.entries(savedGroups).map(([name, sets]) => {
            const groupPhoto = exercisePhoto(findExercise(sets[0]?.exercise_id, name));
            return (
            <div key={name} className="bg-[var(--accent-faint)] rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {groupPhoto && (
                    <button
                      type="button"
                      onClick={() => setPhotoView({ url: groupPhoto, name })}
                      aria-label={`View ${name} machine photo`}
                      className="relative h-7 w-7 rounded-md overflow-hidden ring-1 ring-[var(--border)] shrink-0"
                    >
                      <Image src={groupPhoto} alt={name} fill className="object-cover" sizes="28px" />
                    </button>
                  )}
                  <p className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider truncate">{name}</p>
                </div>

                {editEx === name ? (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditUnit(u => u === "kg" ? "lbs" : "kg")}
                      className="text-[9px] text-[var(--faint)] hover:text-[var(--text)] border border-[var(--border)] rounded px-1 py-0.5 leading-none transition-colors"
                    >
                      {editUnit}
                    </button>
                    <button type="button" onClick={() => setEditEx(null)}
                      className="text-[10px] text-[var(--faint)] hover:text-[var(--muted)] transition-colors">
                      {t.workoutSession.cancel}
                    </button>
                    <button type="button" onClick={() => saveEdit(name)} disabled={updating}
                      className="text-[10px] text-[var(--text)] font-medium">
                      {updating ? t.workoutSession.updating : t.workoutSession.update}
                    </button>
                  </div>
                ) : confirmDeleteEx === name ? (
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setConfirmDeleteEx(null)}
                      className="text-[10px] text-[var(--muted)]">{t.workoutSession.cancel}</button>
                    <button type="button" onClick={() => deleteExerciseFromSession(name)}
                      className="text-[10px] text-red-400 font-medium">Delete</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => startEdit(name, sets)}
                      className="text-[10px] text-[var(--faint)] hover:text-[var(--muted)] transition-colors">
                      {t.workoutSession.edit}
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteEx(name)}
                      className="text-[var(--dim)] hover:text-red-400 transition-colors text-base leading-none px-0.5">
                      ×
                    </button>
                  </div>
                )}
              </div>

              {editEx === name ? (
                /* Edit mode */
                <div className="space-y-2">
                  <div className="grid grid-cols-3 text-[10px] text-[var(--dim)] px-0.5 gap-2">
                    <span>{t.workoutSession.set}</span><span>{t.workoutSession.weight}</span><span>{t.workoutSession.reps}</span>
                  </div>
                  {editRows.map((r, i) => (
                    <div key={i} className="space-y-1">
                      <div className="grid grid-cols-3 gap-2 items-center">
                        <button type="button" onClick={() => cycleEditType(i)}
                          className={cn("metric text-sm font-medium text-center", typeCls(r.set_type))}>
                          {setLabel(r.set_type, i + 1)}
                        </button>
                        <input type="number" step="0.5" placeholder="60" value={r.weight}
                          onChange={e => updateEditRow(i, "weight", e.target.value)}
                          className="input-base py-2 text-center" />
                        <div className="flex gap-1 items-center">
                          <input type="number" placeholder="12" value={r.reps}
                            onChange={e => updateEditRow(i, "reps", e.target.value)}
                            className="input-base py-2 text-center" />
                          <button type="button" onClick={() => removeEditRow(i)}
                            className="text-[var(--dim)] hover:text-[var(--muted)] text-base leading-none shrink-0">
                            ×
                          </button>
                        </div>
                      </div>
                      {r.set_type === "dropset" && (
                        <>
                          {r.drops.map((dr, di) => (
                            <div key={di} className="grid grid-cols-3 gap-2 items-center pl-2">
                              <button type="button" onClick={() => removeEditDrop(i, di)}
                                className="text-[10px] text-[var(--faint)] hover:text-[var(--muted)] transition-colors text-center">
                                →{r.drops.length > 1 ? " ×" : ""}
                              </button>
                              <input type="number" step="0.5" placeholder="wt" value={dr.weight}
                                onChange={e => updateEditDrop(i, di, "weight", e.target.value)}
                                className="input-base py-1.5 text-center text-sm" />
                              <input type="number" placeholder="reps" value={dr.reps}
                                onChange={e => updateEditDrop(i, di, "reps", e.target.value)}
                                className="input-base py-1.5 text-center text-sm" />
                            </div>
                          ))}
                          <button type="button" onClick={() => addEditDrop(i)}
                            className="text-[11px] text-blue-400/70 hover:text-blue-400 transition-colors pl-2">
                            + drop
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addEditRow}
                    className="text-[11px] text-[var(--faint)] hover:text-[var(--muted)] transition-colors pl-0.5">
                    {t.workoutSession.addSet}
                  </button>
                </div>
              ) : (
                /* Read-only mode */
                <div>
                  <div className="grid grid-cols-3 text-[10px] text-[var(--dim)] mb-1 px-0.5">
                    <span>{t.workoutSession.set}</span><span>{t.workoutSession.weight}</span><span>{t.workoutSession.reps}</span>
                  </div>
                  {sets.map(s => {
                    const resolved = getSetWeightAndUnit(s, unit);
                    return (
                      <div key={s.id}>
                        <div className="grid grid-cols-3 text-[13px] px-0.5 py-0.5">
                          <span className={cn("metric", typeCls(s.set_type ?? "normal"))}>
                            {setLabel(s.set_type ?? "normal", s.set_number)}
                          </span>
                          <span className="metric text-[var(--muted)]">{displayWeight(resolved.weight, resolved.unit)}</span>
                          <span className="metric text-[var(--muted)]">{s.reps ?? "—"}</span>
                        </div>
                        {s.set_type === "dropset" && (() => {
                          const effectiveDrops: { weight: number | null; reps: number | null }[] =
                            s.drops && s.drops.length > 0
                              ? s.drops.map(d => {
                                  const needConversion = !s.weight_unit && unit === "lbs";
                                  const w = needConversion && d.weight != null ? (d.weight * 2.20462) : d.weight;
                                  return { weight: w != null ? Math.round(w * 10) / 10 : null, reps: d.reps };
                                })
                              : [
                                  ...(s.weight_2 != null || s.reps_2 != null
                                    ? [{
                                        weight: !s.weight_unit && unit === "lbs" && s.weight_2 != null
                                          ? Math.round(s.weight_2 * 2.20462 * 10) / 10
                                          : s.weight_2,
                                        reps: s.reps_2
                                      }]
                                    : []),
                                  ...(s.weight_3 != null || s.reps_3 != null
                                    ? [{
                                        weight: !s.weight_unit && unit === "lbs" && s.weight_3 != null
                                          ? Math.round(s.weight_3 * 2.20462 * 10) / 10
                                          : s.weight_3,
                                        reps: s.reps_3
                                      }]
                                    : []),
                                ];
                          return effectiveDrops.length > 0 ? (
                            <div className="pl-4 pb-0.5 text-[11px] text-[var(--faint)] space-y-0.5 metric">
                              {effectiveDrops.map((d, di) => (
                                <div key={di}>→ {displayWeight(d.weight, resolved.unit)} · {d.reps ?? "—"}</div>
                              ))}
                            </div>
                          ) : null;
                        })()}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            );
          })}

          {/* Draft exercises */}
          {drafts.map((draft, ei) => (
            <div key={ei} className="bg-[var(--accent-faint)] rounded-xl p-3 space-y-2">
              <div className="flex gap-2">
                <select
                  value={draft.exercise_id ?? ""}
                  onChange={e => pickExercise(ei, e.target.value)}
                  className={cn("input-base flex-1", !draft.exercise_id && "text-[var(--faint)]")}
                >
                  <option value="">{t.workoutSession.selectExercise}</option>
                  {exercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                </select>
                <button type="button" onClick={() => removeDraft(ei)}
                  className="text-[var(--dim)] hover:text-[var(--muted)] text-lg leading-none px-1">
                  ×
                </button>
              </div>

              {!draft.exercise_id && (
                <input type="text" placeholder={t.workoutSession.orTypeName}
                  value={draft.exercise_name}
                  onChange={e => typeName(ei, e.target.value)}
                  className="input-base" />
              )}

              {(() => {
                const ex = exercises.find(e => e.id === draft.exercise_id);
                const url = exercisePhoto(ex);
                return url ? (
                  <button
                    type="button"
                    onClick={() => setPhotoView({ url, name: ex!.name })}
                    aria-label={`View ${ex!.name} machine photo`}
                    className="relative h-24 w-full rounded-lg overflow-hidden ring-1 ring-[var(--border)]"
                  >
                    <Image src={url} alt={ex!.name} fill className="object-cover" sizes="400px" />
                  </button>
                ) : null;
              })()}

              <div className="grid grid-cols-3 text-[10px] text-[var(--dim)] px-0.5 gap-2 mt-1">
                <span>{t.workoutSession.set}</span>
                <span className="flex items-center gap-1">
                  {t.workoutSession.weight}
                  <button type="button" onClick={() => toggleDraftUnit(ei)}
                    className="text-[9px] text-[var(--faint)] hover:text-[var(--text)] border border-[var(--border)] rounded px-1 py-0.5 leading-none transition-colors">
                    {draft.unit}
                  </button>
                </span>
                <span>{t.workoutSession.reps}</span>
              </div>

              {draft.sets.map((s, si) => (
                <div key={si} className="space-y-1">
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <button type="button" onClick={() => cycleSetType(ei, si)}
                      className={cn("metric text-sm font-medium text-center", typeCls(s.set_type))}>
                      {setLabel(s.set_type, si + 1)}
                    </button>
                    <input type="number" step="0.5" placeholder="60" value={s.weight}
                      onChange={e => updateSet(ei, si, "weight", e.target.value)}
                      className="input-base py-2 text-center" />
                    <div className="flex gap-1 items-center">
                      <input type="number" placeholder="12" value={s.reps}
                        onChange={e => updateSet(ei, si, "reps", e.target.value)}
                        className="input-base py-2 text-center" />
                      {draft.sets.length > 1 && (
                        <button type="button" onClick={() => removeSet(ei, si)}
                          className="text-[var(--dim)] hover:text-[var(--muted)] text-base leading-none shrink-0">
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  {s.set_type === "dropset" && (
                    <>
                      {s.drops.map((dr, di) => (
                        <div key={di} className="grid grid-cols-3 gap-2 items-center pl-2">
                          <button type="button" onClick={() => removeDraftDrop(ei, si, di)}
                            className="text-[10px] text-[var(--faint)] hover:text-[var(--muted)] transition-colors text-center">
                            →{s.drops.length > 1 ? " ×" : ""}
                          </button>
                          <input type="number" step="0.5" placeholder="wt" value={dr.weight}
                            onChange={e => updateDraftDrop(ei, si, di, "weight", e.target.value)}
                            className="input-base py-1.5 text-center text-sm" />
                          <input type="number" placeholder="reps" value={dr.reps}
                            onChange={e => updateDraftDrop(ei, si, di, "reps", e.target.value)}
                            className="input-base py-1.5 text-center text-sm" />
                        </div>
                      ))}
                      <button type="button" onClick={() => addDraftDrop(ei, si)}
                        className="text-[11px] text-blue-400/70 hover:text-blue-400 transition-colors pl-2">
                        + drop
                      </button>
                    </>
                  )}
                </div>
              ))}

              <button type="button" onClick={() => addSet(ei)}
                className="text-[11px] text-[var(--faint)] hover:text-[var(--muted)] transition-colors pl-0.5">
                {t.workoutSession.addSet}
              </button>
            </div>
          ))}

          {/* Actions */}
          {saveError && (
            <div className="flex items-center gap-2 px-0.5">
              <p className="text-[11px] text-red-400 flex-1">{friendlyError(saveError)}</p>
              <button type="button" onClick={save}
                className="text-[11px] text-[var(--accent)] font-medium shrink-0">
                Try again
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={addDraft} className="btn-outline flex-1 border-dashed">
              {t.workoutSession.addExercise}
            </button>
            {drafts.length > 0 && (
              <button type="button" onClick={save} disabled={saving} className="btn-aqua px-6">
                {saving ? t.workoutSession.saving : t.workoutSession.save}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Machine photo lightbox */}
      {photoView && (
        <div
          className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-6"
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
    </div>
  );
}
