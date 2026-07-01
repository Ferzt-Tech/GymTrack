"use client";

import { useState } from "react";
import Image from "next/image";
import type { Exercise } from "@/types";
import { useT } from "@/lib/context/LanguageContext";

interface Props {
  exercises: Exercise[];
  onDelete:  (id: string) => Promise<void>;
}

export default function ExerciseList({ exercises, onDelete }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const t = useT();

  async function handleDelete(id: string) {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
    setConfirmId(null);
  }

  if (!exercises.length) {
    return (
      <div className="h-28 flex items-center justify-center text-[var(--muted)] text-sm border border-dashed border-[var(--border)] rounded-2xl">
        {t.exerciseList.noExercisesSaved}
      </div>
    );
  }

  const grouped = exercises.reduce<Record<string, Exercise[]>>((acc, ex) => {
    const key = ex.muscle_group ?? "Other";
    acc[key] = [...(acc[key] ?? []), ex];
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([group, exs]) => (
        <div key={group} className="card-glass p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="sector-readout">{t.muscleGroups[group] ?? group}</span>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {exs.map(ex => {
              const isConfirming = confirmId === ex.id;
              const isDeleting   = deletingId === ex.id;

              return (
                <div key={ex.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  {ex.machinePhotoUrl ? (
                    <div className="relative h-11 w-11 rounded-lg overflow-hidden shrink-0 ring-1 ring-[var(--border)]">
                      <Image src={ex.machinePhotoUrl} alt={ex.name} fill className="object-cover" sizes="44px" />
                    </div>
                  ) : (
                    <div className="h-11 w-11 rounded-lg bg-[var(--surface)] border border-[var(--border)] shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text)] leading-tight truncate">{ex.name}</p>
                    {ex.notes && (
                      <p className="text-[11px] text-[var(--faint)] mt-0.5 truncate">{ex.notes}</p>
                    )}
                  </div>

                  {isConfirming ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setConfirmId(null)}
                        className="text-[11px] text-[var(--muted)] px-2 py-1"
                      >
                        {t.exerciseList.cancel}
                      </button>
                      <button
                        onClick={() => handleDelete(ex.id)}
                        disabled={isDeleting}
                        className="text-[11px] text-red-400 font-medium px-2 py-1 disabled:opacity-50"
                      >
                        {isDeleting ? t.exerciseList.deleting : t.exerciseList.delete}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(ex.id)}
                      aria-label={`Delete ${ex.name}`}
                      className="text-[var(--dim)] hover:text-red-400 transition-colors shrink-0 px-1 text-xl leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
