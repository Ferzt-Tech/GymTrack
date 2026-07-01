"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { supabase, uploadFile, getStorageUrl } from "@/lib/supabase";
import { enqueue } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import type { Exercise } from "@/types";
import { useT } from "@/lib/context/LanguageContext";

const MUSCLE_GROUPS = [
  "Chest", "Back", "Shoulders", "Biceps", "Triceps",
  "Legs", "Glutes", "Core", "Cardio", "Full Body",
];

interface Props {
  onSaved:  (ex: Exercise) => void;
  onCancel: () => void;
}

export default function ExerciseForm({ onSaved, onCancel }: Props) {
  const t = useT();
  const [name,        setName]        = useState("");
  const [muscleGroup, setMuscleGroup] = useState("");
  const [notes,       setNotes]       = useState("");
  const [preview,     setPreview]     = useState<string | null>(null);
  const [file,        setFile]        = useState<File | null>(null);
  const [saving,      setSaving]      = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);

    const userId = await resolveUserId();
    if (!userId) { setSaving(false); return; }

    // Offline: skip photo upload, create optimistic exercise, queue sync
    if (!navigator.onLine) {
      const fakeId = crypto.randomUUID();
      await enqueue({
        type: "upsert",
        table: "exercises",
        payload: {
          id: fakeId, user_id: userId,
          name: name.trim(), muscle_group: muscleGroup || null,
          machine_photo_path: null, notes: notes.trim() || null,
        },
        conflictOn: "id",
      });
      onSaved({
        id: fakeId, user_id: userId,
        name: name.trim(), muscle_group: muscleGroup || null,
        machine_photo_path: null, machinePhotoUrl: undefined,
        notes: notes.trim() || null, created_at: new Date().toISOString(),
      });
      setSaving(false);
      return;
    }

    let machinePath: string | null = null;
    try {
      if (file) machinePath = await uploadFile("exercise-photos", userId, file);
      const { data, error } = await supabase
        .from("exercises")
        .insert({
          user_id:            userId,
          name:               name.trim(),
          muscle_group:       muscleGroup || null,
          machine_photo_path: machinePath,
          notes:              notes.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        onSaved({
          ...data,
          machinePhotoUrl: machinePath ? getStorageUrl("exercise-photos", machinePath) : undefined,
        });
      }
    } catch {
      const fakeId = crypto.randomUUID();
      await enqueue({
        type: "upsert",
        table: "exercises",
        payload: {
          id: fakeId, user_id: userId,
          name: name.trim(), muscle_group: muscleGroup || null,
          machine_photo_path: null, notes: notes.trim() || null,
        },
        conflictOn: "id",
      });
      onSaved({
        id: fakeId, user_id: userId,
        name: name.trim(), muscle_group: muscleGroup || null,
        machine_photo_path: null, machinePhotoUrl: undefined,
        notes: notes.trim() || null, created_at: new Date().toISOString(),
      });
    }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSave} className="card-glass p-4 space-y-3 animate-slide-up">
      <div className="flex items-center justify-between mb-1">
        <p className="section-label mb-0">{t.exerciseForm.newExercise}</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-[var(--faint)] hover:text-[var(--muted)] text-sm transition-colors"
        >
          {t.exerciseForm.cancel}
        </button>
      </div>

      <input
        type="text"
        placeholder={t.exerciseForm.exerciseName}
        value={name}
        onChange={e => setName(e.target.value)}
        required
        className="input-base"
      />

      <select
        value={muscleGroup}
        onChange={e => setMuscleGroup(e.target.value)}
        className="input-base text-[var(--muted)]"
      >
        <option value="">{t.exerciseForm.muscleGroup}</option>
        {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{t.muscleGroups[g] ?? g}</option>)}
      </select>

      <textarea
        placeholder={t.exerciseForm.notesOptional}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
        className="input-base resize-none"
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="btn-outline w-full border-dashed"
      >
        {preview ? t.exerciseForm.changeMachinePhoto : t.exerciseForm.addMachinePhoto}
      </button>
      <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} className="hidden" />

      {preview && (
        <div className="relative h-36 rounded-xl overflow-hidden ring-1 ring-[var(--border)]">
          <Image src={preview} alt={t.exerciseForm.machinePreview} fill className="object-cover" sizes="400px" />
        </div>
      )}

      <button type="submit" disabled={saving || !name.trim()} className="btn-aqua w-full">
        {saving ? t.exerciseForm.saving : t.exerciseForm.saveExercise}
      </button>
    </form>
  );
}
