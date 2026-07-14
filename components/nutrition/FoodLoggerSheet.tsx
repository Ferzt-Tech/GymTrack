"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { enqueue } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { useT } from "@/lib/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import { analyzeMealWithAI, type FoodItemEstimate } from "@/lib/foodAi";
import BarcodeScanner from "./BarcodeScanner";

interface Props {
  open: boolean;
  onClose: () => void;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  loggedDate: string;
  onSaved: () => void;
}

type Tab = "manual" | "search" | "ai";

export default function FoodLoggerSheet({ open, onClose, mealType, loggedDate, onSaved }: Props) {
  const t = useT();
  const { triggerSync, isOnline } = useOnlineSync();
  const [activeTab, setActiveTab] = useState<Tab>("manual");
  
  // Manual / Quick Entry Form States
  const [foodName, setFoodName] = useState("");
  const [weightG, setWeightG] = useState("");
  const [calories, setCalories] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatsG, setFatsG] = useState("");
  const [saving, setSaving] = useState(false);

  // Database / Barcode Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [portionSizes, setPortionSizes] = useState<Record<string, string>>({}); // id -> portion in grams

  // AI Meal Scanner States
  const [aiText, setAiText] = useState("");
  const [aiImagePreview, setAiImagePreview] = useState<string | null>(null);
  const [aiImageBase64, setAiImageBase64] = useState<string | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiEstimates, setAiEstimates] = useState<FoodItemEstimate[]>([]);
  const [aiSelected, setAiSelected] = useState<Record<number, boolean>>({}); // index -> selected
  const [aiError, setAiError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset states on open/close
  useEffect(() => {
    if (open) {
      setActiveTab("manual");
      setFoodName("");
      setWeightG("");
      setCalories("");
      setProteinG("");
      setCarbsG("");
      setFatsG("");
      setSearchQuery("");
      setSearchResults([]);
      setScanning(false);
      setAiText("");
      setAiImagePreview(null);
      setAiImageBase64(null);
      setAiEstimates([]);
      setAiSelected({});
      setAiError(null);
    }
  }, [open]);

  // Handle Manual Log Submission
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!foodName.trim() || !calories) return;
    setSaving(true);

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
      food_name: foodName.trim(),
      calories: parseFloat(calories) || 0,
      protein_g: parseFloat(proteinG) || 0,
      carbs_g: parseFloat(carbsG) || 0,
      fats_g: parseFloat(fatsG) || 0,
      weight_g: weightG ? parseFloat(weightG) : null,
      created_at: new Date().toISOString(),
    };

    await enqueue({ type: "upsert", table: "food_logs", payload });
    if (isOnline) triggerSync();
    
    setSaving(false);
    onSaved();
    onClose();
  }

  // Handle Open Food Facts Search
  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);

    if (!isOnline) {
      setSearching(false);
      // Offline fallback: find if we have matches in IndexedDB or local mocks, but we will show search offline warning
      return;
    }

    try {
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(searchQuery)}&search_simple=1&action=process&json=true&page_size=15`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const products = (data.products || []).map((p: any) => {
          const nut = p.nutriments || {};
          return {
            id: p.code || crypto.randomUUID(),
            name: p.product_name || "Unknown Product",
            brand: p.brands ? p.brands.split(",")[0] : null,
            calories100g: parseFloat(nut["energy-kcal_100g"]) || parseFloat(nut["energy-kcal"]) || 0,
            protein100g: parseFloat(nut.proteins_100g) || 0,
            carbs100g: parseFloat(nut.carbohydrates_100g) || 0,
            fats100g: parseFloat(nut.fat_100g) || 0,
            servingSize: p.serving_size || null,
          };
        });
        setSearchResults(products);
      }
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
      const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 1 && data.product) {
          const p = data.product;
          const nut = p.nutriments || {};
          const productData = {
            id: p.code || barcode,
            name: p.product_name || `Barcode product (${barcode})`,
            brand: p.brands ? p.brands.split(",")[0] : null,
            calories100g: parseFloat(nut["energy-kcal_100g"]) || parseFloat(nut["energy-kcal"]) || 0,
            protein100g: parseFloat(nut.proteins_100g) || 0,
            carbs100g: parseFloat(nut.carbohydrates_100g) || 0,
            fats100g: parseFloat(nut.fat_100g) || 0,
            servingSize: p.serving_size || null,
          };
          setSearchResults([productData]);
        } else {
          // Product not found
          setSearchResults([]);
        }
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
    
    setSaving(false);
    onSaved();
    onClose();
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

    setSaving(false);
    onSaved();
    onClose();
  }

  // Helper to adjust AI item values
  function handleUpdateAiEstimate(index: number, field: keyof FoodItemEstimate, val: string) {
    const num = parseFloat(val) || 0;
    setAiEstimates(prev => prev.map((item, idx) => {
      if (idx !== index) return item;
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
              <p className="section-label mb-0">{t.nutritionTracker.addFood}</p>
              <h2 className="text-lg font-bold text-[var(--text)] capitalize font-mono mt-0.5">
                ◈ {t.nutritionTracker[mealType]} / LOG
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--faint)] hover:text-[var(--muted)] text-2xl leading-none transition-colors"
            >
              ×
            </button>
          </div>

          {/* Glass Segmented Tabs selector */}
          <div className="flex bg-[#080808]/40 border border-[var(--border)] rounded-2xl p-1 shrink-0">
            {(["manual", "search", "ai"] as Tab[]).map((tab) => (
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
                {tab === "ai" && t.nutritionTracker.aiLog}
              </button>
            ))}
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto max-h-[50vh] pr-1">

            {/* TAB: MANUAL ENTRY */}
            {activeTab === "manual" && (
              <form onSubmit={handleManualSubmit} className="space-y-3.5">
                <input
                  type="text"
                  placeholder={t.nutritionTracker.foodName}
                  value={foodName}
                  onChange={(e) => setFoodName(e.target.value)}
                  required
                  className="input-base"
                />

                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <input
                      type="number"
                      placeholder={t.nutritionTracker.weightG}
                      value={weightG}
                      onChange={(e) => setWeightG(e.target.value)}
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
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--faint)] text-[10px] font-mono">KCAL</span>
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

                <button
                  type="submit"
                  disabled={saving || !foodName.trim() || !calories}
                  className="btn-aqua w-full py-3"
                >
                  {saving ? "..." : t.nutritionTracker.save}
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
                      {searchResults.map((item) => (
                        <div key={item.id} className="card-glass p-3 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                          <div className="space-y-0.5">
                            <h4 className="text-sm font-semibold text-[var(--text)]">{item.name}</h4>
                            <p className="text-[10px] text-[var(--faint)] font-mono uppercase">
                              {item.calories100g} kcal / 100g · {item.protein100g}P · {item.carbs100g}C · {item.fats100g}F
                            </p>
                          </div>

                          <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
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
                              onClick={() => handleSaveSearchItem(item)}
                              disabled={saving}
                              className="btn-aqua py-1 px-3 text-xs"
                            >
                              Log
                            </button>
                          </div>
                        </div>
                      ))}
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

            {/* TAB: AI SCANNER */}
            {activeTab === "ai" && (
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
