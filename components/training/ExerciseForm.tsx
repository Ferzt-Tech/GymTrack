"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { supabase, compressImage, getStorageUrl } from "@/lib/supabase";
import { enqueue } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import type { Exercise } from "@/types";
import { useT } from "@/lib/context/LanguageContext";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";

const MUSCLE_GROUPS = [
  "Chest", "Back", "Shoulders", "Biceps", "Triceps",
  "Legs", "Glutes", "Core", "Cardio", "Full Body", "Other",
];

interface Props {
  /** When set, the form edits this exercise instead of creating a new one. */
  initial?: Exercise | null;
  onSaved:  (ex: Exercise) => void;
  onCancel: () => void;
}

export default function ExerciseForm({ initial = null, onSaved, onCancel }: Props) {
  const t = useT();
  const { triggerSync } = useOnlineSync();
  const [name,        setName]        = useState(initial?.name ?? "");
  const [muscleGroup, setMuscleGroup] = useState(initial?.muscle_group ?? "");
  const [notes,       setNotes]       = useState(initial?.notes ?? "");
  const [preview,     setPreview]     = useState<string | null>(
    initial?.machinePhotoUrl || initial?.machine_photo_path || null
  );
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

    try {
      // Keep the existing photo when editing unless a new file was chosen
      let machinePath: string | null = initial?.machine_photo_path ?? null;
      if (file) {
        machinePath = await compressImage(file, 400, 400, 0.7);
      }

      const exerciseData = {
        id:                 initial?.id ?? crypto.randomUUID(),
        user_id:            initial?.user_id ?? userId,
        name:               name.trim(),
        muscle_group:       muscleGroup || null,
        machine_photo_path: machinePath,
        notes:              notes.trim() || null,
        created_at:         initial?.created_at ?? new Date().toISOString(),
      };

      const savedExercise: Exercise = {
        ...exerciseData,
        machinePhotoUrl: machinePath || undefined,
      };

      const queue = async () => {
        await enqueue({ type: "upsert", table: "exercises", payload: exerciseData, conflictOn: "id" });
        onSaved(savedExercise);
      };

      if (!navigator.onLine || userId === "guest-user") {
        await queue();
        return;
      }

      try {
        if (initial) {
          const { error } = await supabase
            .from("exercises")
            .update({
              name:               exerciseData.name,
              muscle_group:       exerciseData.muscle_group,
              machine_photo_path: exerciseData.machine_photo_path,
              notes:              exerciseData.notes,
            })
            .eq("id", initial.id)
            .select();
          if (error) throw error;
        } else {
          const { error } = await supabase.from("exercises").insert(exerciseData);
          if (error) throw error;
        }

        onSaved(savedExercise);
      } catch (err) {
        console.error("Online exercise save failed, falling back to offline queue:", err);
        await queue();
        triggerSync();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="card-glass p-4 space-y-3 animate-slide-up">
      <div className="flex items-center justify-between mb-1">
        <p className="section-label mb-0">{initial ? t.exerciseForm.editExercise : t.exerciseForm.newExercise}</p>
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
        {saving ? t.exerciseForm.saving : (initial ? t.exerciseForm.saveChanges : t.exerciseForm.saveExercise)}
      </button>
    </form>
  );
}
