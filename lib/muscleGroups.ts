/**
 * The canonical muscle-group vocabulary and its display order.
 *
 * The strings here are the values stored in `exercises.muscle_group` and the
 * keys of `t.muscleGroups` — translate at render time, never store a
 * translated value.
 */
export const MUSCLE_GROUP_ORDER = [
  "Chest", "Back", "Shoulders", "Biceps", "Triceps",
  "Legs", "Glutes", "Core", "Cardio", "Full Body", "Other",
];

const ORDER_INDEX = new Map(MUSCLE_GROUP_ORDER.map((g, i) => [g, i]));
const OTHER_INDEX = ORDER_INDEX.get("Other")!;

/** Unknown groups sit just before "Other", ordered among themselves by name. */
function rank(group: string): number {
  return ORDER_INDEX.get(group) ?? OTHER_INDEX - 0.5;
}

export interface MuscleGroupSection<T> {
  group: string;
  items: T[];
}

/**
 * Groups exercises by muscle group in canonical order, names A→Z within each
 * group. Empty groups are omitted. A value outside MUSCLE_GROUP_ORDER (e.g. an
 * imported dataset's own taxonomy) sorts alphabetically just before "Other";
 * a null/empty group falls into "Other".
 */
export function groupByMuscle<T extends { name: string; muscle_group?: string | null }>(
  list: T[],
): MuscleGroupSection<T>[] {
  const map = new Map<string, T[]>();

  for (const item of list) {
    const key = item.muscle_group?.trim() || "Other";
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }

  return [...map.entries()]
    .map(([group, items]) => ({
      group,
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group));
}
