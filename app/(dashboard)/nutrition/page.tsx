"use client";

import { useEffect, useRef, useState } from "react";
import { format, subDays, parseISO } from "date-fns";
import { todayISO, formatDate, cn } from "@/lib/utils";
import { getDb } from "@/lib/db";
import { getCached, enqueue, getPendingUpsertsForTable, getPendingDeletesForTable, overlayUpserts, getRecentFoodLogs } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { useT } from "@/lib/context/LanguageContext";
import { supabase } from "@/lib/supabase";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import { useNav } from "@/lib/context/NavContext";
import { useProfile } from "@/lib/hooks/useProfile";
import { withTimeout } from "@/lib/auth-utils";
import { scaleDetail } from "@/lib/nutrition";
import {
  buildSavedFood,
  findSavedMatch,
  savedBasisGrams,
  scaledFavorite,
  sortFavorites,
  toDetailFood,
} from "@/lib/savedFoods";
import { offSearchProducts, type OffItem } from "@/lib/openFoodFacts";
import NutritionCalculator from "@/components/settings/NutritionCalculator";
import FoodLoggerSheet from "@/components/nutrition/FoodLoggerSheet";
import FoodRow from "@/components/nutrition/FoodRow";
import FoodDetailSheet from "@/components/nutrition/FoodDetailSheet";
import FavoritesView from "@/components/nutrition/FavoritesView";
import RecipeManager from "@/components/nutrition/RecipeManager";
import AdaptiveTdeeCard from "@/components/nutrition/AdaptiveTdeeCard";
import { MacroSummary } from "@/components/nutrition/NutritionFacts";
import WeeklyTrendChart, { type DayCalories } from "@/components/nutrition/WeeklyTrendChart";
import type { DetailFood, FoodLog, SavedFood } from "@/types";

interface NutritionTargets {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  calculatedAt: string;
}

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealSlot = typeof MEAL_SLOTS[number];

/** Rows shown per quick-add tab. Quick add is a shortcut, not a browser — past
 *  five entries it stops being scannable and the full favorites subpage (or the
 *  logger sheet) is the right surface. */
const QUICK_ADD_LIMIT = 5;

/** Sensible default meal slot for a page-level quick-add, based on time of day. */
function defaultMealByTime(): MealSlot {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export default function NutritionPage() {
  const t = useT();
  const { isOnline, syncState, triggerSync } = useOnlineSync();
  const { setNavHidden } = useNav();
  const { profile } = useProfile();
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState<NutritionTargets | null>(null);
  
  const [foodLogs, setFoodLogs] = useState<FoodLog[]>([]);
  const [favorites, setFavorites] = useState<SavedFood[]>([]);
  const [recentFoods, setRecentFoods] = useState<FoodLog[]>([]);
  const [weeklyTrend, setWeeklyTrend] = useState<DayCalories[]>([]);
  const [refetchKey, setRefetchKey] = useState(0);

  // Quick-add detail sheet (meal chosen in-sheet) — shared by the favorites
  // banner and the recent/saved/search quick-add tabs below.
  const [favDetail, setFavDetail] = useState<DetailFood | null>(null);
  const [favMeal, setFavMeal] = useState<MealSlot>("breakfast");
  const [showFavorites, setShowFavorites] = useState(false);
  const [showRecipes, setShowRecipes] = useState(false);

  // Quick-add browse tabs (recent / saved / search database)
  const [browseTab, setBrowseTab] = useState<"recent" | "saved" | "search">("recent");
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseResults, setBrowseResults] = useState<OffItem[]>([]);
  const [browseSearching, setBrowseSearching] = useState(false);
  const [browseSearched, setBrowseSearched] = useState(false);

  // Sheet & Calculator States
  const [showCalculator, setShowCalculator] = useState(false);
  const [activeMealSlot, setActiveMealSlot] = useState<MealSlot | null>(null);
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null);
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

        // 7-day trend — derived from the same local table, whatever history has
        // accumulated on this device (no extra network query, works fully offline).
        const sevenDayLabels: string[] = [];
        for (let i = 6; i >= 0; i--) sevenDayLabels.push(format(subDays(parseISO(today), i), "yyyy-MM-dd"));
        const calByDate = (allLogs as FoodLog[])
          .filter((l) => l.user_id === userId && sevenDayLabels.includes(l.logged_date))
          .reduce<Record<string, number>>((acc, l) => {
            acc[l.logged_date] = (acc[l.logged_date] ?? 0) + l.calories;
            return acc;
          }, {});
        if (isMounted) {
          setWeeklyTrend(
            sevenDayLabels
              .filter((dateStr) => calByDate[dateStr] != null)
              .map((dateStr) => ({
                day: format(parseISO(dateStr), "EEE"),
                calories: Math.round(calByDate[dateStr]),
              }))
          );
        }
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

      // Favorites (saved_foods) — local-first read + pending-ops overlay
      if (db) {
        const allFav = await db.getAll("saved_foods");
        const favUpserts = await getPendingUpsertsForTable("saved_foods");
        const favDeletes = await getPendingDeletesForTable("saved_foods");
        const favDel = new Set(favDeletes.map((op: any) => op.value));
        let favList = (allFav as SavedFood[]).filter(f => f.user_id === userId && !favDel.has(f.id));
        favList = overlayUpserts(favList as any[], favUpserts, "id") as any[] as SavedFood[];
        favList = favList.filter(f => f.user_id === userId);
        // Newest first, so the five surfaced in quick add are the freshest saves.
        if (isMounted) setFavorites(sortFavorites(favList));
      }

      // Recent foods — most-recently-logged distinct items, for the quick-add tabs.
      // Explicit limit: the logger sheet's own recent row still wants its default 8.
      const recent = await getRecentFoodLogs(userId, 30, QUICK_ADD_LIMIT);
      if (isMounted) setRecentFoods(recent);

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

  // Centralize bottom-nav hiding for this page's overlays. The favorites detail
  // sheet stacks on top of the favorites subpage, and each overlay toggles
  // navHidden on its own; this parent effect runs after the children and always
  // asserts the correct final value (so closing the top sheet doesn't reveal the
  // nav bar while the subpage is still open).
  useEffect(() => {
    setNavHidden(showFavorites || showRecipes || !!favDetail || !!activeMealSlot || !!editingLog || showCalculator);
    return () => setNavHidden(false);
  }, [showFavorites, showRecipes, favDetail, activeMealSlot, editingLog, showCalculator, setNavHidden]);

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

  // Open the quick-add detail sheet (meal chosen in-sheet, defaulted by time of day).
  // Shared by the favorites banner/tab, the recent-foods tab, and the search tab below.
  function showQuickDetail(food: DetailFood) {
    setFavMeal(defaultMealByTime());
    setFavDetail(food);
  }

  function openFavDetail(fav: SavedFood) {
    // toDetailFood carries the favorite's saved basis as preferredPortionG, so a
    // food saved as a whole 473 g can reopens showing that can, not 100 g of it.
    showQuickDetail(toDetailFood(fav));
  }

  // A food_logs row stores totals for whatever weight was logged, not per-100g —
  // rescale to a per-100g basis so the detail sheet's portion picker behaves the
  // same as it does for saved/search items.
  function openRecentDetail(log: FoodLog) {
    const w = log.weight_g && log.weight_g > 0 ? log.weight_g : 100;
    const ratio = 100 / w;
    showQuickDetail({
      key: log.id,
      name: log.food_name,
      brand: log.detail?.brand ?? null,
      category: log.detail?.category ?? null,
      cal100: Math.round(log.calories * ratio * 10) / 10,
      protein100: Math.round(log.protein_g * ratio * 10) / 10,
      carbs100: Math.round(log.carbs_g * ratio * 10) / 10,
      fats100: Math.round(log.fats_g * ratio * 10) / 10,
      detail: scaleDetail(log.detail, ratio),
      defaultWeightG: w,
      preferredPortionG: w, // re-logging should default to the weight last eaten
    });
  }

  function openSearchDetail(item: OffItem) {
    showQuickDetail({
      key: item.id,
      name: item.name,
      brand: item.brand,
      category: item.category,
      cal100: item.calories100g,
      protein100: item.protein100g,
      carbs100: item.carbs100g,
      fats100: item.fats100g,
      detail: item.detail,
      defaultWeightG: item.servingGrams ?? 100,
    });
  }

  async function handleBrowseSearch() {
    const q = browseQuery.trim();
    if (!q || !isOnline) return;
    setBrowseSearching(true);
    setBrowseSearched(true);
    try {
      setBrowseResults(await offSearchProducts(q));
    } catch (err) {
      console.error("Nutrition quick-add search error:", err);
      setBrowseResults([]);
    } finally {
      setBrowseSearching(false);
    }
  }

  const favIsFavorite = favDetail ? !!findSavedMatch(favorites, favDetail) : false;

  // Remove a favorite from the favorites subpage.
  async function removeFavorite(fav: SavedFood) {
    await enqueue({ type: "delete", table: "saved_foods", column: "id", value: fav.id });
    if (isOnline) triggerSync();
    setFavorites(prev => prev.filter(f => f.id !== fav.id));
  }

  async function handleAddFav(portionG: number) {
    if (!favDetail) return;
    const ratio = portionG / 100;
    const userId = await resolveUserId();
    if (!userId) return;
    await enqueue({
      type: "upsert",
      table: "food_logs",
      payload: {
        id: crypto.randomUUID(),
        user_id: userId,
        logged_date: today,
        meal_type: favMeal,
        food_name: favDetail.brand ? `${favDetail.name} (${favDetail.brand})` : favDetail.name,
        calories: Math.round(favDetail.cal100 * ratio * 10) / 10,
        protein_g: Math.round(favDetail.protein100 * ratio * 10) / 10,
        carbs_g: Math.round(favDetail.carbs100 * ratio * 10) / 10,
        fats_g: Math.round(favDetail.fats100 * ratio * 10) / 10,
        weight_g: Math.round(portionG * 10) / 10,
        detail: scaleDetail(favDetail.detail, ratio),
        created_at: new Date().toISOString(),
      },
    });
    if (isOnline) triggerSync();
    setFavDetail(null);
    handleRefetch();
  }

  // Heart toggle from the detail sheet — remove, or save at the portion the sheet
  // is currently showing (so "the whole 473 g can" is one tap, not per-100g math).
  async function handleToggleFav(basisGrams: number) {
    if (!favDetail) return;
    const userId = await resolveUserId();
    if (!userId) return;
    const existing = findSavedMatch(favorites, favDetail);
    if (existing) {
      await enqueue({ type: "delete", table: "saved_foods", column: "id", value: existing.id });
      if (isOnline) triggerSync();
      setFavorites(prev => prev.filter(f => f.id !== existing.id));
    } else {
      const newFav = buildSavedFood(favDetail, basisGrams, userId);
      await enqueue({ type: "upsert", table: "saved_foods", payload: { ...newFav } });
      if (isOnline) triggerSync();
      setFavorites(prev => sortFavorites([...prev, newFav]));
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

  const targetCal = targets?.calories ?? 2000;
  const remainingCal = Math.max(0, targetCal - roundedTotals.calories);

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

      {/* 1b. 7-Day Trend */}
      {weeklyTrend.length > 0 && (
        <div className="card-glass p-4 animate-spring-up stagger-2">
          <p className="section-label">{t.nutritionTracker.weeklyTrendTitle}</p>
          <p className="text-[11px] text-[var(--faint)] -mt-2 mb-2">{t.nutritionTracker.weeklyTrendSub}</p>
          <WeeklyTrendChart data={weeklyTrend} targetCalories={targets?.calories ?? null} />
        </div>
      )}

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
          {/* 3. Today's Summary — 4 macro tiles + calorie-% distribution bar */}
          <div className="card-glass p-4 animate-spring-up stagger-2">
            <div className="flex items-baseline justify-between mb-3">
              <p className="section-label !mb-0">{t.nutritionTracker.todaySummary}</p>
              <span className="text-[10px] text-[var(--faint)] font-mono uppercase">
                {t.nutritionTracker.remaining} {remainingCal.toLocaleString()} / {targetCal} kcal
              </span>
            </div>
            <MacroSummary
              calories={roundedTotals.calories}
              protein={roundedTotals.protein}
              carbs={roundedTotals.carbs}
              fats={roundedTotals.fats}
            />
          </div>

          {/* 3a. Adaptive TDEE — expenditure measured from the trend, not predicted */}
          <div className="animate-spring-up stagger-2">
            <AdaptiveTdeeCard
              unit={profile?.weight_unit ?? "kg"}
              refetchKey={refetchKey}
              onTargetsApplied={handleRefetch}
            />
          </div>

          {/* 3b. Quick add — recent / saved / search, add to any meal without leaving the page */}
          <div className="card-glass p-4 space-y-3 animate-spring-up stagger-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="section-label !mb-0">{t.nutritionTracker.quickAddTitle}</p>
              <button
                type="button"
                onClick={() => setShowRecipes(true)}
                className="text-[10px] text-[var(--accent)] uppercase tracking-wider font-semibold font-mono hover:opacity-85 transition-opacity shrink-0"
              >
                ◈ {t.recipes.title} →
              </button>
            </div>

            <div className="flex bg-[#080808]/40 border border-[var(--border)] rounded-2xl p-1">
              {(["recent", "saved", "search"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setBrowseTab(tab)}
                  className={cn(
                    "flex-1 py-2 text-xs font-semibold rounded-xl transition-all duration-200",
                    browseTab === tab
                      ? "bg-[var(--accent)] text-[#041a1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] font-bold"
                      : "text-[var(--sub)] hover:text-[var(--muted)]"
                  )}
                >
                  {tab === "recent" && t.nutritionTracker.recentTitle}
                  {tab === "saved" && t.nutritionTracker.savedLog}
                  {tab === "search" && t.nutritionTracker.searchLog}
                </button>
              ))}
            </div>

            {browseTab === "recent" && (
              recentFoods.length === 0 ? (
                <p className="text-xs text-[var(--muted)] text-center py-6 leading-relaxed">
                  {t.nutritionTracker.recentEmpty}
                </p>
              ) : (
                <div className="space-y-2">
                  {recentFoods.map((log) => (
                    <FoodRow
                      key={log.id}
                      name={log.food_name}
                      brand={log.detail?.brand}
                      basis={log.weight_g ? t.nutritionTracker.perBasis(log.weight_g) : null}
                      kcal={log.calories}
                      onClick={() => openRecentDetail(log)}
                    />
                  ))}
                </div>
              )
            )}

            {browseTab === "saved" && (
              favorites.length === 0 ? (
                <p className="text-xs text-[var(--muted)] text-center py-6 leading-relaxed">
                  {t.nutritionTracker.savedEmpty}
                </p>
              ) : (
                <div className="space-y-2">
                  {favorites.slice(0, QUICK_ADD_LIMIT).map((fav) => {
                    const basisG = savedBasisGrams(fav);
                    return (
                      <FoodRow
                        key={fav.id}
                        name={fav.name}
                        brand={fav.detail?.brand}
                        basis={t.nutritionTracker.perBasis(basisG)}
                        kcal={scaledFavorite(fav, basisG).calories}
                        onClick={() => openFavDetail(fav)}
                      />
                    );
                  })}

                  {/* The only route to the full favorites subpage now that the
                      standalone banner is gone — always offered, so favorites
                      stay reachable even when five or fewer are saved. */}
                  <button
                    type="button"
                    onClick={() => setShowFavorites(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold font-mono uppercase tracking-wide text-[var(--accent)] hover:opacity-80 transition-opacity"
                  >
                    {t.nutritionTracker.favoritesBrowseAll(favorites.length)}
                    <span className="text-[var(--faint)]">→</span>
                  </button>
                </div>
              )
            )}

            {browseTab === "search" && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={t.nutritionTracker.searchPlaceholder}
                    value={browseQuery}
                    onChange={(e) => setBrowseQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleBrowseSearch()}
                    className="input-base flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseSearch}
                    disabled={browseSearching || !browseQuery.trim() || !isOnline}
                    className="btn-aqua px-4 text-xs font-semibold shrink-0"
                  >
                    {browseSearching ? "…" : t.nutritionTracker.searchBtn}
                  </button>
                </div>

                {!isOnline && (
                  <p className="text-[10px] text-amber-400">{t.nutritionTracker.searchOfflineNote}</p>
                )}

                {browseSearching && <div className="skeleton h-16 w-full rounded-xl" />}

                {!browseSearching && browseResults.length > 0 && (
                  <div className="space-y-2">
                    {browseResults.slice(0, QUICK_ADD_LIMIT).map((item) => (
                      <FoodRow
                        key={item.id}
                        name={item.name}
                        brand={item.brand}
                        basis={t.nutritionTracker.perBasis(100)}
                        kcal={item.calories100g}
                        tag={item.category}
                        onClick={() => openSearchDetail(item)}
                      />
                    ))}
                    {browseResults.length > QUICK_ADD_LIMIT && (
                      <p className="text-[10px] text-[var(--faint)] font-mono uppercase text-center pt-1">
                        {t.nutritionTracker.searchMoreResults(browseResults.length - QUICK_ADD_LIMIT)}
                      </p>
                    )}
                  </div>
                )}

                {!browseSearching && browseSearched && browseResults.length === 0 && (
                  <p className="text-xs text-[var(--muted)] text-center py-4">
                    {t.nutritionTracker.searchNoResults}
                  </p>
                )}
              </div>
            )}
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
                          <button
                            type="button"
                            onClick={() => setEditingLog(log)}
                            className="space-y-0.5 min-w-0 flex-1 text-left"
                          >
                            <p className="font-semibold text-[var(--text)] truncate">{log.food_name}</p>
                            <p className="text-[9px] text-[var(--faint)] font-mono leading-none">
                              {log.weight_g ? `${log.weight_g}g · ` : ""}{log.protein_g}P · {log.carbs_g}C · {log.fats_g}F
                            </p>
                          </button>

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

      {/* Floating quick-add button — opens the full logger sheet for whichever
          meal fits the current time of day, without scrolling to that meal's card. */}
      {targets && (
        <button
          type="button"
          onClick={() => setActiveMealSlot(defaultMealByTime())}
          aria-label={t.nutritionTracker.addFood}
          className="fixed z-40 right-6 h-14 w-14 rounded-full bg-[var(--accent)] text-[#041a1f] flex items-center justify-center text-2xl font-bold shadow-[0_8px_24px_rgba(var(--accent-rgb),0.35)] active:scale-95 transition-transform"
          style={{ bottom: "max(7rem, calc(env(safe-area-inset-bottom) + 6.5rem))" }}
        >
          +
        </button>
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

      {(activeMealSlot || editingLog) && (
        <FoodLoggerSheet
          open={!!(activeMealSlot || editingLog)}
          onClose={() => { setActiveMealSlot(null); setEditingLog(null); }}
          mealType={(editingLog?.meal_type ?? activeMealSlot) as MealSlot}
          loggedDate={today}
          editingLog={editingLog}
          onSaved={handleRefetch}
        />
      )}

      {/* Recipes subpage — batch recipes with raw→cooked yield conversion */}
      <RecipeManager
        open={showRecipes}
        onClose={() => setShowRecipes(false)}
        favorites={favorites}
        defaultMeal={defaultMealByTime()}
        onLogged={handleRefetch}
      />

      {/* Favorites subpage — browse all favorites + full nutrition */}
      <FavoritesView
        open={showFavorites}
        favorites={favorites}
        onClose={() => setShowFavorites(false)}
        onAddToDiary={openFavDetail}
        onRemove={removeFavorite}
      />

      {/* Favorites quick-add detail sheet (meal picked in-sheet) */}
      <FoodDetailSheet
        open={!!favDetail}
        food={favDetail}
        mealLabel={t.nutritionTracker[favMeal]}
        isFavorite={favIsFavorite}
        onAdd={handleAddFav}
        onToggleFavorite={handleToggleFav}
        onClose={() => setFavDetail(null)}
        mealSelector={
          <div>
            <label className="text-[10px] text-[var(--faint)] font-mono uppercase tracking-wide">
              {t.nutritionTracker.mealTypeLabel}
            </label>
            <div className="flex border border-[var(--border)] rounded-xl overflow-hidden mt-1">
              {MEAL_SLOTS.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setFavMeal(slot)}
                  className={cn(
                    "flex-1 py-2 text-[11px] font-semibold transition-all",
                    favMeal === slot
                      ? "bg-[var(--accent)] text-[#041a1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                      : "text-[var(--sub)] hover:text-[var(--muted)]"
                  )}
                >
                  {t.nutritionTracker[slot]}
                </button>
              ))}
            </div>
          </div>
        }
      />

    </div>
  );
}
