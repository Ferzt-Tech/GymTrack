"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { compressImage, supabase } from "@/lib/supabase";
import { enqueue } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import type { Exercise } from "@/types";
import { useT, useLanguage } from "@/lib/context/LanguageContext";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import { cn } from "@/lib/utils";

interface LibraryExercise {
  id: string;
  name: string;
  body_part: string;
  target: string;
  equipment: string;
  app_muscle_group: string;
  instructions: { en: string; es: string };
  image: string;
}

const BODY_PARTS = [
  "back", "cardio", "chest", "lower arms", "lower legs",
  "neck", "shoulders", "upper arms", "upper legs", "waist",
];

const PAGE_SIZE = 30;

interface Props {
  existingExercises: Exercise[];
  onSaved: (ex: Exercise) => void;
  onCancel: () => void;
}

export default function ExerciseLibraryPicker({ existingExercises, onSaved, onCancel }: Props) {
  const t = useT();
  const { language } = useLanguage();
  const { triggerSync } = useOnlineSync();

  const [library,  setLibrary]  = useState<LibraryExercise[] | null>(null);
  const [query,    setQuery]    = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [visible,  setVisible]  = useState(PAGE_SIZE);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/exercise-library/exercises.json")
      .then(res => res.json())
      .then((data: LibraryExercise[]) => setLibrary(data))
      .catch(() => setLibrary([]));
  }, []);

  const existingNames = useMemo(
    () => new Set(existingExercises.map(e => e.name.trim().toLowerCase())),
    [existingExercises]
  );

  const filtered = useMemo(() => {
    if (!library) return [];
    const q = query.trim().toLowerCase();
    return library.filter(e =>
      (!q || e.name.toLowerCase().includes(q)) &&
      (!bodyPart || e.body_part === bodyPart)
    );
  }, [library, query, bodyPart]);

  async function handleAdd(item: LibraryExercise) {
    if (addingId || existingNames.has(item.name.trim().toLowerCase()) || addedIds.has(item.id)) return;
    setAddingId(item.id);

    try {
      const userId = await resolveUserId();
      if (!userId) return;

      let machinePath: string | null = null;
      try {
        const res = await fetch(`/exercise-library/${item.image}`);
        const blob = await res.blob();
        const file = new File([blob], item.image, { type: blob.type || "image/jpeg" });
        machinePath = await compressImage(file, 200, 200, 0.85);
      } catch {
        machinePath = null;
      }

      const exerciseData = {
        id:                 crypto.randomUUID(),
        user_id:            userId,
        name:               item.name,
        muscle_group:       item.app_muscle_group,
        machine_photo_path: machinePath,
        notes:              item.instructions[language] || item.instructions.en,
        created_at:         new Date().toISOString(),
      };

      const savedExercise: Exercise = {
        ...exerciseData,
        machinePhotoUrl: machinePath || undefined,
      };

      const queue = () => enqueue({ type: "upsert", table: "exercises", payload: exerciseData, conflictOn: "id" });

      if (!navigator.onLine || userId === "guest-user") {
        await queue();
      } else {
        try {
          const { error } = await supabase.from("exercises").insert(exerciseData);
          if (error) throw error;
        } catch (err) {
          console.error("Online exercise save failed, falling back to offline queue:", err);
          await queue();
          triggerSync();
        }
      }

      setAddedIds(prev => new Set(prev).add(item.id));
      onSaved(savedExercise);
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="card-glass p-4 space-y-3 animate-slide-up">
      <div className="flex items-center justify-between mb-1">
        <p className="section-label mb-0">{t.exerciseLibrary.title}</p>
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
        placeholder={t.exerciseLibrary.searchPlaceholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setVisible(PAGE_SIZE); }}
        className="input-base"
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          type="button"
          onClick={() => { setBodyPart(""); setVisible(PAGE_SIZE); }}
          className={cn(
            "shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors",
            bodyPart === ""
              ? "bg-[var(--accent)] text-[#041a1f] border-[var(--accent)] font-bold"
              : "border-[var(--border)] text-[var(--muted)]"
          )}
        >
          {t.exerciseLibrary.allBodyParts}
        </button>
        {BODY_PARTS.map(bp => (
          <button
            key={bp}
            type="button"
            onClick={() => { setBodyPart(bp); setVisible(PAGE_SIZE); }}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors capitalize",
              bodyPart === bp
                ? "bg-[var(--accent)] text-[#041a1f] border-[var(--accent)] font-bold"
                : "border-[var(--border)] text-[var(--muted)]"
            )}
          >
            {t.exerciseLibrary.bodyParts[bp] ?? bp}
          </button>
        ))}
      </div>

      {library === null ? (
        <div className="h-28 flex items-center justify-center text-[var(--muted)] text-sm">
          {t.exerciseLibrary.loading}
        </div>
      ) : filtered.length === 0 ? (
        <div className="h-28 flex items-center justify-center text-[var(--muted)] text-sm border border-dashed border-[var(--border)] rounded-2xl">
          {t.exerciseLibrary.noResults}
        </div>
      ) : (
        <>
          <div className="divide-y divide-[var(--border-subtle)] max-h-[50vh] overflow-y-auto">
            {filtered.slice(0, visible).map(item => {
              const isAdded   = addedIds.has(item.id) || existingNames.has(item.name.trim().toLowerCase());
              const isAdding  = addingId === item.id;

              return (
                <div key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="relative h-11 w-11 rounded-lg overflow-hidden shrink-0 ring-1 ring-[var(--border)] bg-[var(--surface)]">
                    <Image
                      src={`/exercise-library/${item.image}`}
                      alt={item.name}
                      fill
                      className="object-cover"
                      sizes="44px"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text)] leading-tight truncate">{item.name}</p>
                    <p className="text-[11px] text-[var(--faint)] mt-0.5 capitalize truncate">
                      {t.exerciseLibrary.bodyParts[item.body_part] ?? item.body_part} · {item.equipment}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleAdd(item)}
                    disabled={isAdded || isAdding}
                    className={cn(
                      "shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors",
                      isAdded
                        ? "text-[var(--faint)] bg-[var(--surface)] border border-[var(--border)]"
                        : "btn-aqua !py-1.5 !px-3"
                    )}
                  >
                    {isAdded ? t.exerciseLibrary.added : isAdding ? t.exerciseLibrary.adding : t.exerciseLibrary.add}
                  </button>
                </div>
              );
            })}
          </div>

          {visible < filtered.length && (
            <button
              type="button"
              onClick={() => setVisible(v => v + PAGE_SIZE)}
              className="btn-outline w-full"
            >
              {t.exerciseLibrary.loadMore}
            </button>
          )}
        </>
      )}

      <p className="text-[10px] text-[var(--faint)] text-center pt-1">
        {t.exerciseLibrary.attribution}
      </p>
    </div>
  );
}
