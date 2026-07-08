"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { resolveUserId } from "@/lib/auth-utils";
import { isNative } from "@/lib/platform";

export default function Root() {
  const router = useRouter();

  useEffect(() => {
    async function redirect() {
      // 1. Wait for Service Worker to be active so it intercepts RSC payload fetches (web only)
      if (!isNative && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        try {
          if (!navigator.serviceWorker.controller) {
            // Use a 2-second timeout so we never hang indefinitely on web if registration fails
            const reg = await Promise.race([
              navigator.serviceWorker.ready,
              new Promise<undefined>((resolve) => setTimeout(resolve, 2000)),
            ]);

            if (reg) {
              const sw = reg.active || reg.waiting || reg.installing;
              if (sw) {
                if (sw.state !== "activated") {
                  await Promise.race([
                    new Promise<void>((resolve) => {
                      sw.addEventListener("statechange", () => {
                        if (sw.state === "activated") resolve();
                      });
                    }),
                    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
                  ]);
                }
              }
              // Wait a brief tick for controller registration
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
        } catch (e) {
          console.error("SW ready wait failed", e);
        }
      }

      // 2. Resolve authentication and redirect
      const userId = await resolveUserId();
      if (userId) {
        router.replace("/home");
      } else {
        router.replace("/login");
      }
    }
    redirect();
  }, [router]);
  return null;
}

