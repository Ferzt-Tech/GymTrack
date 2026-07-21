"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { enqueue } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { useT } from "@/lib/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import { useNav } from "@/lib/context/NavContext";
import { analyzeMealWithAI, type FoodItemEstimate } from "@/lib/foodAi";
import { canUseAiScanner } from "@/lib/devMode";
import { scaleByWeight } from "@/lib/nutrition";
import { getDb } from "@/lib/db";
import type { FoodLog, SavedFood } from "@/types";
import BarcodeScanner from "./BarcodeScanner";

interface Props {
  open: boolean;
  onClose: () => void;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  loggedDate: string;
  onSaved: () => void;
  /** When set, the sheet edits this existing log in place instead of creating a new one. */
  editingLog?: FoodLog | null;
}

type Tab = "manual" | "search" | "saved" | "ai";
type MealType = "breakfast" | "lunch" | "dinner" | "snack";

interface MacroBasis { weightG: number; calories: number; protein: number; carbs: number; fats: number; }

/* ── Open Food Facts helpers ──
   Product-by-barcode uses the world endpoint (barcodes are global). Text
   search uses the modern Search-a-licious API filtered to the Mexican
   market first, so Mexican supermarket products (Lala, Bimbo, Santa Clara,
   Alpura…) rank before international ones. The legacy cgi/search.pl is
   kept only as a last-resort fallback — it is frequently "temporarily
   unavailable". */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOffProduct(p: any, fallbackId: string) {
  const nut = p.nutriments || {};
  let cal = parseFloat(nut["energy-kcal_100g"]) || parseFloat(nut["energy-kcal"]) || 0;
  if (cal === 0 && (nut["energy-kj_100g"] || nut["energy-kj"])) {
    const kj = parseFloat(nut["energy-kj_100g"]) || parseFloat(nut["energy-kj"]) || 0;
    cal = Math.round(kj / 4.184);
  }
  // brands is a string in the legacy/v2 APIs but an array in Search-a-licious
  const brand = Array.isArray(p.brands)
    ? (p.brands[0] ?? null)
    : (p.brands ? String(p.brands).split(",")[0] : null);
  return {
    id: p.code || fallbackId,
    name: p.product_name_es || p.product_name || `Producto (${fallbackId})`,
    brand,
    calories100g: cal,
    protein100g: parseFloat(nut.proteins_100g) || 0,
    carbs100g: parseFloat(nut.carbohydrates_100g) || 0,
    fats100g: parseFloat(nut.fat_100g) || 0,
    servingSize: p.serving_size || null,
  };
}

type OffItem = ReturnType<typeof mapOffProduct>;

/** A product with all-zero nutriments is an incomplete OFF entry — logging it
    would silently corrupt the daily totals with fake zeros. */
function hasNutritionData(item: OffItem): boolean {
  return item.calories100g > 0 || item.protein100g > 0 || item.carbs100g > 0 || item.fats100g > 0;
}

/** Parse the package serving size ("30 g", "250ml", "2 rebanadas (56 g)") into grams.
    ml is treated 1:1 as grams (exact for water-based drinks, close for most). */
function parseServingGrams(servingSize: string | null): number | null {
  if (!servingSize) return null;
  const m = servingSize.match(/(\d+(?:[.,]\d+)?)\s*(g|ml)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

const SEARCH_FIELDS = "code,product_name,product_name_es,brands,nutriments,serving_size";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchALicious(query: string): Promise<any[] | null> {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&langs=es&page_size=20&fields=${SEARCH_FIELDS}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.hits || [];
}

async function offSearchProducts(query: string): Promise<ReturnType<typeof mapOffProduct>[]> {
  // 1. Mexican market first
  try {
    const mxHits = await searchALicious(`${query} countries_tags:"en:mexico"`);
    if (mxHits) {
      const mxItems = mxHits
        .map((p) => mapOffProduct(p, p.code || crypto.randomUUID()))
        .filter(hasNutritionData);
      if (mxItems.length > 0) return mxItems;
    }
    // 2. Worldwide (imported / international foods)
    const worldHits = await searchALicious(query);
    if (worldHits) {
      const worldItems = worldHits
        .map((p) => mapOffProduct(p, p.code || crypto.randomUUID()))
        .filter(hasNutritionData);
      if (worldItems.length > 0) return worldItems;
    }
  } catch (err) {
    console.warn("Search-a-licious failed, falling back to legacy search:", err);
  }
  // 3. Legacy fallback (only if the new API is down)
  const params = `search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=true&page_size=20&sort_by=unique_scans_n&lc=es`;
  const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`);
  if (res.ok) {
    try {
      const data = await res.json();
      return (data.products || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => mapOffProduct(p, p.code || crypto.randomUUID()))
        .filter(hasNutritionData);
    } catch { /* endpoint returned an HTML error page */ }
  }
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function offProductByBarcode(barcode: string): Promise<ReturnType<typeof mapOffProduct> | null> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return mapOffProduct(data.product, barcode);
}

export default function FoodLoggerSheet({ open, onClose, mealType, loggedDate, onSaved, editingLog }: Props) {
  const t = useT();
  const { triggerSync, isOnline } = useOnlineSync();
  const { setNavHidden } = useNav();
  const isEditing = !!editingLog;

  // Hide bottom navigation bar when logger sheet is open
  useEffect(() => {
    if (open) {
      setNavHidden(true);
    } else {
      setNavHidden(false);
    }
    return () => setNavHidden(false);
  }, [open, setNavHidden]);
  const [activeTab, setActiveTab] = useState<Tab>("manual");
  
  // Manual / Quick Entry Form States
  const [foodName, setFoodName] = useState("");
  const [weightG, setWeightG] = useState("");
  const [calories, setCalories] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatsG, setFatsG] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [manualNotice, setManualNotice] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState<"total" | "per100g">("total");
  const [saveFavorite, setSaveFavorite] = useState(false);

  // Edit-mode states
  const [editMealType, setEditMealType] = useState<MealType>(mealType);
  const [refBasis, setRefBasis] = useState<MacroBasis | null>(null);

  // Database / Barcode Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [portionSizes, setPortionSizes] = useState<Record<string, string>>({}); // id -> portion in grams
  const [favoritedIds, setFavoritedIds] = useState<Record<string, boolean>>({});

  // Saved Foods (favorites) states
  const [savedFoods, setSavedFoods] = useState<SavedFood[]>([]);
  const [savedSearch, setSavedSearch] = useState("");
  const [savedPortionSizes, setSavedPortionSizes] = useState<Record<string, string>>({});
  const [deletingFavoriteId, setDeletingFavoriteId] = useState<string | null>(null);

  // Recent foods (derived from food_logs, no new storage)
  const [recentFoods, setRecentFoods] = useState<FoodLog[]>([]);

  // AI Meal Scanner States
  const [aiText, setAiText] = useState("");
  const [aiImagePreview, setAiImagePreview] = useState<string | null>(null);
  const [aiImageBase64, setAiImageBase64] = useState<string | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiEstimates, setAiEstimates] = useState<FoodItemEstimate[]>([]);
  const [aiOriginals, setAiOriginals] = useState<FoodItemEstimate[]>([]);
  const [aiSelected, setAiSelected] = useState<Record<number, boolean>>({}); // index -> selected
  const [aiError, setAiError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Developer-only AI tab (allowlisted account + dev toggle enabled)
  const [aiAvailable, setAiAvailable] = useState(false);
  useEffect(() => {
    if (!open) return;
    let isMounted = true;
    canUseAiScanner().then(v => { if (isMounted) setAiAvailable(v); });
    return () => { isMounted = false; };
  }, [open]);

  // Reset states on open/close (and prefill when editing an existing log)
  useEffect(() => {
    if (open) {
      setActiveTab("manual");
      setManualMode("total");
      setSaveFavorite(false);
      setSearchQuery("");
      setSearchResults([]);
      setScanning(false);
      setFavoritedIds({});
      setSavedSearch("");
      setSavedPortionSizes({});
      setAiText("");
      setAiImagePreview(null);
      setAiImageBase64(null);
      setAiEstimates([]);
      setAiOriginals([]);
      setAiSelected({});
      setAiError(null);
      setSaveError(null);
      setManualNotice(null);

      if (editingLog) {
        setFoodName(editingLog.food_name);
        setWeightG(editingLog.weight_g != null ? String(editingLog.weight_g) : "");
        setCalories(String(editingLog.calories));
        setProteinG(String(editingLog.protein_g));
        setCarbsG(String(editingLog.carbs_g));
        setFatsG(String(editingLog.fats_g));
        setEditMealType(editingLog.meal_type);
        setRefBasis(
          editingLog.weight_g != null
            ? {
                weightG: editingLog.weight_g,
                calories: editingLog.calories,
                protein: editingLog.protein_g,
                carbs: editingLog.carbs_g,
                fats: editingLog.fats_g,
              }
            : null
        );
      } else {
        setFoodName("");
        setWeightG("");
        setCalories("");
        setProteinG("");
        setCarbsG("");
        setFatsG("");
        setEditMealType(mealType);
        setRefBasis(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingLog]);

  // Load Saved Foods (favorites) + Recent foods on open — pure local reads, no network.
  useEffect(() => {
    if (!open) return;
    let isMounted = true;

    (async () => {
      const userId = await resolveUserId();
      if (!userId || !isMounted) return;

      const db = await getDb();
      if (!db) return;

      const allSaved = await db.getAll("saved_foods");
      if (isMounted) {
        setSavedFoods((allSaved as SavedFood[]).filter(f => f.user_id === userId));
      }

      if (!isEditing) {
        const allLogs = await db.getAll("food_logs");
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

        const byName = new Map<string, FoodLog>();
        (allLogs as FoodLog[])
          .filter(l => l.user_id === userId && l.logged_date >= cutoff)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .forEach(l => {
            if (!byName.has(l.food_name)) byName.set(l.food_name, l);
          });

        if (isMounted) setRecentFoods(Array.from(byName.values()).slice(0, 8));
      }
    })();

    return () => { isMounted = false; };
  }, [open, isEditing]);

  // In "Per 100g" mode the four macro fields hold per-100g values; the actual
  // logged totals are derived from weightG at submit/preview time. In "Total"
  // mode (and always while editing) the fields already hold the final totals.
  const manualWeightNum = parseFloat(weightG) || 0;
  const usingPer100g = manualMode === "per100g" && !isEditing;
  const manualTotals = {
    calories: usingPer100g ? scaleByWeight(100, manualWeightNum, parseFloat(calories) || 0) : (parseFloat(calories) || 0),
    protein:  usingPer100g ? scaleByWeight(100, manualWeightNum, parseFloat(proteinG) || 0) : (parseFloat(proteinG) || 0),
    carbs:    usingPer100g ? scaleByWeight(100, manualWeightNum, parseFloat(carbsG) || 0)   : (parseFloat(carbsG) || 0),
    fats:     usingPer100g ? scaleByWeight(100, manualWeightNum, parseFloat(fatsG) || 0)    : (parseFloat(fatsG) || 0),
  };

  // Editing an existing weight: rescale macros from the log's original snapshot
  // instead of leaving them untouched (or cascading off already-rounded values).
  function handleEditWeightChange(nextWeightStr: string) {
    setWeightG(nextWeightStr);
    if (!refBasis) return;
    const nextWeight = parseFloat(nextWeightStr) || 0;
    setCalories(String(scaleByWeight(refBasis.weightG, nextWeight, refBasis.calories)));
    setProteinG(String(scaleByWeight(refBasis.weightG, nextWeight, refBasis.protein)));
    setCarbsG(String(scaleByWeight(refBasis.weightG, nextWeight, refBasis.carbs)));
    setFatsG(String(scaleByWeight(refBasis.weightG, nextWeight, refBasis.fats)));
  }

  // Handle Manual Log Submission (create or, when editing, update in place)
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!foodName.trim() || !calories) return;
    setSaving(true);

    try {
      const userId = await resolveUserId();
      if (!userId) {
        setSaving(false);
        return;
      }

      const weightNum = weightG ? parseFloat(weightG) : null;

      const payload = editingLog
        ? {
            id: editingLog.id,
            user_id: editingLog.user_id,
            logged_date: editingLog.logged_date,
            meal_type: editMealType,
            food_name: foodName.trim(),
            calories: manualTotals.calories,
            protein_g: manualTotals.protein,
            carbs_g: manualTotals.carbs,
            fats_g: manualTotals.fats,
            weight_g: weightNum,
            created_at: editingLog.created_at,
          }
        : {
            id: crypto.randomUUID(),
            user_id: userId,
            logged_date: loggedDate,
            meal_type: mealType,
            food_name: foodName.trim(),
            calories: manualTotals.calories,
            protein_g: manualTotals.protein,
            carbs_g: manualTotals.carbs,
            fats_g: manualTotals.fats,
            weight_g: weightNum,
            created_at: new Date().toISOString(),
          };

      await enqueue({ type: "upsert", table: "food_logs", payload });

      if (!editingLog && saveFavorite && weightNum && weightNum > 0) {
        const ratio = 100 / weightNum;
        await enqueue({
          type: "upsert",
          table: "saved_foods",
          payload: {
            id: crypto.randomUUID(),
            user_id: userId,
            name: foodName.trim(),
            calories_100g: Math.round(manualTotals.calories * ratio * 10) / 10,
            protein_100g: Math.round(manualTotals.protein * ratio * 10) / 10,
            carbs_100g: Math.round(manualTotals.carbs * ratio * 10) / 10,
            fats_100g: Math.round(manualTotals.fats * ratio * 10) / 10,
            default_weight_g: weightNum,
            created_at: new Date().toISOString(),
          },
        });
      }

      if (isOnline) triggerSync();

      onSaved();
      onClose();
    } catch (err: any) {
      console.error("Failed to log food manually:", err);
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  // Handle Open Food Facts Search
  async function handleSearch() {
    const cleanQuery = searchQuery.trim();
    if (!cleanQuery) return;
    setSearching(true);
    setSearchResults([]);

    if (!isOnline) {
      setSearching(false);
      // Offline fallback
      return;
    }

    // Check if the query is a barcode digits string (8 to 14 numbers)
    const isBarcodeQuery = /^\d{8,14}$/.test(cleanQuery);

    try {
      if (isBarcodeQuery) {
        const product = await offProductByBarcode(cleanQuery);
        if (product && hasNutritionData(product)) {
          setSearchResults([product]);
          setSearching(false);
          return;
        }
        if (product) {
          // Real product but incomplete OFF entry — hand off to manual entry
          // with the actual name instead of logging fake zeros
          setActiveTab("manual");
          setFoodName(product.name);
          setManualNotice(t.nutritionTracker.scannedNoData);
          setSearching(false);
          return;
        }
      }

      // Standard text search: Mexican catalog first, world fallback
      setSearchResults(await offSearchProducts(cleanQuery));
    } catch (err) {
      console.error("Open Food Facts search error:", err);
    } finally {
      setSearching(false);
    }
  }

  // Handle Barcode Scanned Success
  async function handleBarcodeScanned(barcode: string) {
    setScanning(false);
    setSearchQuery(barcode);
    setSearching(true);

    if (!isOnline) {
      // Offline barcode scanned
      setSearching(false);
      // Pre-fill manual entry with barcode name
      setActiveTab("manual");
      setFoodName(`Barcode: ${barcode}`);
      return;
    }

    try {
      const product = await offProductByBarcode(barcode);
      if (product && hasNutritionData(product)) {
        setSearchResults([product]);
      } else {
        // Not in Open Food Facts, or entry has no nutriments — pre-fill
        // manual entry so the scan effort isn't wasted and no zeros get logged
        setSearchResults([]);
        setActiveTab("manual");
        setFoodName(product ? product.name : `Código: ${barcode}`);
        if (product) setManualNotice(t.nutritionTracker.scannedNoData);
      }
    } catch (err) {
      console.error("Barcode lookup error:", err);
    } finally {
      setSearching(false);
    }
  }

  // Save food item from search results list
  async function handleSaveSearchItem(item: any) {
    const rawPortion = portionSizes[item.id] || "100";
    const portionG = parseFloat(rawPortion) || 100;
    const ratio = portionG / 100;

    setSaving(true);
    try {
      const userId = await resolveUserId();
      if (!userId) {
        setSaving(false);
        return;
      }

      const payload = {
        id: crypto.randomUUID(),
        user_id: userId,
        logged_date: loggedDate,
        meal_type: mealType,
        food_name: item.brand ? `${item.name} (${item.brand})` : item.name,
        calories: Math.round(item.calories100g * ratio * 10) / 10,
        protein_g: Math.round(item.protein100g * ratio * 10) / 10,
        carbs_g: Math.round(item.carbs100g * ratio * 10) / 10,
        fats_g: Math.round(item.fats100g * ratio * 10) / 10,
        weight_g: portionG,
        created_at: new Date().toISOString(),
      };

      await enqueue({ type: "upsert", table: "food_logs", payload });
      if (isOnline) triggerSync();

      onSaved();
      onClose();
    } catch (err: any) {
      console.error("Failed to save search item:", err);
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  // Save an Open Food Facts search result as a reusable favorite (per-100g values already known)
  async function handleFavoriteSearchItem(item: any) {
    try {
      const userId = await resolveUserId();
      if (!userId) return;

      await enqueue({
        type: "upsert",
        table: "saved_foods",
        payload: {
          id: crypto.randomUUID(),
          user_id: userId,
          name: item.brand ? `${item.name} (${item.brand})` : item.name,
          calories_100g: item.calories100g,
          protein_100g: item.protein100g,
          carbs_100g: item.carbs100g,
          fats_100g: item.fats100g,
          default_weight_g: parseFloat(portionSizes[item.id] || "100") || 100,
          created_at: new Date().toISOString(),
        },
      });
      if (isOnline) triggerSync();
      setFavoritedIds(prev => ({ ...prev, [item.id]: true }));
    } catch (err) {
      console.error("Failed to save favorite:", err);
    }
  }

  // Log a Saved Food (favorite) at an adjustable portion — same math as handleSaveSearchItem
  async function handleSaveSavedFoodItem(item: SavedFood) {
    const rawPortion = savedPortionSizes[item.id] || String(item.default_weight_g || 100);
    const portionG = parseFloat(rawPortion) || 100;
    const ratio = portionG / 100;

    setSaving(true);
    try {
      const userId = await resolveUserId();
      if (!userId) {
        setSaving(false);
        return;
      }

      const payload = {
        id: crypto.randomUUID(),
        user_id: userId,
        logged_date: loggedDate,
        meal_type: mealType,
        food_name: item.name,
        calories: Math.round(item.calories_100g * ratio * 10) / 10,
        protein_g: Math.round(item.protein_100g * ratio * 10) / 10,
        carbs_g: Math.round(item.carbs_100g * ratio * 10) / 10,
        fats_g: Math.round(item.fats_100g * ratio * 10) / 10,
        weight_g: portionG,
        created_at: new Date().toISOString(),
      };

      await enqueue({ type: "upsert", table: "food_logs", payload });
      if (isOnline) triggerSync();

      onSaved();
      onClose();
    } catch (err: any) {
      console.error("Failed to save favorite item:", err);
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteFavorite(id: string) {
    setDeletingFavoriteId(id);
    try {
      await enqueue({ type: "delete", table: "saved_foods", column: "id", value: id });
      if (isOnline) triggerSync();
      setSavedFoods(prev => prev.filter(f => f.id !== id));
    } catch (err) {
      console.error("Failed to delete favorite:", err);
    } finally {
      setDeletingFavoriteId(null);
    }
  }

  // One-tap re-log of a recently eaten item, exactly as it was last logged
  async function handleLogRecent(item: FoodLog) {
    setSaving(true);
    try {
      const userId = await resolveUserId();
      if (!userId) {
        setSaving(false);
        return;
      }

      await enqueue({
        type: "upsert",
        table: "food_logs",
        payload: {
          id: crypto.randomUUID(),
          user_id: userId,
          logged_date: loggedDate,
          meal_type: mealType,
          food_name: item.food_name,
          calories: item.calories,
          protein_g: item.protein_g,
          carbs_g: item.carbs_g,
          fats_g: item.fats_g,
          weight_g: item.weight_g ?? null,
          created_at: new Date().toISOString(),
        },
      });
      if (isOnline) triggerSync();

      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to log recent item:", err);
    } finally {
      setSaving(false);
    }
  }

  // Handle image capture for AI
  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    setAiImagePreview(URL.createObjectURL(f));
    
    const reader = new FileReader();
    reader.readAsDataURL(f);
    reader.onload = () => {
      setAiImageBase64(reader.result as string);
    };
  }

  // Run AI Analysis
  async function handleAiAnalyze() {
    if (!aiText.trim() && !aiImageBase64) return;
    
    setAiAnalyzing(true);
    setAiError(null);
    setAiEstimates([]);
    setAiSelected({});

    try {
      const estimates = await analyzeMealWithAI(aiImageBase64 || undefined, aiText.trim() || undefined);
      setAiEstimates(estimates);
      setAiOriginals(estimates);

      // Auto select all items by default
      const selectMap: Record<number, boolean> = {};
      estimates.forEach((_, idx) => {
        selectMap[idx] = true;
      });
      setAiSelected(selectMap);
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || "Failed to analyze meal with AI.");
    } finally {
      setAiAnalyzing(false);
    }
  }

  // Save selected items from AI estimates
  async function handleSaveAiEstimates() {
    const selectedItems = aiEstimates.filter((_, idx) => aiSelected[idx]);
    if (selectedItems.length === 0) return;

    setSaving(true);
    try {
      const userId = await resolveUserId();
      if (!userId) {
        setSaving(false);
        return;
      }

      const txs = selectedItems.map(item => {
        return enqueue({
          type: "upsert",
          table: "food_logs",
          payload: {
            id: crypto.randomUUID(),
            user_id: userId,
            logged_date: loggedDate,
            meal_type: mealType,
            food_name: item.food_name,
            calories: item.calories,
            protein_g: item.protein_g,
            carbs_g: item.carbs_g,
            fats_g: item.fats_g,
            weight_g: item.weight_g,
            created_at: new Date().toISOString(),
          }
        });
      });

      await Promise.all(txs);
      if (isOnline) triggerSync();

      onSaved();
      onClose();
    } catch (err: any) {
      console.error("Failed to save AI estimates:", err);
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  // Helper to adjust AI item values. Editing weight_g rescales the other three
  // macros + calories proportionally from that item's original AI estimate
  // (not from whatever's currently displayed, to avoid compounding rounding).
  function handleUpdateAiEstimate(index: number, field: keyof FoodItemEstimate, val: string) {
    const num = parseFloat(val) || 0;
    setAiEstimates(prev => prev.map((item, idx) => {
      if (idx !== index) return item;
      if (field === "weight_g") {
        const original = aiOriginals[index];
        if (original && original.weight_g > 0) {
          return {
            ...item,
            weight_g: num,
            calories: scaleByWeight(original.weight_g, num, original.calories),
            protein_g: scaleByWeight(original.weight_g, num, original.protein_g),
            carbs_g: scaleByWeight(original.weight_g, num, original.carbs_g),
            fats_g: scaleByWeight(original.weight_g, num, original.fats_g),
          };
        }
      }
      return {
        ...item,
        [field]: field === "food_name" ? val : num
      };
    }));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center transition-opacity duration-300">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="glass-sheet absolute bottom-0 left-0 right-0 max-w-xl mx-auto rounded-t-[28px] border-t border-[var(--border)] max-h-[88vh] overflow-y-auto flex flex-col transition-transform duration-300 translate-y-0">
        
        {/* Pull handle bar */}
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div className="w-12 h-1 rounded-full bg-[var(--border)]" />
        </div>

        <div className="px-4 pb-8 flex-1 flex flex-col space-y-4">
          
          {/* Header */}
          <div className="flex items-center justify-between shrink-0">
            <div>
              <p className="section-label mb-0">{isEditing ? t.nutritionTracker.editFoodTitle : t.nutritionTracker.addFood}</p>
              <h2 className="text-lg font-bold text-[var(--text)] capitalize font-mono mt-0.5">
                ◈ {t.nutritionTracker[isEditing ? editMealType : mealType]} / LOG
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--faint)] hover:text-[var(--muted)] text-2xl leading-none transition-colors"
            >
              ×
            </button>
          </div>

          {/* Meal-type selector — only shown while editing, lets a mis-categorized entry move meals */}
          {isEditing && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-[var(--faint)] font-mono uppercase tracking-wider">
                {t.nutritionTracker.mealTypeLabel}
              </span>
              <select
                value={editMealType}
                onChange={(e) => setEditMealType(e.target.value as MealType)}
                className="input-base py-1.5 text-xs flex-1"
              >
                {(["breakfast", "lunch", "dinner", "snack"] as MealType[]).map(m => (
                  <option key={m} value={m}>{t.nutritionTracker[m]}</option>
                ))}
              </select>
            </div>
          )}

          {/* Recent foods — one-tap re-log, hidden while editing */}
          {!isEditing && recentFoods.length > 0 && (
            <div className="shrink-0 space-y-1.5">
              <p className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider">
                {t.nutritionTracker.recentTitle}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {recentFoods.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleLogRecent(item)}
                    disabled={saving}
                    className="btn-outline shrink-0 px-3 py-1.5 text-[11px] whitespace-nowrap"
                  >
                    {item.food_name}
                    <span className="text-[var(--faint)] ml-1.5">{Math.round(item.calories)} kcal</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Glass Segmented Tabs selector — hidden while editing (plain form only) */}
          {!isEditing && (
            <div className="flex bg-[#080808]/40 border border-[var(--border)] rounded-2xl p-1 shrink-0">
              {((aiAvailable ? ["manual", "search", "saved", "ai"] : ["manual", "search", "saved"]) as Tab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab);
                    setScanning(false);
                  }}
                  className={cn(
                    "flex-1 py-2 text-xs font-semibold rounded-xl transition-all duration-200",
                    activeTab === tab
                      ? "bg-[var(--accent)] text-[#041a1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] font-bold"
                      : "text-[var(--sub)] hover:text-[var(--muted)]"
                  )}
                >
                  {tab === "manual" && t.nutritionTracker.manualLog}
                  {tab === "search" && t.nutritionTracker.searchLog}
                  {tab === "saved" && t.nutritionTracker.savedLog}
                  {tab === "ai" && t.nutritionTracker.aiLog}
                </button>
              ))}
            </div>
          )}

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto max-h-[50vh] pr-1">

            {saveError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/25 text-red-400 rounded-xl text-xs font-mono text-center">
                ◈ ERROR: {saveError}
              </div>
            )}

            {/* TAB: MANUAL ENTRY */}
            {activeTab === "manual" && (
              <form onSubmit={handleManualSubmit} className="space-y-3.5">
                {manualNotice && (
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/25 text-amber-500 rounded-xl text-[11px] leading-relaxed">
                    ◈ {manualNotice}
                  </div>
                )}
                <input
                  type="text"
                  placeholder={t.nutritionTracker.foodName}
                  value={foodName}
                  onChange={(e) => setFoodName(e.target.value)}
                  required
                  className="input-base"
                />

                {!isEditing && (
                  <div className="flex bg-[#080808]/40 border border-[var(--border)] rounded-xl p-0.5 text-[11px]">
                    {(["total", "per100g"] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setManualMode(mode)}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg font-semibold transition-all duration-200",
                          manualMode === mode
                            ? "bg-[var(--accent)] text-[#041a1f]"
                            : "text-[var(--sub)] hover:text-[var(--muted)]"
                        )}
                      >
                        {mode === "total" ? t.nutritionTracker.totalMode : t.nutritionTracker.per100gMode}
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <input
                      type="number"
                      placeholder={t.nutritionTracker.weightG}
                      value={weightG}
                      onChange={(e) => isEditing ? handleEditWeightChange(e.target.value) : setWeightG(e.target.value)}
                      className="input-base pr-8 metric"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--faint)] text-[10px] font-mono">G</span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      placeholder={t.nutritionTracker.calories}
                      value={calories}
                      onChange={(e) => setCalories(e.target.value)}
                      required
                      className="input-base pr-12 metric"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--faint)] text-[10px] font-mono">
                      {usingPer100g ? "KCAL/100G" : "KCAL"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      placeholder={t.nutritionTracker.protein}
                      value={proteinG}
                      onChange={(e) => setProteinG(e.target.value)}
                      className="input-base pr-8 metric border-[rgba(var(--accent-rgb),0.15)] bg-[#0c0c0c]/40"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--accent)] text-[9px] font-mono">P</span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      placeholder={t.nutritionTracker.carbs}
                      value={carbsG}
                      onChange={(e) => setCarbsG(e.target.value)}
                      className="input-base pr-8 metric border-[rgba(var(--emerald-rgb),0.15)] bg-[#0c0c0c]/40"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--emerald-rgb))] text-[9px] font-mono">C</span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      placeholder={t.nutritionTracker.fats}
                      value={fatsG}
                      onChange={(e) => setFatsG(e.target.value)}
                      className="input-base pr-8 metric border-[rgba(var(--violet-rgb),0.15)] bg-[#0c0c0c]/40"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--violet-rgb))] text-[9px] font-mono">F</span>
                  </div>
                </div>

                {usingPer100g && manualWeightNum > 0 && (
                  <p className="text-[9px] font-mono text-[var(--accent)] metric">
                    → {manualWeightNum}g = {manualTotals.calories} kcal · {manualTotals.protein.toFixed(1)}P · {manualTotals.carbs.toFixed(1)}C · {manualTotals.fats.toFixed(1)}F
                  </p>
                )}

                {!isEditing && manualWeightNum > 0 && !!calories && (
                  <label className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={saveFavorite}
                      onChange={(e) => setSaveFavorite(e.target.checked)}
                      className="accent-[var(--accent)] rounded"
                    />
                    {t.nutritionTracker.saveAsFavorite}
                  </label>
                )}

                {/* Atwater cross-check: P*4 + C*4 + F*9 should ≈ label kcal */}
                {(() => {
                  const p = parseFloat(proteinG) || 0;
                  const c = parseFloat(carbsG) || 0;
                  const f = parseFloat(fatsG) || 0;
                  const macroKcal = Math.round(p * 4 + c * 4 + f * 9);
                  if (macroKcal <= 0) return null;
                  const entered = parseFloat(calories) || 0;
                  const mismatch =
                    entered > 0 &&
                    Math.abs(entered - macroKcal) / Math.max(entered, macroKcal) > 0.15;
                  if (entered > 0 && !mismatch) return null;
                  return (
                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-[11px] font-mono",
                        mismatch
                          ? "bg-amber-500/10 border-amber-500/25 text-amber-500"
                          : "bg-[var(--accent-faint)] border-[rgba(var(--accent-rgb),0.15)] text-[var(--accent)]"
                      )}
                    >
                      <span>
                        {mismatch ? "⚠ " : "◈ "}
                        {mismatch
                          ? t.nutritionTracker.kcalMismatch(macroKcal)
                          : t.nutritionTracker.kcalFromMacros(macroKcal)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCalories(String(macroKcal))}
                        className="btn-outline px-2.5 py-1 text-[10px] shrink-0"
                      >
                        {t.nutritionTracker.useCalculated}
                      </button>
                    </div>
                  );
                })()}

                <button
                  type="submit"
                  disabled={saving || !foodName.trim() || !calories}
                  className="btn-aqua w-full py-3"
                >
                  {saving ? "..." : (isEditing ? t.nutritionTracker.updateBtn : t.nutritionTracker.save)}
                </button>
              </form>
            )}

            {/* TAB: DATABASE SEARCH & BARCODE SCAN */}
            {activeTab === "search" && (
              <div className="space-y-4">
                
                {/* Search Bar & Scanner Toggle */}
                {!scanning && (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder={t.nutritionTracker.searchPlaceholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        className="input-base"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setScanning(true)}
                      className="btn-outline px-3.5 shrink-0 flex items-center justify-center gap-1.5"
                    >
                      <span>📷</span>
                      <span className="text-xs">{t.nutritionTracker.barcodeBtn}</span>
                    </button>
                  </div>
                )}

                {/* Camera Barcode Scanner View */}
                {scanning && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-[var(--accent)] font-mono tracking-widest uppercase">
                        ◈ Scanner Mode / Active
                      </span>
                      <button
                        type="button"
                        onClick={() => setScanning(false)}
                        className="text-xs text-red-400 font-semibold"
                      >
                        Cancel
                      </button>
                    </div>

                    {!isOnline && (
                      <p className="text-[10px] text-amber-400 font-medium">
                        ⚠️ {t.nutritionTracker.offlineScannerWarning}
                      </p>
                    )}

                    <BarcodeScanner
                      onScanSuccess={handleBarcodeScanned}
                      onScanError={(err) => console.error("Barcode read failed:", err)}
                    />
                  </div>
                )}

                {/* Offline Warning for Search */}
                {!isOnline && !scanning && (
                  <div className="card-glass p-3 border-l-2 border-l-amber-500 bg-amber-500/10">
                    <p className="text-xs text-amber-500 font-medium leading-relaxed">
                      Search and barcode online lookups are unavailable offline. Please log manually or scan using the manual barcode placeholder.
                    </p>
                  </div>
                )}

                {/* Search Action */}
                {isOnline && !scanning && searchQuery.trim() && (
                  <button
                    onClick={handleSearch}
                    disabled={searching}
                    className="btn-aqua w-full py-2.5 text-sm"
                  >
                    {searching ? "..." : "Search Database"}
                  </button>
                )}

                {/* Search results list */}
                {searching && <div className="skeleton h-20 w-full rounded-xl" />}
                
                {!searching && searchResults.length > 0 && (
                  <div className="space-y-3">
                    <p className="section-label">Matches Found ({searchResults.length})</p>
                    <div className="space-y-2">
                      {searchResults.map((item) => {
                        const servingG = parseServingGrams(item.servingSize);
                        const portionG = parseFloat(portionSizes[item.id] || "100") || 100;
                        const r = portionG / 100;
                        return (
                          <div key={item.id} className="card-glass p-3 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                            <div className="space-y-0.5 min-w-0">
                              <h4 className="text-sm font-semibold text-[var(--text)]">{item.name}</h4>
                              <p className="text-[10px] text-[var(--faint)] font-mono uppercase">
                                {Math.round(item.calories100g)} kcal {t.nutritionTracker.per100g} · {item.protein100g.toFixed(1)}P · {item.carbs100g.toFixed(1)}C · {item.fats100g.toFixed(1)}F
                              </p>
                            </div>

                            <div className="flex flex-col items-end gap-1.5 w-full md:w-auto shrink-0">
                              <div className="flex items-center gap-2">
                                {servingG != null && servingG !== 100 && (
                                  <button
                                    type="button"
                                    onClick={() => setPortionSizes({ ...portionSizes, [item.id]: String(servingG) })}
                                    className="btn-outline px-2 py-1 text-[10px] shrink-0"
                                  >
                                    {t.nutritionTracker.servingLabel(servingG)}
                                  </button>
                                )}
                                <div className="relative w-20">
                                  <input
                                    type="number"
                                    value={portionSizes[item.id] || "100"}
                                    onChange={(e) => setPortionSizes({ ...portionSizes, [item.id]: e.target.value })}
                                    className="input-base px-2 py-1 text-center text-xs metric"
                                  />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--muted)]">g</span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleFavoriteSearchItem(item)}
                                  disabled={favoritedIds[item.id]}
                                  className="btn-outline py-1 px-2 text-xs shrink-0"
                                  title={t.nutritionTracker.saveAsFavorite}
                                >
                                  {favoritedIds[item.id] ? "✓" : "☆"}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleSaveSearchItem(item)}
                                  disabled={saving}
                                  className="btn-aqua py-1 px-3 text-xs"
                                >
                                  Log
                                </button>
                              </div>
                              {/* Exactly what will be logged for this portion */}
                              <p className="text-[9px] font-mono text-[var(--accent)] metric">
                                → {portionG}g = {Math.round(item.calories100g * r)} kcal · {(item.protein100g * r).toFixed(1)}P · {(item.carbs100g * r).toFixed(1)}C · {(item.fats100g * r).toFixed(1)}F
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!searching && searchQuery.trim() && searchResults.length === 0 && (
                  <p className="text-xs text-[var(--muted)] text-center py-4">
                    {t.nutritionTracker.searchNoResults}
                  </p>
                )}
              </div>
            )}

            {/* TAB: SAVED FOODS (favorites) */}
            {activeTab === "saved" && (
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder={t.nutritionTracker.searchPlaceholder}
                  value={savedSearch}
                  onChange={(e) => setSavedSearch(e.target.value)}
                  className="input-base"
                />

                {savedFoods.length === 0 && (
                  <p className="text-xs text-[var(--muted)] text-center py-6 leading-relaxed">
                    {t.nutritionTracker.savedEmpty}
                  </p>
                )}

                {savedFoods.length > 0 && (
                  <div className="space-y-2">
                    {savedFoods
                      .filter(f => f.name.toLowerCase().includes(savedSearch.trim().toLowerCase()))
                      .map((item) => {
                        const portionG = parseFloat(savedPortionSizes[item.id] || String(item.default_weight_g || 100)) || 100;
                        const r = portionG / 100;
                        return (
                          <div key={item.id} className="card-glass p-3 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                            <div className="space-y-0.5 min-w-0">
                              <h4 className="text-sm font-semibold text-[var(--text)]">{item.name}</h4>
                              <p className="text-[10px] text-[var(--faint)] font-mono uppercase">
                                {Math.round(item.calories_100g)} kcal {t.nutritionTracker.per100g} · {item.protein_100g.toFixed(1)}P · {item.carbs_100g.toFixed(1)}C · {item.fats_100g.toFixed(1)}F
                              </p>
                            </div>

                            <div className="flex flex-col items-end gap-1.5 w-full md:w-auto shrink-0">
                              <div className="flex items-center gap-2">
                                <div className="relative w-20">
                                  <input
                                    type="number"
                                    value={savedPortionSizes[item.id] || String(item.default_weight_g || 100)}
                                    onChange={(e) => setSavedPortionSizes({ ...savedPortionSizes, [item.id]: e.target.value })}
                                    className="input-base px-2 py-1 text-center text-xs metric"
                                  />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--muted)]">g</span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteFavorite(item.id)}
                                  disabled={deletingFavoriteId === item.id}
                                  className="text-red-400/70 hover:text-red-400 px-1 text-sm font-semibold shrink-0"
                                >
                                  {deletingFavoriteId === item.id ? "…" : "×"}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleSaveSavedFoodItem(item)}
                                  disabled={saving}
                                  className="btn-aqua py-1 px-3 text-xs"
                                >
                                  Log
                                </button>
                              </div>
                              <p className="text-[9px] font-mono text-[var(--accent)] metric">
                                → {portionG}g = {Math.round(item.calories_100g * r)} kcal · {(item.protein_100g * r).toFixed(1)}P · {(item.carbs_100g * r).toFixed(1)}C · {(item.fats_100g * r).toFixed(1)}F
                              </p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            {/* TAB: AI SCANNER (developer-only) */}
            {activeTab === "ai" && aiAvailable && (
              <div className="space-y-4">
                
                {/* Description & Camera scan buttons */}
                {!aiAnalyzing && aiEstimates.length === 0 && (
                  <div className="space-y-3">
                    <textarea
                      placeholder={t.nutritionTracker.aiTextPlaceholder}
                      value={aiText}
                      onChange={(e) => setAiText(e.target.value)}
                      rows={3}
                      className="input-base resize-none"
                    />

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="btn-outline flex-1 py-2 text-xs flex items-center justify-center gap-1.5"
                      >
                        <span>📷</span>
                        {aiImagePreview ? "Change Photo" : t.nutritionTracker.aiPhotoBtn}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleImageSelect}
                        className="hidden"
                      />
                    </div>

                    {aiImagePreview && (
                      <div className="relative h-44 rounded-xl overflow-hidden ring-1 ring-[var(--border)]">
                        <Image
                          src={aiImagePreview}
                          alt="Meal Preview"
                          fill
                          className="object-cover"
                          sizes="400px"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setAiImagePreview(null);
                            setAiImageBase64(null);
                          }}
                          className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
                        >
                          ×
                        </button>
                      </div>
                    )}

                    {!isOnline && (
                      <div className="card-glass p-3 border-l-2 border-l-red-500 bg-red-500/10">
                        <p className="text-xs text-red-500 font-medium leading-relaxed">
                          AI Meal Scanner requires an internet connection.
                        </p>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleAiAnalyze}
                      disabled={!isOnline || (!aiText.trim() && !aiImageBase64)}
                      className="btn-aqua w-full py-3"
                    >
                      {t.nutritionTracker.aiAnalyzeBtn}
                    </button>
                  </div>
                )}

                {/* AI Analyzing loader */}
                {aiAnalyzing && (
                  <div className="py-8 flex flex-col items-center justify-center space-y-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[var(--accent)]" />
                    <p className="text-xs text-[var(--muted)]">{t.nutritionTracker.aiAnalyzing}</p>
                  </div>
                )}

                {aiError && (
                  <div className="space-y-3">
                    <p className="text-xs text-red-400 text-center font-medium">{aiError}</p>
                    <button
                      type="button"
                      onClick={() => setAiError(null)}
                      className="btn-outline w-full py-2.5 text-xs"
                    >
                      Try Again
                    </button>
                  </div>
                )}

                {/* AI Estimates list */}
                {!aiAnalyzing && aiEstimates.length > 0 && (
                  <div className="space-y-4">
                    <p className="text-[10px] text-amber-500/90 leading-relaxed">
                      ⚠ {t.nutritionTracker.aiDisclaimer}
                    </p>
                    <div className="flex justify-between items-center">
                      <p className="section-label mb-0">{t.nutritionTracker.aiSelectTitle}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setAiEstimates([]);
                          setAiText("");
                          setAiImagePreview(null);
                          setAiImageBase64(null);
                        }}
                        className="text-xs text-[var(--accent)]"
                      >
                        Reset Scanner
                      </button>
                    </div>

                    <div className="space-y-3.5 max-h-[40vh] overflow-y-auto pr-1">
                      {aiEstimates.map((item, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            "card-glass p-3.5 space-y-3 border transition-colors duration-200",
                            aiSelected[idx]
                              ? "border-[rgba(var(--accent-rgb),0.35)]"
                              : "border-[var(--border)] opacity-60"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={!!aiSelected[idx]}
                              onChange={(e) => setAiSelected({ ...aiSelected, [idx]: e.target.checked })}
                              className="accent-[var(--accent)] rounded scale-110"
                            />
                            
                            <input
                              type="text"
                              value={item.food_name}
                              onChange={(e) => handleUpdateAiEstimate(idx, "food_name", e.target.value)}
                              className="flex-1 bg-transparent border-0 border-b border-transparent focus:border-[var(--accent)] outline-none text-sm font-semibold p-0 text-[var(--text)]"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2 pl-7">
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--faint)] font-mono">WEIGHT</span>
                              <input
                                type="number"
                                value={item.weight_g}
                                onChange={(e) => handleUpdateAiEstimate(idx, "weight_g", e.target.value)}
                                className="input-base text-right text-xs metric pl-14 pr-7"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--faint)] font-mono">G</span>
                            </div>
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--faint)] font-mono">ENERGY</span>
                              <input
                                type="number"
                                value={item.calories}
                                onChange={(e) => handleUpdateAiEstimate(idx, "calories", e.target.value)}
                                className="input-base text-right text-xs metric pl-14 pr-10"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--faint)] font-mono">KCAL</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 pl-7">
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] text-[var(--accent)] font-mono">P</span>
                              <input
                                type="number"
                                step="0.1"
                                value={item.protein_g}
                                onChange={(e) => handleUpdateAiEstimate(idx, "protein_g", e.target.value)}
                                className="input-base text-right text-xs metric pl-5 pr-5 border-[rgba(var(--accent-rgb),0.1)] bg-[#080808]/20"
                              />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] text-[var(--faint)] font-mono">G</span>
                            </div>
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] text-[rgb(var(--emerald-rgb))] font-mono">C</span>
                              <input
                                type="number"
                                step="0.1"
                                value={item.carbs_g}
                                onChange={(e) => handleUpdateAiEstimate(idx, "carbs_g", e.target.value)}
                                className="input-base text-right text-xs metric pl-5 pr-5 border-[rgba(var(--emerald-rgb),0.1)] bg-[#080808]/20"
                              />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] text-[var(--faint)] font-mono">G</span>
                            </div>
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] text-[rgb(var(--violet-rgb))] font-mono">F</span>
                              <input
                                type="number"
                                step="0.1"
                                value={item.fats_g}
                                onChange={(e) => handleUpdateAiEstimate(idx, "fats_g", e.target.value)}
                                className="input-base text-right text-xs metric pl-5 pr-5 border-[rgba(var(--violet-rgb),0.1)] bg-[#080808]/20"
                              />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] text-[var(--faint)] font-mono">G</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveAiEstimates}
                      disabled={saving || !Object.values(aiSelected).some(Boolean)}
                      className="btn-aqua w-full py-3"
                    >
                      {saving ? "..." : "Save Selected Items"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
