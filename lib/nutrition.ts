export type Sex = "male" | "female";
export type WeightUnit = "kg" | "lbs";
export type HeightUnit = "cm" | "in";

export type ActivityLevel =
  | "sedentary"
  | "lightly"
  | "moderately"
  | "very"
  | "extra";

export type FitnessGoal =
  | "loseFast"
  | "lose"
  | "maintain"
  | "gain"
  | "gainFast";

export type MacroAllocationMethod =
  | "sportsScience"
  | "balanced"
  | "highProtein"
  | "lowCarb"
  | "bodybuilder";

export interface NutritionTargets {
  calories: number;
  protein: number; // grams
  carbs: number;   // grams
  fats: number;    // grams
  bmr: number;
  tdee: number;
}

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly: 1.375,
  moderately: 1.55,
  very: 1.725,
  extra: 1.9,
};

export const GOAL_CALORIE_ADJUSTMENTS: Record<FitnessGoal, number> = {
  loseFast: -750,
  lose: -500,
  maintain: 0,
  gain: 300,
  gainFast: 500,
};

/**
 * Mifflin-St Jeor BMR Equation
 */
export function calculateMifflinStJeor(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: Sex
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return Math.round(sex === "male" ? base + 5 : base - 161);
}

/**
 * Cunningham BMR Equation
 */
export function calculateCunningham(weightKg: number, bodyFatPct: number): number {
  const lbmKg = weightKg * (1 - bodyFatPct / 100);
  return Math.round(370 + 22 * lbmKg);
}

/**
 * U.S. Navy Body Fat Estimation Method
 */
export function estimateBodyFatUSNavy(
  sex: Sex,
  heightCm: number,
  neckCm: number,
  waistCm: number,
  hipCm?: number
): number {
  if (sex === "male") {
    // Prevent division by zero or log of non-positive
    if (waistCm - neckCm <= 0 || heightCm <= 0) return 15;
    const denom = 1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm);
    const bf = 495 / denom - 450;
    return Math.max(2, Math.round(bf * 10) / 10);
  } else {
    if (!hipCm) return 22; // Safe fallback
    // Prevent division by zero or log of non-positive
    if (waistCm + hipCm - neckCm <= 0 || heightCm <= 0) return 22;
    const denom = 1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.22100 * Math.log10(heightCm);
    const bf = 495 / denom - 450;
    return Math.max(2, Math.round(bf * 10) / 10);
  }
}

/**
 * Main function to calculate daily calories and macros
 */
export function calculateNutrition(params: {
  equation: "cunningham" | "mifflin";
  sex: Sex;
  age: number;
  weight: number; // in weightUnit
  weightUnit: WeightUnit;
  height: number; // in cm
  activity: ActivityLevel;
  goal: FitnessGoal;
  macroMethod: MacroAllocationMethod;
  bodyFatPct?: number; // required for Cunningham
}): NutritionTargets {
  // 1. Normalize weight to kg
  const weightKg = params.weightUnit === "lbs" ? params.weight * 0.45359237 : params.weight;

  // 2. Compute BMR
  let bmr = 0;
  if (params.equation === "cunningham" && params.bodyFatPct !== undefined) {
    bmr = calculateCunningham(weightKg, params.bodyFatPct);
  } else {
    bmr = calculateMifflinStJeor(weightKg, params.height, params.age, params.sex);
  }

  // 3. Compute TDEE
  const multiplier = ACTIVITY_MULTIPLIERS[params.activity] ?? 1.2;
  const tdee = Math.round(bmr * multiplier);

  // 4. Calculate Calories Goal with Safe Floors
  const adjustment = GOAL_CALORIE_ADJUSTMENTS[params.goal] ?? 0;
  let calories = Math.round(tdee + adjustment);

  const absoluteFloor = params.sex === "male" ? 1500 : 1200;
  if (calories < absoluteFloor) {
    calories = absoluteFloor;
  }

  // 5. Macro splits calculations
  let protein = 0;
  let fats = 0;
  let carbs = 0;

  if (params.macroMethod === "sportsScience") {
    // 2.0g per kg protein (0.9g per lb)
    protein = Math.round(weightKg * 2.0);
    // 0.8g per kg fat (0.36g per lb)
    fats = Math.round(weightKg * 0.8);

    // Carbs fill the remainder
    const proteinKcal = protein * 4;
    const fatsKcal = fats * 9;
    const remainingKcal = Math.max(0, calories - (proteinKcal + fatsKcal));
    carbs = Math.round(remainingKcal / 4);
  } else {
    // Percentage splits
    let pRatio = 0.3;
    let cRatio = 0.4;
    let fRatio = 0.3;

    if (params.macroMethod === "highProtein") {
      pRatio = 0.4;
      cRatio = 0.3;
      fRatio = 0.3;
    } else if (params.macroMethod === "lowCarb") {
      pRatio = 0.25;
      cRatio = 0.05;
      fRatio = 0.7;
    } else if (params.macroMethod === "bodybuilder") {
      pRatio = 0.35;
      cRatio = 0.45;
      fRatio = 0.2;
    }

    protein = Math.round((calories * pRatio) / 4);
    carbs = Math.round((calories * cRatio) / 4);
    fats = Math.round((calories * fRatio) / 9);
  }

  return {
    calories,
    protein,
    carbs,
    fats,
    bmr,
    tdee,
  };
}
