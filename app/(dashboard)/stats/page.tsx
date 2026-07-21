"use client";

import { useEffect, useRef, useState } from "react";
import { format, subDays, parseISO, formatDistanceToNow } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/lib/hooks/useProfile";
import { setCache, getCached, getCachedAt, getPendingCount } from "@/lib/offlineQueue";
import { resolveUserId, withTimeout } from "@/lib/auth-utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import MuscleDistribution from "@/components/stats/MuscleDistribution";
import BodyHeatmap         from "@/components/stats/BodyHeatmap";
import TopExercises        from "@/components/stats/TopExercises";
import MonthlyReport       from "@/components/stats/MonthlyReport";
import ExerciseProgress, { type ProgressPoint } from "@/components/stats/ExerciseProgress";
import VolumeLandmarks     from "@/components/stats/VolumeLandmarks";
import TrainingConsistency, { type WeekFrequency } from "@/components/stats/TrainingConsistency";
import PersonalRecords, { type PRRecord } from "@/components/stats/PersonalRecords";
import RepRangeFocus, { type RepRangeData } from "@/components/stats/RepRangeFocus";
import { e1RM } from "@/lib/oneRepMax";
import { useT } from "@/lib/context/LanguageContext";

interface SetRow {
  session_id:    string;
  exercise_name: string;
  exercise_id:   string | null;
  reps:          number | null;
  weight:        number | null;
  weight_unit:   string | null;
  set_type:      string | null;
  rpe:           number | null;
  session_date:  string;
  muscle_group:  string | null;
}

type StatsCache = {
  muscleCompare: { muscle: string; current: number; previous: number }[];
  weeklyMuscles: Record<string, number>;
  topExercises:  { name: string; sets: number; sessions: number }[];
  monthlyData:   {
    weeks:  { week: string; volume: number; sessions: number; sets: number }[];
    totals: { volume: number; sessions: number; sets: number; avgRpe: number | null };
  };
  exerciseProgress?: Record<string, ProgressPoint[]>;
  consistencyWeeks?: WeekFrequency[];
  currentStreak?: number;
  personalRecords?: PRRecord[];
  repRangeData?: RepRangeData;
};

function mondayOf(dateStr: string): string {
  const d = parseISO(dateStr);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return format(d, "yyyy-MM-dd");
}

export default function StatsPage() {
  const { profile } = useProfile();
  const t = useT();
  const { isOnline, refetchKey } = useOnlineSync();
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);

  const [muscleCompare, setMuscleCompare] = useState<{ muscle: string; current: number; previous: number }[]>([]);
  const [weeklyMuscles, setWeeklyMuscles] = useState<Record<string, number>>({});
  const [topExercises,  setTopExercises]  = useState<{ name: string; sets: number; sessions: number }[]>([]);
  const [monthlyData,   setMonthlyData]   = useState<{
    weeks:  { week: string; volume: number; sessions: number; sets: number }[];
    totals: { volume: number; sessions: number; sets: number; avgRpe: number | null };
  }>({ weeks: [], totals: { volume: 0, sessions: 0, sets: 0, avgRpe: null } });
  const [exerciseProgress, setExerciseProgress] = useState<Record<string, ProgressPoint[]>>({});
  const [consistencyWeeks, setConsistencyWeeks] = useState<WeekFrequency[]>([]);
  const [currentStreak,    setCurrentStreak]    = useState(0);
  const [personalRecords,  setPersonalRecords]  = useState<PRRecord[]>([]);
  const [repRangeData,     setRepRangeData]     = useState<RepRangeData>({ strength: 0, hypertrophy: 0, endurance: 0 });

  const hasFetched = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      const userId = await resolveUserId();
      if (!userId || !isMounted) { setLoading(false); return; }

      const cacheKey = `stats:${userId}`;

      async function fromCache() {
        const cached = await getCached<StatsCache>(cacheKey);
        if (cached && isMounted) {
          setMuscleCompare(cached.muscleCompare);
          setWeeklyMuscles(cached.weeklyMuscles);
          setTopExercises(cached.topExercises);
          setMonthlyData(cached.monthlyData);
          setExerciseProgress(cached.exerciseProgress ?? {});
          setConsistencyWeeks(cached.consistencyWeeks ?? []);
          setCurrentStreak(cached.currentStreak ?? 0);
          setPersonalRecords(cached.personalRecords ?? []);
          setRepRangeData(cached.repRangeData ?? { strength: 0, hypertrophy: 0, endurance: 0 });
          const at = await getCachedAt(cacheKey);
          if (at && isMounted) setCachedAt(at);
        }
        if (isMounted) setLoading(false);
      }

      // Always load from cache first (instant render)
      await fromCache();

      // If offline or guest, we are fully done
      if (!navigator.onLine || userId === "guest-user") {
        hasFetched.current = true;
        return;
      }

      // If online, check if there are pending ops in the queue.
      // If so, skip fetching from Supabase because OnlineSyncProvider will flush them
      // and increment refetchKey, which will trigger this loadStats() again when finished.
      const pendingCount = await getPendingCount();
      if (pendingCount > 0) {
        hasFetched.current = true;
        if (isMounted) {
          setLoading(false);
        }
        return;
      }

      const today      = new Date();
      const thirtyStr  = format(subDays(today, 30), "yyyy-MM-dd");
      const sixtyStr   = format(subDays(today, 60), "yyyy-MM-dd");
      const ninetyStr  = format(subDays(today, 90), "yyyy-MM-dd");
      const weekStr    = mondayOf(format(today, "yyyy-MM-dd"));

      // Resolve the display unit from the cached profile. The component-level
      // `unit` const is declared after the loading early-return, so referencing
      // it from this closure on the first render throws a TDZ ReferenceError.
      const cachedProfile = await getCached<{ weight_unit?: string }>(`profile:${userId}`);
      const volumeUnit = cachedProfile?.weight_unit ?? "kg";

      try {
        const { data: sessions, error: sessErr } = await withTimeout(
          supabase
            .from("workout_sessions")
            .select("id, session_date")
            .eq("user_id", userId)
            .gte("session_date", sixtyStr)
            .order("session_date"),
        );

        if (sessErr) throw sessErr;

        // Empty results may mean an expired JWT filtered all rows via RLS —
        // fall back to cache rather than overwriting good data with empty arrays.
        if (!sessions?.length) {
          await fromCache();
          hasFetched.current = true;
          return;
        }

        const sessionIds     = sessions.map((s: any) => s.id as string);
        const sessionDateMap = new Map<string, string>(sessions.map((s: any) => [s.id as string, s.session_date as string]));

        const [{ data: exercises }, { data: rawSets }, { data: consistencySessions }] = await withTimeout(Promise.all([
          supabase.from("exercises").select("id, muscle_group").eq("user_id", userId),
          supabase.from("workout_sets")
            .select("session_id, exercise_name, exercise_id, reps, weight, weight_unit, set_type, rpe")
            .in("session_id", sessionIds),
          supabase.from("workout_sessions")
            .select("session_date")
            .eq("user_id", userId)
            .gte("session_date", ninetyStr)
            .order("session_date"),
        ]));

        const muscleMap = new Map<string, string | null>(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (exercises ?? []).map((e: any) => [e.id as string, e.muscle_group as string | null])
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sets: SetRow[] = (rawSets ?? []).map((s: any) => ({
          session_id:    s.session_id,
          exercise_name: s.exercise_name,
          exercise_id:   s.exercise_id ?? null,
          reps:          s.reps   ?? null,
          weight:        s.weight ?? null,
          weight_unit:   s.weight_unit ?? null,
          set_type:      s.set_type ?? null,
          rpe:           s.rpe ?? null,
          session_date:  sessionDateMap.get(s.session_id) ?? "",
          muscle_group:  s.exercise_id ? (muscleMap.get(s.exercise_id) ?? null) : null,
        }));

        /* Muscle distribution */
        const currentSets = sets.filter(s => s.session_date >= thirtyStr);
        const prevSets    = sets.filter(s => s.session_date < thirtyStr);

        const countByMuscle = (arr: SetRow[]) =>
          arr.reduce<Record<string, number>>((acc, s) => {
            if (s.muscle_group) acc[s.muscle_group] = (acc[s.muscle_group] ?? 0) + 1;
            return acc;
          }, {});

        const cur  = countByMuscle(currentSets);
        const prev = countByMuscle(prevSets);
        const allMuscles = Array.from(new Set([...Object.keys(cur), ...Object.keys(prev)]));

        if (!isMounted) return;
        const finalMuscleCompare = allMuscles
          .map(m => ({ muscle: m, current: cur[m] ?? 0, previous: prev[m] ?? 0 }))
          .sort((a, b) => b.current - a.current)
          .slice(0, 8);
        setMuscleCompare(finalMuscleCompare);

        /* Weekly heatmap */
        const weekSets = sets.filter(s => s.session_date >= weekStr);
        const finalWeeklyMuscles = weekSets.reduce<Record<string, number>>((acc, s) => {
          if (s.muscle_group) acc[s.muscle_group] = (acc[s.muscle_group] ?? 0) + 1;
          return acc;
        }, {});
        setWeeklyMuscles(finalWeeklyMuscles);

        /* Top exercises */
        type Bucket = { sets: number; sessions: Set<string> };
        const exFreq = currentSets.reduce<Record<string, Bucket>>((acc, s) => {
          if (!acc[s.exercise_name]) acc[s.exercise_name] = { sets: 0, sessions: new Set() };
          acc[s.exercise_name].sets++;
          acc[s.exercise_name].sessions.add(s.session_id);
          return acc;
        }, {});

        const finalTopExercises = Object.entries(exFreq)
          .map(([name, d]) => ({ name, sets: d.sets, sessions: d.sessions.size }))
          .sort((a, b) => b.sets - a.sets)
          .slice(0, 8);
        setTopExercises(finalTopExercises);

        /* Monthly report */
        type WkBucket = { volume: number; sessions: Set<string>; sets: number };
        const wkMap: Record<string, WkBucket> = {};

        const getStatsWeight = (w: number | null, unitOfSet: string | null, targetUnit: string): number => {
          if (w == null) return 0;
          const setU = unitOfSet ?? "kg";
          if (setU === targetUnit) return w;
          if (setU === "kg" && targetUnit === "lbs") return w * 2.20462;
          if (setU === "lbs" && targetUnit === "kg") return w / 2.20462;
          return w;
        };

        currentSets.forEach(s => {
          const key = mondayOf(s.session_date);
          if (!wkMap[key]) wkMap[key] = { volume: 0, sessions: new Set(), sets: 0 };
          const w = getStatsWeight(s.weight, s.weight_unit, volumeUnit);
          wkMap[key].volume += (s.reps ?? 0) * w;
          wkMap[key].sessions.add(s.session_id);
          wkMap[key].sets++;
        });

        const weeks = Object.entries(wkMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, d]) => ({
            week:     format(parseISO(key), "MMM d"),
            volume:   Math.round(d.volume),
            sessions: d.sessions.size,
            sets:     d.sets,
          }));

        const rpeValues = currentSets
          .filter(s => s.set_type !== "warmup" && s.rpe != null)
          .map(s => s.rpe as number);
        const avgRpe = rpeValues.length
          ? Math.round((rpeValues.reduce((s, v) => s + v, 0) / rpeValues.length) * 10) / 10
          : null;

        const finalMonthlyData = {
          weeks,
          totals: {
            volume:   weeks.reduce((s, w) => s + w.volume, 0),
            sessions: new Set(currentSets.map(s => s.session_id)).size,
            sets:     currentSets.length,
            avgRpe,
          },
        };
        setMonthlyData(finalMonthlyData);

        /* Rep range focus — training goal alignment for the current 30-day window */
        const finalRepRangeData: RepRangeData = { strength: 0, hypertrophy: 0, endurance: 0 };
        currentSets.forEach(s => {
          if (s.set_type === "warmup" || s.reps == null) return;
          if (s.reps <= 5)  finalRepRangeData.strength++;
          else if (s.reps <= 12) finalRepRangeData.hypertrophy++;
          else finalRepRangeData.endurance++;
        });
        setRepRangeData(finalRepRangeData);

        /* Training consistency — 12-week session frequency + current streak */
        const weekBuckets: Record<string, number> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (consistencySessions ?? []).forEach((s: any) => {
          const key = mondayOf(s.session_date as string);
          weekBuckets[key] = (weekBuckets[key] ?? 0) + 1;
        });
        const thisMonday = parseISO(weekStr);
        const finalConsistencyWeeks: WeekFrequency[] = Array.from({ length: 12 }, (_, i) => {
          const d   = subDays(thisMonday, (11 - i) * 7);
          const key = format(d, "yyyy-MM-dd");
          return { week: format(d, "MMM d"), count: weekBuckets[key] ?? 0 };
        });
        let finalStreak = 0;
        for (let i = finalConsistencyWeeks.length - 1; i >= 0; i--) {
          if (finalConsistencyWeeks[i].count > 0) finalStreak++;
          else break;
        }
        setConsistencyWeeks(finalConsistencyWeeks);
        setCurrentStreak(finalStreak);

        /* Strength progress — per-exercise e1RM over the full 60-day window */
        const progressBuckets: Record<string, Record<string, { e1rm: number; top: number }>> = {};
        for (const s of sets) {
          if (s.set_type === "warmup" || !s.session_date) continue;
          const w = getStatsWeight(s.weight, s.weight_unit, volumeUnit);
          const est = e1RM(w, s.reps);
          if (est == null) continue;
          const byDate = (progressBuckets[s.exercise_name] ??= {});
          const bucket = (byDate[s.session_date] ??= { e1rm: 0, top: 0 });
          if (est > bucket.e1rm) bucket.e1rm = est;
          const topW = Math.round(w * 10) / 10;
          if (topW > bucket.top) bucket.top = topW;
        }
        const finalExerciseProgress: Record<string, ProgressPoint[]> = Object.fromEntries(
          Object.entries(progressBuckets)
            .map(([name, byDate]) => [
              name,
              Object.entries(byDate)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, v]) => ({ date: format(parseISO(date), "MMM d"), e1rm: v.e1rm, top: v.top })),
            ] as const)
            .filter(([, pts]) => (pts as ProgressPoint[]).length >= 2)
            .sort(([, a], [, b]) => (b as ProgressPoint[]).length - (a as ProgressPoint[]).length)
            .slice(0, 12)
        );
        setExerciseProgress(finalExerciseProgress);

        /* Personal records — all-time best e1RM per exercise within the 60-day window */
        const fourteenStr = format(subDays(today, 14), "yyyy-MM-dd");
        const finalPersonalRecords: PRRecord[] = Object.entries(progressBuckets)
          .map(([name, byDate]) => {
            let bestE1rm = 0, bestDate = "";
            for (const [date, v] of Object.entries(byDate)) {
              if (v.e1rm > bestE1rm) { bestE1rm = v.e1rm; bestDate = date; }
            }
            return { name, e1rm: bestE1rm, e1rmDate: bestDate };
          })
          .filter(r => r.e1rmDate !== "")
          .sort((a, b) => b.e1rmDate.localeCompare(a.e1rmDate))
          .slice(0, 8)
          .map(r => ({
            name:     r.name,
            e1rm:     r.e1rm,
            e1rmDate: format(parseISO(r.e1rmDate), "MMM d"),
            isRecent: r.e1rmDate >= fourteenStr,
          }));
        setPersonalRecords(finalPersonalRecords);

        await setCache(cacheKey, {
          muscleCompare:     finalMuscleCompare,
          weeklyMuscles:     finalWeeklyMuscles,
          topExercises:      finalTopExercises,
          monthlyData:       finalMonthlyData,
          exerciseProgress:  finalExerciseProgress,
          consistencyWeeks:  finalConsistencyWeeks,
          currentStreak:     finalStreak,
          personalRecords:   finalPersonalRecords,
          repRangeData:      finalRepRangeData,
        });

        hasFetched.current = true;
        if (isMounted) setLoading(false);
      } catch {
        await fromCache();
        hasFetched.current = true;
      }
    }

    loadStats();
    return () => { isMounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchKey]);

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        <div className="skeleton h-8 w-32 mb-4" />
        <div className="skeleton h-44 w-full" />
        <div className="skeleton h-44 w-full" />
        <div className="skeleton h-44 w-full" />
        <div className="skeleton h-44 w-full" />
      </div>
    );
  }

  const unit = profile?.weight_unit ?? "kg";

  const isOffline = !isOnline;

  return (
    <div className="space-y-3 py-2">
      <h1 className="metric text-2xl font-semibold tracking-tight text-[var(--text)] mb-4 animate-spring-up">
        {t.stats.statistics}
      </h1>

      {isOffline && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 animate-spring-up">
          <span className="text-amber-500 dark:text-amber-400 text-[11px] font-mono shrink-0">◈ CACHED</span>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 flex-1">
            {cachedAt
              ? t.offline.lastSyncedAgo(formatDistanceToNow(cachedAt))
              : t.offline.availableWhenConnected}
          </p>
        </div>
      )}

      <div className="card-glass p-4 animate-spring-up stagger-1">
        <p className="section-label">{t.stats.trainingConsistency}</p>
        <p className="text-[11px] text-[var(--faint)] -mt-2 mb-4">{t.stats.consistencySub}</p>
        <TrainingConsistency weeks={consistencyWeeks} streakWeeks={currentStreak} isOffline={isOffline} />
      </div>

      <div className="card-glass p-4 animate-spring-up stagger-2">
        <p className="section-label">{t.stats.personalRecords}</p>
        <p className="text-[11px] text-[var(--faint)] -mt-2 mb-4">{t.stats.personalRecordsSub}</p>
        <PersonalRecords records={personalRecords} unit={unit} isOffline={isOffline} />
      </div>

      <div className="card-glass p-4 animate-spring-up stagger-3">
        <p className="section-label">{t.stats.exerciseProgress}</p>
        <p className="text-[11px] text-[var(--faint)] -mt-2 mb-4">{t.stats.e1rmSubtitle}</p>
        <ExerciseProgress data={exerciseProgress} unit={unit} isOffline={isOffline} />
      </div>

      <div className="card-glass p-4 animate-spring-up stagger-4">
        <p className="section-label">{t.stats.volumeLandmarks}</p>
        <p className="text-[11px] text-[var(--faint)] -mt-2 mb-4">{t.stats.volumeLandmarksSub}</p>
        <VolumeLandmarks weeklyMuscles={weeklyMuscles} isOffline={isOffline} />
      </div>

      <div className="card-glass p-4 animate-spring-up stagger-5">
        <p className="section-label">{t.stats.repRangeFocus}</p>
        <p className="text-[11px] text-[var(--faint)] -mt-2 mb-4">{t.stats.repRangeFocusSub}</p>
        <RepRangeFocus data={repRangeData} isOffline={isOffline} />
      </div>

      <div className="card-glass p-4 animate-spring-up stagger-6">
        <p className="section-label">{t.stats.muscleDistribution}</p>
        <p className="text-[11px] text-[var(--faint)] -mt-2 mb-4">{t.stats.setsPerGroup}</p>
        <MuscleDistribution data={muscleCompare} isOffline={isOffline} />
      </div>

      <div className="card-glass p-4 animate-spring-up stagger-7">
        <p className="section-label">{t.stats.weeklyHeatmap}</p>
        <p className="text-[11px] text-[var(--faint)] -mt-2 mb-4">{t.stats.musclesWorkedWeek}</p>
        <BodyHeatmap weeklyMuscles={weeklyMuscles} isOffline={isOffline} />
      </div>

      <div className="card-glass p-4 animate-spring-up stagger-8">
        <p className="section-label">{t.stats.topExercises}</p>
        <p className="text-[11px] text-[var(--faint)] -mt-2 mb-4">{t.stats.mostPerformed}</p>
        <TopExercises exercises={topExercises} isOffline={isOffline} />
      </div>

      <div className="card-glass p-4 animate-spring-up stagger-9">
        <p className="section-label">{t.stats.monthlyReport}</p>
        <MonthlyReport data={monthlyData} unit={unit} isOffline={isOffline} />
      </div>
    </div>
  );
}
