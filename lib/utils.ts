import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { WeightUnit, DistanceUnit } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function thirtyDaysAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function convertWeight(value: number, to: WeightUnit): number {
  if (to === "lbs") return Math.round(value * 2.20462 * 10) / 10;
  return Math.round(value / 2.20462 * 10) / 10;
}

export function displayWeight(kg: number, unit: WeightUnit): string {
  if (unit === "lbs") return `${convertWeight(kg, "lbs")} lbs`;
  return `${kg} kg`;
}

export function convertDistance(value: number, to: DistanceUnit): number {
  if (to === "mi") return Math.round(value * 0.621371 * 10) / 10;
  return Math.round(value / 0.621371 * 10) / 10;
}

export function waterPercent(current: number, goal: number): number {
  return Math.min(100, Math.round((current / goal) * 100));
}
