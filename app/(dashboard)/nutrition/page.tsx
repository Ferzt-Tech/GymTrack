"use client";

import { useEffect, useRef, useState } from "react";
import { todayISO, formatDate } from "@/lib/utils";
import { getDb } from "@/lib/db";
import { getCached, enqueue, getPendingUpsertsForTable, getPendingDeletesForTable, overlayUpserts } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { useT } from "@/lib/context/LanguageContext";
import { supabase } from "@/lib/supabase";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import { useProfile } from "@/lib/hooks/useProfile";
import { withTimeout } from "@/lib/auth-utils";
import NutritionCalculator from "@/components/settings/NutritionCalculator";
import FoodLoggerSheet from "@/components/nutrition/FoodLoggerSheet";
import type { FoodLog } from "@/types";

interface NutritionTargets {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  calculatedAt: string;
}

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealSlot = typeof MEAL_SLOTS[number];

export default function NutritionPage() {
  const t = useT();
  const { isOnline, syncState, triggerSync } = useOnlineSync();
  const { profile } = useProfile();
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState<NutritionTargets | null>(null);
  
  const [foodLogs, setFoodLogs] = useState<FoodLog[]>([]);
  const [refetchKey, setRefetchKey] = useState(0);
  
  // Sheet & Calculator States
  const [showCalculator, setShowCalculator] = useState(false);
  const [activeMealSlot, setActiveMealSlot] = useState<MealSlot | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const hasFetched = useRef(false);
  const today = todayISO();

  // 1. Load targets and food logs
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      const userId = await resolveUserId();
      if (!userId) {
        if (isMounted) setLoading(false);
        return;
      }

      // Load targets
      const cachedTargets = await getCached<NutritionTargets>("auth:nutrition_targets");
      if (isMounted) setTargets(cachedTargets);

      // Load food logs locally first
      const db = await getDb();
      let localLogs: FoodLog[] = [];
      if (db) {
        const allLogs = await db.getAll("food_logs");
        localLogs = allLogs.filter((l: any) => l.logged_date === today && l.user_id === userId);
      }

      // Apply local overlay (pending ops)
      const pendingUpserts = await getPendingUpsertsForTable("food_logs");
      const pendingDeletes = await getPendingDeletesForTable("food_logs");
      
      const activeDeletes = new Set(pendingDeletes.map((op: any) => op.value));
      const filteredLocal = localLogs.filter(l => !activeDeletes.has(l.id));
      
      let overlaid = overlayUpserts(filteredLocal as any[], pendingUpserts, "id") as any[] as FoodLog[];
      overlaid = overlaid.filter(l => l.logged_date === today && l.user_id === userId);

      if (isMounted) {
        setFoodLogs(overlaid);
        setLoading(false);
      }

      // If online and we haven't fetched from network on this key cycle, fetch from Supabase
      if (isOnline && userId !== "guest-user" && !hasFetched.current) {
        try {
          const { data, error } = await withTimeout(
            supabase
              .from("food_logs")
              .select("*")
              .eq("user_id", userId)
              .eq("logged_date", today)
          );

          if (error) throw error;

          if (data && isMounted) {
            // Update IndexedDB cache
            if (db) {
              // Delete old keys for today first to keep IndexedDB clean
              const tx = db.transaction("food_logs", "readwrite");
              const store = tx.objectStore("food_logs");
              const all = await store.getAll();
              for (const item of all) {
                if (item.logged_date === today && item.user_id === userId) {
                  await store.delete(item.id);
                }
              }
              // Save fresh data
              for (const item of data) {
                await store.put(item);
              }
              await tx.done;
            }

            // Refetch local overlaid data
            const freshLocal = (data as FoodLog[]).filter(l => !activeDeletes.has(l.id));
            const freshOverlaid = overlayUpserts(freshLocal as any[], pendingUpserts, "id") as any[] as FoodLog[];
            setFoodLogs(freshOverlaid.filter(l => l.logged_date === today));
          }
          hasFetched.current = true;
        } catch (err) {
          console.error("Failed to load food logs online, fallback to offline local logs:", err);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [refetchKey, isOnline, today]);

  // Sync state trigger listener
  useEffect(() => {
    if (syncState === "done") {
      hasFetched.current = false;
      setRefetchKey(prev => prev + 1);
    }
  }, [syncState]);

  // Trigger refetch manually
  const handleRefetch = () => {
    hasFetched.current = false;
    setRefetchKey(prev => prev + 1);
  };

  // Handle Log Deletion
  async function handleDeleteLog(id: string) {
    setIsDeleting(id);
    try {
      await enqueue({ type: "delete", table: "food_logs", column: "id", value: id });
      if (isOnline) triggerSync();
      handleRefetch();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(null);
    }
  }

  // Calculate Aggregates
  const totals = foodLogs.reduce(
    (acc, log) => {
      acc.calories += log.calories;
      acc.protein += log.protein_g;
      acc.carbs += log.carbs_g;
      acc.fats += log.fats_g;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  const roundedTotals = {
    calories: Math.round(totals.calories),
    protein: Math.round(totals.protein * 10) / 10,
    carbs: Math.round(totals.carbs * 10) / 10,
    fats: Math.round(totals.fats * 10) / 10,
  };

  // Circular gauge config
  const targetCal = targets?.calories ?? 2000;
  const eatenCal = roundedTotals.calories;
  const remainingCal = Math.max(0, targetCal - eatenCal);
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(1, eatenCal / targetCal);
  const strokeOffset = circumference - pct * circumference;

  if (loading) {
    return (
      <div className="p-4 space-y-4 max-w-xl mx-auto">
        <div className="skeleton h-40 w-full rounded-2xl animate-pulse" />
        <div className="skeleton h-14 w-full rounded-xl animate-pulse" />
        <div className="skeleton h-44 w-full rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-xl mx-auto pb-24">
      
      {/* 1. Header Block */}
      <div className="flex items-center justify-between animate-spring-up stagger-1">
        <div>
          <span className="text-[10px] text-[var(--accent)] font-mono tracking-widest uppercase">
            NUTRITION_DIARY.SYS
          </span>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text)] mt-0.5">
            {formatDate(today)}
          </h1>
        </div>
        
        <button
          onClick={() => setShowCalculator(true)}
          className="text-[10px] text-[var(--accent)] uppercase tracking-wider font-semibold font-mono hover:opacity-85 transition-opacity"
        >
          ⚙ Edit Targets
        </button>
      </div>

      {/* 2. Empty Targets State */}
      {!targets ? (
        <div className="card-glass p-6 text-center space-y-4 animate-spring-up stagger-2">
          <p className="text-sm text-[var(--sub)]">
            Configure your weight goals, biological settings, and calorie targets to initialize your diary.
          </p>
          <button
            type="button"
            onClick={() => setShowCalculator(true)}
            className="btn-aqua px-6 py-2.5 rounded-xl font-bold text-xs uppercase font-mono tracking-wider shadow-[0_0_15px_rgba(34,211,238,0.2)]"
          >
            {t.nutrition.calculateBtn}
          </button>
        </div>
      ) : (
        <>
          {/* 3. Instrument Calorie Dial & Macro Cards */}
          <div className="card-glass p-5 flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-around animate-spring-up stagger-2">
            
            {/* Custom SVG Ring Gauge */}
            <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="72"
                  cy="72"
                  r={radius}
                  stroke="var(--border)"
                  strokeWidth="8"
                  fill="transparent"
                  className="opacity-40"
                />
                <circle
                  cx="72"
                  cy="72"
                  r={radius}
                  stroke="var(--accent)"
                  strokeWidth="8"
                  fill="transparent"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeOffset}
                  strokeLinecap="round"
                  className="transition-all duration-500 ease-out"
                  style={{
                    filter: "drop-shadow(0 0 4px rgba(34, 211, 238, 0.4))"
                  }}
                />
              </svg>

              {/* Text overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[9px] text-[var(--faint)] uppercase tracking-wider font-mono">
                  {t.nutritionTracker.remaining}
                </span>
                <p className="text-2xl font-black metric text-[var(--text)] leading-none mt-1">
                  {remainingCal.toLocaleString()}
                </p>
                <span className="text-[8px] text-[var(--muted)] uppercase font-mono mt-1">
                  of {targetCal} kcal
                </span>
              </div>
            </div>

            {/* Macro Summary rings / bars */}
            <div className="w-full sm:flex-1 space-y-3.5 max-w-[220px]">
              
              {/* Protein Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono leading-none">
                  <span className="text-[var(--accent)] font-semibold uppercase">{t.nutritionTracker.protein}</span>
                  <span className="text-[var(--text)]">{roundedTotals.protein} / {targets.protein}g</span>
                </div>
                <div className="h-2 w-full bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (roundedTotals.protein / targets.protein) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Carbs Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono leading-none">
                  <span className="text-[rgb(var(--emerald-rgb))] font-semibold uppercase">{t.nutritionTracker.carbs}</span>
                  <span className="text-[var(--text)]">{roundedTotals.carbs} / {targets.carbs}g</span>
                </div>
                <div className="h-2 w-full bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[rgb(var(--emerald-rgb))] rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (roundedTotals.carbs / targets.carbs) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Fats Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono leading-none">
                  <span className="text-[rgb(var(--violet-rgb))] font-semibold uppercase">{t.nutritionTracker.fats}</span>
                  <span className="text-[var(--text)]">{roundedTotals.fats} / {targets.fats}g</span>
                </div>
                <div className="h-2 w-full bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[rgb(var(--violet-rgb))] rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (roundedTotals.fats / targets.fats) * 100)}%` }}
                  />
                </div>
              </div>

            </div>
          </div>

          {/* 4. Meal Categories list */}
          <div className="space-y-3 animate-spring-up stagger-3">
            {MEAL_SLOTS.map((slot) => {
              const logsForSlot = foodLogs.filter((log) => log.meal_type === slot);
              const slotCalories = Math.round(logsForSlot.reduce((sum, item) => sum + item.calories, 0));

              return (
                <div key={slot} className="card-glass overflow-hidden transition-all duration-200">
                  
                  {/* Category Header */}
                  <div className="flex items-center justify-between p-3.5 bg-[#0a0a0a]/30 border-b border-[var(--border-subtle)]">
                    <div>
                      <h3 className="text-xs font-bold text-[var(--text)] uppercase font-mono tracking-wider">
                        ◈ {t.nutritionTracker[slot]}
                      </h3>
                      <p className="text-[9px] text-[var(--faint)] font-mono uppercase mt-0.5">
                        {logsForSlot.length} logged
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold font-mono text-[var(--text)] metric">
                        {slotCalories} kcal
                      </span>
                      
                      <button
                        type="button"
                        onClick={() => setActiveMealSlot(slot)}
                        className="w-7 h-7 rounded-lg bg-[var(--border)] hover:bg-[var(--border-subtle)] flex items-center justify-center text-xs font-bold transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Meal entries list */}
                  {logsForSlot.length === 0 ? (
                    <div className="p-4 text-center text-[10px] text-[var(--faint)]">
                      {t.nutritionTracker.emptyMeals}
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--border-subtle)]">
                      {logsForSlot.map((log) => (
                        <div key={log.id} className="p-3 flex items-center justify-between gap-3 text-xs">
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <p className="font-semibold text-[var(--text)] truncate">{log.food_name}</p>
                            <p className="text-[9px] text-[var(--faint)] font-mono leading-none">
                              {log.weight_g ? `${log.weight_g}g · ` : ""}{log.protein_g}P · {log.carbs_g}C · {log.fats_g}F
                            </p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-semibold font-mono text-[var(--text)] metric">
                              {Math.round(log.calories)} kcal
                            </span>
                            
                            <button
                              type="button"
                              onClick={() => handleDeleteLog(log.id)}
                              disabled={isDeleting === log.id}
                              className="text-red-400/70 hover:text-red-400 p-1 text-sm font-semibold transition-colors leading-none"
                            >
                              {isDeleting === log.id ? "…" : "×"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 5. Sub-Modals & Sheets */}
      <NutritionCalculator
        open={showCalculator}
        onClose={() => {
          setShowCalculator(false);
          handleRefetch();
        }}
        weightUnit={profile?.weight_unit ?? "kg"}
      />

      {activeMealSlot && (
        <FoodLoggerSheet
          open={!!activeMealSlot}
          onClose={() => setActiveMealSlot(null)}
          mealType={activeMealSlot}
          loggedDate={today}
          onSaved={handleRefetch}
        />
      )}

    </div>
  );
}
