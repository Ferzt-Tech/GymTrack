"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Profile } from "@/types";
import { isNative } from "@/lib/platform";

const REMINDER_INTERVAL_MS = 45 * 60 * 1000;

export function useWaterReminder(profile: Profile | null) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (isNative) {
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const { display } = await LocalNotifications.requestPermissions();
        return display === "granted";
      } catch { return false; }
    }
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  }, []);

  const sendReminder = useCallback(async (goal: number) => {
    try {
      if (isNative) {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        await LocalNotifications.schedule({
          notifications: [{
            id: Date.now() % 2147483647,
            title: "💧 Time to hydrate!",
            body: `Remember to drink water. Stay on track with your ${goal}L daily goal.`,
          }],
        });
      } else if ("Notification" in window && Notification.permission === "granted") {
        new Notification("💧 Time to hydrate!", {
          body: "Remember to drink water. Stay on track with your daily goal.",
          icon: "/icons/icon-192.png",
          tag: "water-reminder",
        });
      }
    } catch { /* notification bridge unavailable */ }
  }, []);

  useEffect(() => {
    if (!profile?.water_reminder_enabled) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }

    const goal = profile.water_goal_liters ?? 2.5;

    requestPermission().then((granted) => {
      if (!granted) return;
      intervalRef.current = setInterval(() => { void sendReminder(goal); }, REMINDER_INTERVAL_MS);
    });

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [profile?.water_reminder_enabled, profile?.water_goal_liters, requestPermission, sendReminder]);

  return { requestPermission };
}
