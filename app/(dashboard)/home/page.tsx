"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { supabase, getStorageUrl } from "@/lib/supabase";
import { useProfile } from "@/lib/hooks/useProfile";
import { todayISO, thirtyDaysAgoISO } from "@/lib/utils";
import { getCached, setCache, getCachedAt, getPendingUpsertsForTable, getPendingCount } from "@/lib/offlineQueue";
import { resolveUserId, withTimeout } from "@/lib/auth-utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import WeightLogger from "@/components/home/WeightLogger";
import WeightChart  from "@/components/home/WeightChart";
import WaterTracker from "@/components/home/WaterTracker";
import PhotoGallery from "@/components/home/PhotoGallery";
import type { DailyWeightLog, WaterLog, ProgressPhoto, WeightUnit } from "@/types";
import { useT } from "@/lib/context/LanguageContext";

function overlayUpserts<T extends Record<string, unknown>>(
  base: T[],
  pending: Record<string, unknown>[],
  key: string,
): T[] {
  if (!pending.length) return base;
  const copy = [...base];
  for (const op of pending) {
    const idx = copy.findIndex(r => r[key] === op[key]);
    if (idx >= 0) copy[idx] = { ...copy[idx], ...op } as T;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    else copy.push({ ...op, id: `local-${Date.now()}` } as any as T);
  }
  return copy;
}

export default function HomePage() {
  const { profile, loading: profileLoading } = useProfile();
  const { refetchKey } = useOnlineSync();
  const t = useT();
  const [unit, setUnit] = useState<WeightUnit>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("gymtrack:home_weight_unit") as WeightUnit | null;
      if (stored === "kg" || stored === "lbs") return stored;
    }
    return "kg";
  });

  const toggleUnit = () => {
    const next = unit === "kg" ? "lbs" : "kg";
    setUnit(next);
    localStorage.setItem("gymtrack:home_weight_unit", next);
  };

  const hasFetched = useRef(false);
  const userIdRef  = useRef<string | null>(null);
  const [weightLogs,    setWeightLogs]    = useState<DailyWeightLog[]>([]);
  const [todayWeight,   setTodayWeight]   = useState<DailyWeightLog | null>(null);
  const [waterLogs,     setWaterLogs]     = useState<WaterLog[]>([]);
  const [waterLog,      setWaterLog]      = useState<WaterLog | null>(null);
  const [photos,        setPhotos]        = useState<ProgressPhoto[]>([]);
  const [lastSession,   setLastSession]   = useState<string | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [isOffline,     setIsOffline]     = useState(false);
  const [homeCachedAt,  setHomeCachedAt]  = useState<Date | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function applyData(
      weightList: DailyWeightLog[],
      waterList:  WaterLog[],
      photos:     ProgressPhoto[],
      lastSess:   string | null,
      today:      string,
    ) {
      if (!isMounted) return;
      setWeightLogs(weightList);
      setTodayWeight(weightList.find(l => l.logged_date === today) ?? null);
      setWaterLogs(waterList);
      setWaterLog(waterList.find((l: WaterLog) => l.logged_date === today) ?? null);
      setLastSession(lastSess);
      setPhotos(photos);
      setLoading(false);
    }

    async function load() {
      const userId = await resolveUserId();
      if (!userId || !isMounted) { setLoading(false); return; }
      userIdRef.current = userId;

      const today    = todayISO();
      const cacheKey = `home:${userId}`;

      type HomeCache = { weightLogs: DailyWeightLog[]; waterLogs: WaterLog[]; photos: ProgressPhoto[]; lastSession: string | null };

      async function fromCache() {
        if (isMounted) setIsOffline(true);
        const cached = await getCached<HomeCache>(cacheKey);
        if (cached && isMounted) {
          const ts = await getCachedAt(cacheKey);
          if (ts && isMounted) setHomeCachedAt(ts);
          await applyData(cached.weightLogs, cached.waterLogs, cached.photos, cached.lastSession, today);
        } else if (isMounted) {
          setLoading(false);
        }
      }

      // Always load from cache first (instant render)
      await fromCache();

      // If offline, we are fully done
      if (!navigator.onLine) {
        hasFetched.current = true;
        return;
      }

      // If online, check if there are pending ops in the queue.
      // If so, skip fetching from Supabase because OnlineSyncProvider will flush them
      // and increment refetchKey, which will trigger this load() again when finished.
      const pendingCount = await getPendingCount();
      if (pendingCount > 0) {
        hasFetched.current = true;
        if (isMounted) {
          setIsOffline(false);
          setLoading(false);
        }
        return;
      }

      // No pending ops, safe to fetch from Supabase
      try {
        const [
          { data: logs, error: logsErr },
          { data: water, error: waterErr },
          { data: pics, error: picsErr },
          { data: sess },
        ] = await withTimeout(Promise.all([
          supabase.from("daily_weight_logs")
            .select("*").eq("user_id", userId)
            .order("logged_date", { ascending: true }).limit(90),
          supabase.from("water_logs")
            .select("*").eq("user_id", userId)
            .gte("logged_date", thirtyDaysAgoISO())
            .order("logged_date", { ascending: false })
            .limit(30),
          supabase.from("progress_photos")
            .select("*").eq("user_id", userId)
            .order("photo_date", { ascending: false }),
          supabase.from("workout_sessions")
            .select("session_date").eq("user_id", userId)
            .order("session_date", { ascending: false }).limit(1).maybeSingle(),
        ]));

        if (logsErr || waterErr || picsErr) throw logsErr ?? waterErr ?? picsErr;
        if (!isMounted) return;

        const rawWeightList = logs ?? [];
        const rawWaterList  = water ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const photoList  = (pics ?? []).map((p: any) => ({
          ...p,
          publicUrl: getStorageUrl("progress-photos", p.storage_path),
        }));
        const lastSess   = (sess as { session_date?: string } | null)?.session_date ?? null;

        // Even though pendingCount was 0, double check to be safe
        const [pendingWater, pendingWeight] = await Promise.all([
          getPendingUpsertsForTable("water_logs"),
          getPendingUpsertsForTable("daily_weight_logs"),
        ]);
        const waterList  = overlayUpserts(rawWaterList,  pendingWater,  "logged_date") as any as WaterLog[];
        const weightList = overlayUpserts(rawWeightList, pendingWeight, "logged_date") as any as DailyWeightLog[];

        await setCache(cacheKey, { weightLogs: weightList, waterLogs: waterList, photos: photoList, lastSession: lastSess });
        if (isMounted) setIsOffline(false);
        hasFetched.current = true;
        await applyData(weightList, waterList, photoList, lastSess, today);
      } catch {
        hasFetched.current = true;
        // Keep the already loaded cache data, but flag offline state
        if (isMounted) {
          setIsOffline(true);
          setLoading(false);
        }
      }
    }

    load();
    return () => { isMounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchKey]);

  function onWeightSaved(log: DailyWeightLog) {
    setTodayWeight(log);
    setWeightLogs(prev => {
      const filtered = prev.filter(l => l.logged_date !== log.logged_date);
      const next = [...filtered, log].sort((a, b) => a.logged_date.localeCompare(b.logged_date));
      if (userIdRef.current) {
        setCache(`home:${userIdRef.current}`, {
          weightLogs: next,
          waterLogs,
          photos,
          lastSession,
        });
      }
      return next;
    });
  }

  if (profileLoading || loading) {
    return (
      <div className="space-y-3 py-2">
        <div className="skeleton h-8 w-48 mb-5" />
        <div className="skeleton h-20 w-full" />
        <div className="skeleton h-44 w-full" />
        <div className="skeleton h-32 w-full" />
      </div>
    );
  }

  const waterGoal = profile?.water_goal_liters ?? 2.5;
  const name      = profile?.username ?? null;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t.home.goodMorning :
    hour < 18 ? t.home.goodAfternoon :
    t.home.goodEvening;

  const daysSince = lastSession
    ? Math.floor(
        (new Date(todayISO()).getTime() - new Date(lastSession).getTime())
        / (1000 * 60 * 60 * 24)
      )
    : null;

  return (
    <div className="space-y-3 py-2">
      {/* Greeting */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--faint)]">
            {name ? (
              <>{greeting}, <span className="text-[var(--accent)] font-medium">{name}</span></>
            ) : greeting}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] mb-0">
            {format(new Date(), "EEEE, MMM d")}
          </h1>
        </div>
        <button
          onClick={toggleUnit}
          className="sector-readout text-[11px] font-mono tracking-widest uppercase hover:opacity-80 transition-opacity"
          title="Toggle Weight Unit"
        >
          ◈ {unit.toUpperCase()}
        </button>
      </div>

      {/* Rest nudge */}
      {daysSince !== null && daysSince >= 3 && (
        <div className="card-glass p-3 border-l-2 border-l-[var(--accent)] animate-spring-up">
          <p className="text-[13px] text-[var(--muted)]">
            {t.home.lastSessionBefore}{" "}
            <span className="text-[var(--text)] font-medium">
              {daysSince} {daysSince !== 1 ? t.home.lastSessionDays : t.home.lastSessionDay}{t.home.lastSessionAgo ? ` ${t.home.lastSessionAgo}` : ""}
            </span>
            {name && <>, <span className="text-[var(--accent)]">{name}</span></>}. {t.home.timeToGetBack}
          </p>
        </div>
      )}

      <WeightLogger unit={unit} weightLogs={weightLogs} onSaved={onWeightSaved} />
      <WeightChart  logs={weightLogs} unit={unit} isOffline={isOffline} cachedAt={homeCachedAt} />
      <WaterTracker
        goal={waterGoal}
        todayLog={waterLog}
        historyLogs={waterLogs}
        onUpdate={log => {
          setWaterLog(log);
          setWaterLogs(prev => {
            const filtered = prev.filter(l => l.logged_date !== log.logged_date);
            const next = [log, ...filtered].sort((a, b) => b.logged_date.localeCompare(a.logged_date));
            if (userIdRef.current) {
              setCache(`home:${userIdRef.current}`, {
                weightLogs,
                waterLogs: next,
                photos,
                lastSession,
              });
            }
            return next;
          });
        }}
        name={name}
      />
      <PhotoGallery photos={photos} onUploaded={p => {
        setPhotos(prev => {
          const next = [p, ...prev];
          if (userIdRef.current) {
            setCache(`home:${userIdRef.current}`, {
              weightLogs,
              waterLogs,
              photos: next,
              lastSession,
            });
          }
          return next;
        });
      }} />
    </div>
  );
}
