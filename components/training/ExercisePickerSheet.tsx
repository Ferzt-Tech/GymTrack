"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import type { Exercise } from "@/types";
import { useT } from "@/lib/context/LanguageContext";
import { useNav } from "@/lib/context/NavContext";
import { cn } from "@/lib/utils";
import { groupByMuscle } from "@/lib/muscleGroups";

interface Props {
  open: boolean;
  exercises: Exercise[];
  selectedId?: string | null;
  /** Most-recently-logged exercise ids, most recent first. Pinned above the groups. */
  recentExerciseIds?: string[];
  onSelect: (ex: Exercise) => void;
  onClose: () => void;
}

/** How many recently-logged exercises the picker pins above the muscle groups. */
export const RECENT_EXERCISE_LIMIT = 6;

export default function ExercisePickerSheet({
  open, exercises, selectedId, recentExerciseIds, onSelect, onClose,
}: Props) {
  const t = useT();
  const { setNavHidden } = useNav();
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  useEffect(() => {
    if (open) setNavHidden(true);
    else setNavHidden(false);
    return () => setNavHidden(false);
  }, [open, setNavHidden]);

  // Reopening never starts pre-filtered.
  useEffect(() => {
    if (!open) { setQuery(""); setActiveGroup(null); }
  }, [open]);

  const sections = useMemo(() => groupByMuscle(exercises), [exercises]);

  const visibleSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections
      .filter(s => !activeGroup || s.group === activeGroup)
      .map(s => q
        ? { ...s, items: s.items.filter(ex => ex.name.toLowerCase().includes(q)) }
        : s)
      .filter(s => s.items.length > 0);
  }, [sections, activeGroup, query]);

  /* Recent is a shortcut for the unnarrowed list only — once the user filters or
     searches, a pinned duplicate of a row that also appears below reads as a bug. */
  const showRecent = !activeGroup && !query.trim();
  const recent = useMemo(() => {
    if (!showRecent || !recentExerciseIds?.length) return [];
    const byId = new Map(exercises.map(ex => [ex.id, ex]));
    return recentExerciseIds
      .map(id => byId.get(id))
      .filter((ex): ex is Exercise => ex != null)
      .slice(0, RECENT_EXERCISE_LIMIT);
  }, [showRecent, recentExerciseIds, exercises]);

  const hasResults = visibleSections.length > 0;

  function handlePick(ex: Exercise) {
    onSelect(ex);
    onClose();
  }

  /* Search is the "I know the name" path — intersecting it with a chip the user
     set a while ago yields an empty list for a name that plainly exists. */
  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim()) setActiveGroup(null);
  }

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[70] transition-opacity duration-300",
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div
        className={cn(
          "glass-sheet absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-[var(--border)] transition-transform duration-300 max-h-[85vh] flex flex-col",
          open ? "translate-y-0" : "translate-y-full"
        )}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
        </div>

        <div className="px-4 pb-3 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <p className="section-label mb-0">{t.exercisePicker.title}</p>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--faint)] hover:text-[var(--muted)] text-xl leading-none transition-colors"
            >
              ×
            </button>
          </div>

          <input
            type="text"
            placeholder={t.exercisePicker.searchPlaceholder}
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            className="input-base"
          />

          {sections.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-0.5 no-scrollbar">
              <GroupChip
                label={t.exercisePicker.all}
                active={!activeGroup}
                onClick={() => setActiveGroup(null)}
              />
              {sections.map(s => (
                <GroupChip
                  key={s.group}
                  label={t.muscleGroups[s.group] ?? s.group}
                  count={s.items.length}
                  active={activeGroup === s.group}
                  onClick={() => setActiveGroup(activeGroup === s.group ? null : s.group)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-4 pb-8 overflow-y-auto flex-1">
          {exercises.length === 0 ? (
            <p className="text-[11px] text-[var(--faint)] text-center py-6">
              {t.routineManager.addExercisesFirst}
            </p>
          ) : !hasResults ? (
            <div className="h-28 flex items-center justify-center text-[var(--muted)] text-sm border border-dashed border-[var(--border)] rounded-2xl">
              {t.exercisePicker.noResults}
            </div>
          ) : (
            <>
              {recent.length > 0 && (
                <section>
                  <SectionHeader label={t.exercisePicker.recent} />
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {recent.map(ex => (
                      <ExerciseRow
                        key={`recent-${ex.id}`}
                        ex={ex}
                        /* The only place the group is worth repeating — a Recent
                           row has no section header above it to say it. */
                        subtitle={ex.muscle_group ? t.muscleGroups[ex.muscle_group] ?? ex.muscle_group : null}
                        selected={ex.id === selectedId}
                        onClick={() => handlePick(ex)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {visibleSections.map(s => (
                <section key={s.group}>
                  <SectionHeader label={t.muscleGroups[s.group] ?? s.group} />
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {s.items.map(ex => (
                      <ExerciseRow
                        key={ex.id}
                        ex={ex}
                        subtitle={null}
                        selected={ex.id === selectedId}
                        onClick={() => handlePick(ex)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Sub-components ── */

function GroupChip({ label, count, active, onClick }: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "sector-readout shrink-0 transition-colors",
        active
          ? "!bg-[var(--accent)] !text-[var(--bg)] !border-[var(--accent)]"
          : "hover:!text-[var(--text)]"
      )}
    >
      {label}
      {count != null && <span className="ml-1.5 opacity-60">{count}</span>}
    </button>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="sheet-section-header -mx-4 px-4 py-2">
      <span className="sector-readout">{label}</span>
    </div>
  );
}

function ExerciseRow({ ex, subtitle, selected, onClick }: {
  ex: Exercise;
  subtitle: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  const photo = ex.machinePhotoUrl || ex.machine_photo_path;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 py-2.5 text-left transition-colors",
        selected && "bg-[var(--accent-faint)] -mx-4 px-4 rounded-lg"
      )}
    >
      {photo ? (
        <div className="relative h-11 w-11 rounded-lg overflow-hidden shrink-0 ring-1 ring-[var(--border)]">
          <Image src={photo} alt={ex.name} fill className="object-cover" sizes="44px" />
        </div>
      ) : (
        <div className="h-11 w-11 rounded-lg bg-[var(--surface)] border border-[var(--border)] shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <p className={cn(
          "text-sm font-medium leading-tight truncate",
          selected ? "text-[var(--accent)]" : "text-[var(--text)]"
        )}>
          {ex.name}
        </p>
        {subtitle && (
          <p className="text-[11px] text-[var(--faint)] mt-0.5 truncate">{subtitle}</p>
        )}
      </div>

      {selected && <span className="text-[var(--accent)] text-sm shrink-0">✓</span>}
    </button>
  );
}
