"use client";

import { useEffect, useState, useMemo } from "react";
import { useT } from "@/lib/context/LanguageContext";
import {
  calculateNutrition,
  estimateBodyFatUSNavy,
  ACTIVITY_MULTIPLIERS,
  GOAL_CALORIE_ADJUSTMENTS,
  type Sex,
  type WeightUnit,
  type ActivityLevel,
  type FitnessGoal,
  type MacroAllocationMethod,
} from "@/lib/nutrition";
import { getCached, setCache } from "@/lib/offlineQueue";
import { cn } from "@/lib/utils";
import { useNav } from "@/lib/context/NavContext";

interface Props {
  open: boolean;
  onClose: () => void;
  weightUnit: WeightUnit;
  latestWeight?: number | null;
  onApplied?: () => void;
}

export default function NutritionCalculator({
  open,
  onClose,
  weightUnit,
  latestWeight,
  onApplied,
}: Props) {
  const t = useT();
  const { setNavHidden } = useNav();

  // Hide bottom navigation bar when calculator drawer is open
  useEffect(() => {
    if (open) {
      setNavHidden(true);
    } else {
      setNavHidden(false);
    }
    return () => setNavHidden(false);
  }, [open, setNavHidden]);

  // Basic States
  const [equation, setEquation] = useState<"cunningham" | "mifflin">("cunningham");
  const [sex, setSex] = useState<Sex>("male");
  const [age, setAge] = useState<number>(25);
  const [weight, setWeight] = useState<string>("");
  const [height, setHeight] = useState<number>(175);
  const [bodyFatPct, setBodyFatPct] = useState<number>(15);
  const [activity, setActivity] = useState<ActivityLevel>("moderately");
  const [goal, setGoal] = useState<FitnessGoal>("maintain");
  const [macroMethod, setMacroMethod] = useState<MacroAllocationMethod>("sportsScience");

  // US Navy Helper States
  const [showBfHelper, setShowBfHelper] = useState<boolean>(false);
  const [neck, setNeck] = useState<string>("38");
  const [waist, setWaist] = useState<string>("85");
  const [hips, setHips] = useState<string>("95");

  // Load saved inputs from cache on mount
  useEffect(() => {
    async function loadSavedInputs() {
      const saved = await getCached<{
        equation?: "cunningham" | "mifflin";
        sex?: Sex;
        age?: number;
        weight?: number;
        height?: number;
        bodyFatPct?: number;
        activity?: ActivityLevel;
        goal?: FitnessGoal;
        macroMethod?: MacroAllocationMethod;
        neck?: string;
        waist?: string;
        hips?: string;
      }>("auth:nutrition_inputs");

      if (saved) {
        if (saved.equation) setEquation(saved.equation);
        if (saved.sex) setSex(saved.sex);
        if (saved.age) setAge(saved.age);
        if (saved.weight) setWeight(String(saved.weight));
        if (saved.height) setHeight(saved.height);
        if (saved.bodyFatPct) setBodyFatPct(saved.bodyFatPct);
        if (saved.activity) setActivity(saved.activity);
        if (saved.goal) setGoal(saved.goal);
        if (saved.macroMethod) setMacroMethod(saved.macroMethod);
        if (saved.neck) setNeck(saved.neck);
        if (saved.waist) setWaist(saved.waist);
        if (saved.hips) setHips(saved.hips);
      } else {
        // Fallback: try to fetch from latestWeight prop or directly from IndexedDB
        if (latestWeight) {
          setWeight(String(latestWeight));
        } else {
          try {
            const { getDb } = await import("@/lib/db");
            const db = await getDb();
            if (db) {
              const logs = await db.getAll("daily_weight_logs");
              if (logs && logs.length > 0) {
                // Sort by date descending
                logs.sort((a, b) => b.logged_date.localeCompare(a.logged_date));
                setWeight(String(logs[0].weight));
              }
            }
          } catch (e) {
            console.error("Failed to load latest weight from DB in calculator", e);
          }
        }
      }
    }
    if (open) {
      loadSavedInputs();
    }
  }, [open, latestWeight]);

  // Autofill weight if it changes and input is empty
  useEffect(() => {
    if (latestWeight && !weight) {
      setWeight(String(latestWeight));
    }
  }, [latestWeight, weight]);

  // Run calculations reactively
  const results = useMemo(() => {
    const numericWeight = parseFloat(weight);
    if (isNaN(numericWeight) || numericWeight <= 0) return null;

    return calculateNutrition({
      equation,
      sex,
      age,
      weight: numericWeight,
      weightUnit,
      height,
      activity,
      goal,
      macroMethod,
      bodyFatPct: equation === "cunningham" ? bodyFatPct : undefined,
    });
  }, [equation, sex, age, weight, weightUnit, height, activity, goal, macroMethod, bodyFatPct]);

  // Handle US Navy Body Fat estimation dynamically
  const estimatedBf = useMemo(() => {
    const n = parseFloat(neck);
    const w = parseFloat(waist);
    const h = parseFloat(hips);

    if (isNaN(n) || isNaN(w) || (sex === "female" && isNaN(h))) return null;

    return estimateBodyFatUSNavy(sex, height, n, w, sex === "female" ? h : undefined);
  }, [sex, height, neck, waist, hips]);

  const applyEstimatedBf = () => {
    if (estimatedBf !== null) {
      setBodyFatPct(estimatedBf);
      setShowBfHelper(false);
    }
  };

  const handleApply = async () => {
    if (!results) return;

    // 1. Save targets to cache
    await setCache("auth:nutrition_targets", {
      calories: results.calories,
      protein: results.protein,
      carbs: results.carbs,
      fats: results.fats,
      calculatedAt: new Date().toISOString(),
    });

    // 2. Save inputs so they can be re-loaded
    await setCache("auth:nutrition_inputs", {
      equation,
      sex,
      age,
      weight: parseFloat(weight),
      height,
      bodyFatPct,
      activity,
      goal,
      macroMethod,
      neck,
      waist,
      hips,
    });

    if (onApplied) onApplied();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 transition-opacity duration-300 opacity-100">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet Content */}
      <div
        className={cn(
          "glass-sheet absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-[var(--border)] transition-transform duration-300 max-h-[92vh] overflow-y-auto translate-y-0"
        )}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
        </div>

        <div className="px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] space-y-4 max-w-lg mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="section-label mb-0">{t.nutrition.title}</p>
              <p className="text-[11px] text-[var(--faint)] mt-0.5">{t.nutrition.subtitle}</p>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--faint)] hover:text-[var(--muted)] text-2xl leading-none transition-colors"
            >
              ×
            </button>
          </div>

          <div className="divider" />

          {/* Form Content */}
          <div className="space-y-4">
            {/* Equation Toggle */}
            <div className="card-glass p-3 space-y-2">
              <p className="text-xs text-[var(--faint)] uppercase tracking-wider font-mono">
                {t.nutrition.equation}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEquation("cunningham")}
                  className={cn(
                    "py-2 rounded-xl border text-xs font-semibold uppercase tracking-wider transition-all",
                    equation === "cunningham"
                      ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-faint)]"
                      : "border-[var(--border)] text-[var(--faint)] hover:text-[var(--muted)]"
                  )}
                >
                  Cunningham (LBM)
                </button>
                <button
                  type="button"
                  onClick={() => setEquation("mifflin")}
                  className={cn(
                    "py-2 rounded-xl border text-xs font-semibold uppercase tracking-wider transition-all",
                    equation === "mifflin"
                      ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-faint)]"
                      : "border-[var(--border)] text-[var(--faint)] hover:text-[var(--muted)]"
                  )}
                >
                  Mifflin-St Jeor
                </button>
              </div>
            </div>

            {/* Sex Toggle & Age */}
            <div className="grid grid-cols-2 gap-3">
              <div className="card-glass p-3 space-y-2">
                <p className="text-xs text-[var(--faint)] uppercase tracking-wider font-mono">
                  {t.nutrition.sex}
                </p>
                <div className="flex border border-[var(--border)] rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setSex("male")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-semibold transition-all",
                      sex === "male" ? "bg-[var(--accent)] text-[#041a1f]" : "text-[var(--sub)]"
                    )}
                  >
                    {t.nutrition.male}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSex("female")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-semibold transition-all",
                      sex === "female" ? "bg-[var(--accent)] text-[#041a1f]" : "text-[var(--sub)]"
                    )}
                  >
                    {t.nutrition.female}
                  </button>
                </div>
              </div>

              <div className="card-glass p-3 space-y-2">
                <p className="text-xs text-[var(--faint)] uppercase tracking-wider font-mono">
                  {t.nutrition.age}
                </p>
                <input
                  type="number"
                  min="12"
                  max="100"
                  value={age}
                  onChange={(e) => setAge(parseInt(e.target.value) || 25)}
                  className="input-base text-sm py-1.5"
                />
              </div>
            </div>

            {/* Weight & Height */}
            <div className="grid grid-cols-2 gap-3">
              <div className="card-glass p-3 space-y-2">
                <p className="text-xs text-[var(--faint)] uppercase tracking-wider font-mono">
                  {t.nutrition.weight} ({weightUnit})
                </p>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 75"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="input-base text-sm py-1.5 metric"
                />
              </div>

              <div className="card-glass p-3 space-y-2">
                <p className="text-xs text-[var(--faint)] uppercase tracking-wider font-mono">
                  {t.nutrition.height} (cm)
                </p>
                <input
                  type="number"
                  min="100"
                  max="250"
                  value={height}
                  onChange={(e) => setHeight(parseInt(e.target.value) || 170)}
                  className="input-base text-sm py-1.5 metric"
                />
              </div>
            </div>

            {/* Cunningham body fat & US Navy Calculator */}
            {equation === "cunningham" && (
              <div className="card-glass p-3 space-y-3">
                <div className="flex justify-between items-center">
                  <p className="text-xs text-[var(--faint)] uppercase tracking-wider font-mono">
                    {t.nutrition.bodyFat}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowBfHelper(!showBfHelper)}
                    className="text-[var(--accent)] hover:underline text-[11px] font-medium"
                  >
                    {showBfHelper ? "× Close Helper" : t.nutrition.bfHelperBtn}
                  </button>
                </div>

                {!showBfHelper ? (
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="3"
                      max="50"
                      step="1"
                      value={bodyFatPct}
                      onChange={(e) => setBodyFatPct(parseInt(e.target.value))}
                      className="flex-1 accent-[var(--accent)]"
                    />
                    <span className="w-12 text-right text-sm font-semibold metric text-[var(--accent)]">
                      {bodyFatPct}%
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3 bg-[#0a0a0a]/50 p-3 rounded-xl border border-[var(--border)]">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-[var(--faint)] block mb-1">
                          {t.nutrition.neck} (cm)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={neck}
                          onChange={(e) => setNeck(e.target.value)}
                          className="input-base text-xs py-1.5 text-center metric"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-[var(--faint)] block mb-1">
                          {t.nutrition.waist} (cm)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={waist}
                          onChange={(e) => setWaist(e.target.value)}
                          className="input-base text-xs py-1.5 text-center metric"
                        />
                      </div>
                    </div>

                    {sex === "female" && (
                      <div>
                        <label className="text-[10px] text-[var(--faint)] block mb-1">
                          {t.nutrition.hips} (cm)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={hips}
                          onChange={(e) => setHips(e.target.value)}
                          className="input-base text-xs py-1.5 text-center metric"
                        />
                      </div>
                    )}

                    {estimatedBf !== null ? (
                      <div className="flex justify-between items-center pt-2">
                        <span className="text-xs text-[var(--muted)]">
                          Estimated: <span className="text-[var(--accent)] font-semibold metric">{estimatedBf}%</span>
                        </span>
                        <button
                          type="button"
                          onClick={applyEstimatedBf}
                          className="btn-primary py-1 px-3 rounded-lg text-xs"
                        >
                          Apply BF%
                        </button>
                      </div>
                    ) : (
                      <p className="text-[10px] text-[var(--faint)] text-center">
                        Enter dimensions to estimate body fat
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Activity Level */}
            <div className="card-glass p-3 space-y-2">
              <p className="text-xs text-[var(--faint)] uppercase tracking-wider font-mono">
                {t.nutrition.activity}
              </p>
              <select
                value={activity}
                onChange={(e) => setActivity(e.target.value as ActivityLevel)}
                className="input-base text-sm py-2 bg-transparent cursor-pointer"
              >
                <option value="sedentary" className="bg-[#0e0e0e]">
                  {t.nutrition.sedentary}
                </option>
                <option value="lightly" className="bg-[#0e0e0e]">
                  {t.nutrition.lightly}
                </option>
                <option value="moderately" className="bg-[#0e0e0e]">
                  {t.nutrition.moderately}
                </option>
                <option value="very" className="bg-[#0e0e0e]">
                  {t.nutrition.very}
                </option>
                <option value="extra" className="bg-[#0e0e0e]">
                  {t.nutrition.extra}
                </option>
              </select>
            </div>

            {/* Goal */}
            <div className="card-glass p-3 space-y-2">
              <p className="text-xs text-[var(--faint)] uppercase tracking-wider font-mono">
                {t.nutrition.goal}
              </p>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value as FitnessGoal)}
                className="input-base text-sm py-2 bg-transparent cursor-pointer"
              >
                <option value="loseFast" className="bg-[#0e0e0e]">
                  {t.nutrition.loseFast}
                </option>
                <option value="lose" className="bg-[#0e0e0e]">
                  {t.nutrition.lose}
                </option>
                <option value="maintain" className="bg-[#0e0e0e]">
                  {t.nutrition.maintain}
                </option>
                <option value="gain" className="bg-[#0e0e0e]">
                  {t.nutrition.gain}
                </option>
                <option value="gainFast" className="bg-[#0e0e0e]">
                  {t.nutrition.gainFast}
                </option>
              </select>
            </div>

            {/* Macro Ratio splits */}
            <div className="card-glass p-3 space-y-2">
              <p className="text-xs text-[var(--faint)] uppercase tracking-wider font-mono">
                {t.nutrition.macroSplit}
              </p>
              <select
                value={macroMethod}
                onChange={(e) => setMacroMethod(e.target.value as MacroAllocationMethod)}
                className="input-base text-sm py-2 bg-transparent cursor-pointer"
              >
                <option value="sportsScience" className="bg-[#0e0e0e]">
                  {t.nutrition.sportsScience}
                </option>
                <option value="balanced" className="bg-[#0e0e0e]">
                  {t.nutrition.balanced}
                </option>
                <option value="highProtein" className="bg-[#0e0e0e]">
                  {t.nutrition.highProtein}
                </option>
                <option value="lowCarb" className="bg-[#0e0e0e]">
                  {t.nutrition.lowCarb}
                </option>
              </select>
            </div>
          </div>

          <div className="divider" />

          {/* Results Board */}
          {results ? (
            <div className="space-y-4 animate-spring-scale">
              {/* Target Readout */}
              <div className="card-glass p-4 text-center border-[rgba(var(--accent-rgb),0.20)] shadow-[0_0_20px_rgba(var(--accent-rgb),0.08)]">
                <p className="text-xs text-[var(--accent)] uppercase tracking-widest font-semibold font-mono">
                  {t.nutrition.caloriesTarget}
                </p>
                <p className="text-4xl font-extrabold tracking-tight text-[var(--text)] mt-1.5 mb-1 metric drop-shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]">
                  {results.calories.toLocaleString()} <span className="text-sm font-semibold tracking-normal text-[var(--muted)]">kcal / day</span>
                </p>
                <div className="flex justify-center gap-4 text-[10px] text-[var(--faint)] uppercase font-mono mt-2">
                  <span>{t.nutrition.bmr}: <strong className="text-[var(--text)] metric">{results.bmr}</strong></span>
                  <span>|</span>
                  <span>{t.nutrition.tdee}: <strong className="text-[var(--text)] metric">{results.tdee}</strong></span>
                </div>
              </div>

              {/* Macro Bars */}
              <div className="card-glass p-4 space-y-3">
                <p className="section-label mb-2">Macronutrients</p>

                {/* Protein Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-[var(--text)]">{t.nutrition.protein}</span>
                    <span className="font-mono text-[var(--accent)] font-semibold metric">
                      {results.protein}g <span className="text-[var(--faint)] font-normal text-[10px]">({Math.round((results.protein * 4 / results.calories) * 100)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] shadow-[0_0_8px_rgba(var(--accent-rgb),0.4)] transition-all duration-300"
                      style={{ width: `${Math.min(100, (results.protein * 4 / results.calories) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Carbs Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-[var(--text)]">{t.nutrition.carbs}</span>
                    <span className="font-mono text-[rgb(var(--emerald-rgb))] font-semibold metric">
                      {results.carbs}g <span className="text-[var(--faint)] font-normal text-[10px]">({Math.round((results.carbs * 4 / results.calories) * 100)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[rgb(var(--emerald-rgb))] shadow-[0_0_8px_rgba(var(--emerald-rgb),0.4)] transition-all duration-300"
                      style={{ width: `${Math.min(100, (results.carbs * 4 / results.calories) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Fats Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-[var(--text)]">{t.nutrition.fats}</span>
                    <span className="font-mono text-[rgb(var(--violet-rgb))] font-semibold metric">
                      {results.fats}g <span className="text-[var(--faint)] font-normal text-[10px]">({Math.round((results.fats * 9 / results.calories) * 100)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[rgb(var(--violet-rgb))] shadow-[0_0_8px_rgba(var(--violet-rgb),0.4)] transition-all duration-300"
                      style={{ width: `${Math.min(100, (results.fats * 9 / results.calories) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Apply CTA */}
              <button
                type="button"
                onClick={handleApply}
                className="btn-aqua w-full py-3 rounded-2xl text-center font-bold tracking-wide animate-spring-up"
              >
                {t.nutrition.saveTargets}
              </button>
            </div>
          ) : (
            <p className="text-xs text-[var(--faint)] text-center pt-2">
              Please enter your weight to see metabolic estimates.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
