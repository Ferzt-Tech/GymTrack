"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { supabase, getStorageUrl } from "@/lib/supabase";
import { useProfile } from "@/lib/hooks/useProfile";
import { todayISO, thirtyDaysAgoISO, cn } from "@/lib/utils";
import { getCached, setCache, getCachedAt, getPendingUpsertsForTable, overlayUpserts } from "@/lib/offlineQueue";
import { resolveUserId, withTimeout } from "@/lib/auth-utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import WeightLogger from "@/components/home/WeightLogger";
import WeightChart  from "@/components/home/WeightChart";
import WaterTracker from "@/components/home/WaterTracker";
import PhotoGallery from "@/components/home/PhotoGallery";
import type { DailyWeightLog, WaterLog, ProgressPhoto, WeightUnit } from "@/types";
import { useT } from "@/lib/context/LanguageContext";
import NutritionDisplay from "@/components/home/NutritionDisplay";
import NutritionCalculator from "@/components/settings/NutritionCalculator";

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

  // Nutrition Calculator States
  const [calcOpen, setCalcOpen] = useState(false);
  const [nutritionRefetchKey, setNutritionRefetchKey] = useState(0);

  const router = useRouter();
  const [hasNutrition, setHasNutrition] = useState(false);
  const [hasRoutine,   setHasRoutine]   = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);

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

      // Merges anything still queued for sync on top of a base snapshot (cache or
      // fresh fetch) — so a queued-but-unsynced weight/water/photo edit is never
      // silently missing, regardless of connectivity or of what else happens to
      // be sitting in the sync queue for other pages.
      async function overlayHomeData(base: HomeCache): Promise<HomeCache> {
        const [pendingWater, pendingWeight, pendingPhotos] = await Promise.all([
          getPendingUpsertsForTable("water_logs"),
          getPendingUpsertsForTable("daily_weight_logs"),
          getPendingUpsertsForTable("progress_photos"),
        ]);
        return {
          weightLogs:  overlayUpserts(base.weightLogs as unknown as Record<string, unknown>[], pendingWeight, "logged_date") as unknown as DailyWeightLog[],
          waterLogs:   overlayUpserts(base.waterLogs  as unknown as Record<string, unknown>[], pendingWater,  "logged_date") as unknown as WaterLog[],
          photos:      overlayUpserts(base.photos     as unknown as Record<string, unknown>[], pendingPhotos, "id") as unknown as ProgressPhoto[],
          lastSession: base.lastSession,
        };
      }

      async function fromCache() {
        if (isMounted) setIsOffline(true);
        const cached = await getCached<HomeCache>(cacheKey);
        const base = cached ?? { weightLogs: [], waterLogs: [], photos: [], lastSession: null };
        const overlaid = await overlayHomeData(base);
        if (isMounted) {
          const ts = await getCachedAt(cacheKey);
          if (ts) setHomeCachedAt(ts);
          await applyData(overlaid.weightLogs, overlaid.waterLogs, overlaid.photos, overlaid.lastSession, today);
        }
      }

      // Always load from cache first (instant render), overlaid with anything
      // still queued for sync.
      await fromCache();

      if (userId === "guest-user") {
        hasFetched.current = true;
        return;
      }

      // Online: always fetch fresh data, then re-overlay the same pending ops
      // on top of it so an in-flight offline edit survives the refetch. Never
      // gated on the sync queue being empty — an unrelated pending op
      // elsewhere in the app must never block this page's refresh.
      try {
        const [
          { data: logs, error: logsErr },
          { data: water, error: waterErr },
          { data: pics, error: picsErr },
          { data: sess, error: sessErr },
        ] = await withTimeout(Promise.all([
          supabase.from("daily_weight_logs")
            .select("*").eq("user_id", userId)
            // Newest 90 — ascending + limit would return the *oldest* 90 and
            // hide every recent weigh-in once the history grows past that.
            .order("logged_date", { ascending: false }).limit(90),
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

        if (logsErr || waterErr || picsErr || sessErr) throw logsErr ?? waterErr ?? picsErr ?? sessErr;
        if (!isMounted) return;

        const rawWeightList = [...(logs ?? [])].reverse();
        const rawWaterList  = water ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const photoList  = (pics ?? []).map((p: any) => ({
          ...p,
          publicUrl: getStorageUrl("progress-photos", p.storage_path),
        }));
        const lastSess   = (sess as { session_date?: string } | null)?.session_date ?? null;

        // An empty-but-error-free response across every table may mean an expired
        // JWT filtered all rows via RLS (mid-refresh on a flaky reconnect) rather
        // than the account genuinely having no data — fall back to cache instead
        // of overwriting good local data with empty arrays.
        const existingCache = await getCached<HomeCache>(cacheKey);
        const hadCachedData = !!(existingCache && (
          existingCache.weightLogs.length || existingCache.waterLogs.length || existingCache.photos.length
        ));
        if (!rawWeightList.length && !rawWaterList.length && !photoList.length && hadCachedData) {
          hasFetched.current = true;
          if (isMounted) setLoading(false);
          return;
        }

        const overlaidFresh = await overlayHomeData({
          weightLogs: rawWeightList, waterLogs: rawWaterList, photos: photoList, lastSession: lastSess,
        });

        await setCache(cacheKey, overlaidFresh);
        if (isMounted) setIsOffline(false);
        hasFetched.current = true;
        await applyData(overlaidFresh.weightLogs, overlaidFresh.waterLogs, overlaidFresh.photos, overlaidFresh.lastSession, today);
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
  }, [refetchKey]);

  useEffect(() => {
    async function checkOnboarding() {
      const userId = await resolveUserId();
      if (!userId) return;

      const [nutrition, training] = await Promise.all([
        getCached<any>("auth:nutrition_targets"),
        getCached<any>(`training:${userId}`),
      ]);

      const hasNut = !!nutrition;
      const hasRot = !!training && training.folders && training.folders.length > 0;
      const hasWgt = weightLogs.some(l => l.logged_date === todayISO());

      setHasNutrition(hasNut);
      setHasRoutine(hasRot);
      
      const allDone = hasNut && hasRot && hasWgt;
      const dismissed = localStorage.getItem("gymtrack:checklist_dismissed") === "true";
      setShowChecklist(!allDone && !dismissed);
    }
    
    if (!loading) {
      checkOnboarding();
    }
  }, [loading, weightLogs, nutritionRefetchKey]);

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

  const onboardingPct = 40 + (hasNutrition ? 20 : 0) + (todayWeight ? 20 : 0) + (hasRoutine ? 20 : 0);

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

      {/* Onboarding progress checklist */}
      {showChecklist && (
        <div className="card-glass p-4 border border-[rgba(var(--accent-rgb),0.2)] animate-spring-up relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-[10px] text-[var(--accent)] font-bold tracking-widest uppercase font-mono">{t.home.onboarding.title}</p>
              <h3 className="text-md font-bold text-[var(--text)] mt-0.5">
                {t.home.onboarding.setupPrefix} <span className="metric font-extrabold text-[var(--accent)]">{onboardingPct}%</span> {t.home.onboarding.setupSuffix}
              </h3>
            </div>
            <button
              onClick={() => {
                localStorage.setItem("gymtrack:checklist_dismissed", "true");
                setShowChecklist(false);
              }}
              className="text-[var(--faint)] hover:text-[var(--muted)] text-[10px] font-bold font-mono tracking-wider uppercase border border-[var(--border)] rounded-lg px-2 py-1 transition-colors"
            >
              × {t.home.onboarding.dismiss}
            </button>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 w-full bg-[var(--border)] rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-[var(--accent)] shadow-[0_0_8px_rgba(var(--accent-rgb),0.4)] transition-all duration-500"
              style={{ width: `${onboardingPct}%` }}
            />
          </div>

          {/* List items */}
          <div className="space-y-2 text-xs text-[var(--muted)] font-medium">
            <div className="flex items-center gap-2 text-[var(--faint)]">
              <span className="text-[var(--accent)] text-sm font-semibold">✓</span>
              <span className="line-through">{t.home.onboarding.setupWorkspace} {t.home.onboarding.completedSuffix}</span>
            </div>
            <div className="flex items-center gap-2 text-[var(--faint)]">
              <span className="text-[var(--accent)] text-sm font-semibold">✓</span>
              <span className="line-through">{t.home.onboarding.initProfile} {t.home.onboarding.completedSuffix}</span>
            </div>

            {/* Nutrition task */}
            <button
              onClick={() => setCalcOpen(true)}
              className={cn(
                "flex items-center gap-2 w-full text-left hover:text-[var(--accent)] transition-colors",
                hasNutrition && "text-[var(--faint)] pointer-events-none"
              )}
            >
              {hasNutrition ? (
                <>
                  <span className="text-[var(--accent)] text-sm font-semibold">✓</span>
                  <span className="line-through">{t.home.onboarding.calcNutrition} {t.home.onboarding.completedSuffix}</span>
                </>
              ) : (
                <>
                  <span className="text-amber-500 text-sm font-bold animate-pulse-data">◈</span>
                  <span>{t.home.onboarding.calcNutritionAction} <span className="text-[var(--accent)] font-mono text-[10px] ml-1">{t.home.onboarding.percentSuffix}</span></span>
                </>
              )}
            </button>

            {/* Weight task */}
            <div
              className={cn(
                "flex items-center gap-2 text-left",
                todayWeight && "text-[var(--faint)]"
              )}
            >
              {todayWeight ? (
                <>
                  <span className="text-[var(--accent)] text-sm font-semibold">✓</span>
                  <span className="line-through">{t.home.onboarding.logWeight} {t.home.onboarding.completedSuffix}</span>
                </>
              ) : (
                <>
                  <span className="text-amber-500 text-sm font-bold animate-pulse-data">◈</span>
                  <span>{t.home.onboarding.logWeight} <span className="text-[var(--accent)] font-mono text-[10px] ml-1">{t.home.onboarding.percentSuffix}</span></span>
                </>
              )}
            </div>

            {/* Routine task */}
            <button
              onClick={() => {
                localStorage.setItem("gymtrack:open_routines_tab", "true");
                router.push("/training");
              }}
              className={cn(
                "flex items-center gap-2 w-full text-left hover:text-[var(--accent)] transition-colors",
                hasRoutine && "text-[var(--faint)] pointer-events-none"
              )}
            >
              {hasRoutine ? (
                <>
                  <span className="text-[var(--accent)] text-sm font-semibold">✓</span>
                  <span className="line-through">{t.home.onboarding.planRoutine} {t.home.onboarding.completedSuffix}</span>
                </>
              ) : (
                <>
                  <span className="text-amber-500 text-sm font-bold animate-pulse-data">◈</span>
                  <span>{t.home.onboarding.planRoutine} <span className="text-[var(--accent)] font-mono text-[10px] ml-1">{t.home.onboarding.percentSuffix}</span></span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <WeightLogger unit={unit} weightLogs={weightLogs} onSaved={onWeightSaved} />
      <WeightChart  logs={weightLogs} unit={unit} isOffline={isOffline} cachedAt={homeCachedAt} />
      
      {/* Nutrition Summary Card */}
      <NutritionDisplay
        onOpenCalculator={() => setCalcOpen(true)}
        refetchKey={nutritionRefetchKey}
      />

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

      {/* Nutrition Calculator Drawer */}
      <NutritionCalculator
        open={calcOpen}
        onClose={() => setCalcOpen(false)}
        weightUnit={unit}
        onApplied={() => setNutritionRefetchKey(prev => prev + 1)}
      />
    </div>
  );
}
