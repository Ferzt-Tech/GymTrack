import { isNative } from "./platform";

/** Guarded web vibration — a no-op (never throws) where the Vibration API
 *  doesn't exist, e.g. iOS Safari. The one implementation every non-native
 *  vibrate call site should route through, per the "don't call
 *  navigator.vibrate directly on iOS" project rule. */
export function webVibrate(pattern: number | number[]) {
  try { if ("vibrate" in navigator) navigator.vibrate(pattern); } catch {}
}

/** Short UI-tap haptic — Capacitor Haptics impact (light for a bare tap,
 *  medium for a longer/array pattern) on native, guarded navigator.vibrate
 *  on web. */
export async function vibrate(pattern: number | number[]) {
  if (isNative) {
    try {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      const isLight = !Array.isArray(pattern) && (pattern as number) <= 10;
      await Haptics.impact({ style: isLight ? ImpactStyle.Light : ImpactStyle.Medium });
    } catch {}
    return;
  }
  webVibrate(pattern);
}
