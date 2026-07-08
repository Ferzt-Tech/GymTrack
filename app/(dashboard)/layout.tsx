"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/lib/hooks/useProfile";
import { useWaterReminder } from "@/lib/hooks/useWaterReminder";
import { playNavTap, playPageTransition, playSignOut, playBoot, unlockAudio } from "@/lib/sounds";
import { NavProvider, useNav } from "@/lib/context/NavContext";
import { OnlineSyncProvider, useOnlineSync } from "@/lib/hooks/useOnlineSync";
import { clearCache, getCached } from "@/lib/offlineQueue";
import { useT } from "@/lib/context/LanguageContext";
import { isNative, isIOS, isAndroid } from "@/lib/platform";
import { resolveUserId } from "@/lib/auth-utils";

const NAV_SECTORS = [
  { href: "/home",     sector: "HOME.SYS",  Icon: HomeIcon     },
  { href: "/training", sector: "TRAIN.SYS", Icon: TrainIcon    },
  { href: "/stats",    sector: "STATS.SYS", Icon: StatsIcon    },
  { href: "/settings", sector: "CFG.SYS",   Icon: SettingsIcon },
] as const;

const PILL_SPRING = { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.75 };
const PAGE_SPRING = { type: "spring" as const, stiffness: 360, damping: 34, mass: 0.85 };

async function vibrate(pattern: number | number[]) {
  if (isNative) {
    try {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      const isLight = !Array.isArray(pattern) && (pattern as number) <= 10;
      await Haptics.impact({ style: isLight ? ImpactStyle.Light : ImpactStyle.Medium });
    } catch {}
    return;
  }
  try { if ("vibrate" in navigator) navigator.vibrate(pattern); } catch {}
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <NavProvider>
      <OnlineSyncProvider>
        <DashboardLayoutInner>{children}</DashboardLayoutInner>
      </OnlineSyncProvider>
    </NavProvider>
  );
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const { navHidden } = useNav();
  const router   = useRouter();
  const path     = usePathname();
  const { profile } = useProfile();
  const t = useT();
  useWaterReminder(profile);
  const { isOnline, syncState } = useOnlineSync();

  const NAV = [
    { href: "/home",     label: t.nav.home,     sector: "HOME.SYS",  Icon: HomeIcon     },
    { href: "/training", label: t.nav.train,    sector: "TRAIN.SYS", Icon: TrainIcon    },
    { href: "/stats",    label: t.nav.stats,    sector: "STATS.SYS", Icon: StatsIcon    },
    { href: "/settings", label: t.nav.settings, sector: "CFG.SYS",   Icon: SettingsIcon },
  ];

  const basePath    = path.replace(/\/$/, "");
  const showHeader  = (basePath === "/home" || basePath === "/settings") && !navHidden;

  const booted      = useRef(false);
  const prevPath    = useRef(path);
  const sectorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sectorLabel, setSectorLabel] = useState<string | null>(null);

  // ── Auth guard (runs once on mount) ──
  // Uses resolveUserId() — hits IndexedDB first (no network), then getSession()
  // with a 4s timeout. Prevents the 30-75s hang when JWT is expired and
  // Supabase tries to refresh it on WiFi-with-no-internet.
  useEffect(() => {
    async function checkAuth() {
      const userId = await resolveUserId();
      if (userId) return;
      router.replace("/login");
    }
    checkAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ── Supabase session expiry detector ──
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any) => {
      if (event === "SIGNED_OUT") {
        const userId = await getCached<string>("auth:userId");
        if (userId === "guest-user") return;

        if (typeof navigator !== "undefined" && !navigator.onLine) {
          return;
        }
        clearCache("auth:userId").catch(() => {});
        router.replace("/login");
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  // ── Boot chime (once per session) ──
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      playBoot(); // silent on iOS until audio unlocked by first tap — acceptable
    }
  }, []);

  // ── Native: status bar + Android back button ──
  useEffect(() => {
    if (!isNative) return;

    // Status bar: light icons (white text) on our dark background
    import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: Style.Light }).catch(() => {});
      if (isAndroid) StatusBar.setBackgroundColor({ color: "#080808" }).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isNative || isIOS) return; // Android only
    let removed = false;
    let handle: { remove: () => void } | null = null;
    import("@capacitor/app").then(({ App }) => {
      if (removed) return;
      App.addListener("backButton", ({ canGoBack }) => {
        if (navHidden) return; // active workout open — block hardware back
        if (canGoBack) window.history.back();
        else App.exitApp();
      }).then(h => { handle = h; }).catch(() => {});
    }).catch(() => {});
    return () => { removed = true; handle?.remove(); };
  }, [navHidden]);

  // ── Page-transition sound ──
  useEffect(() => {
    if (prevPath.current !== path) {
      playPageTransition();
      prevPath.current = path;
    }
  }, [path]);

  // ── Gyroscope parallax: update CSS vars → orbs shift with phone tilt ──
  useEffect(() => {
    function onOrient(e: DeviceOrientationEvent) {
      const x = (e.gamma ?? 0) * 1.4;
      const y = (e.beta  ?? 0) * 0.9;
      document.documentElement.style.setProperty("--orb-tilt-x", `${x}px`);
      document.documentElement.style.setProperty("--orb-tilt-y", `${y}px`);
    }

    // iOS 13+ requires explicit permission for DeviceOrientationEvent.
    // We request it on the first tap (user gesture) so no extra prompt UI is needed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const DOE = DeviceOrientationEvent as any;
    if (typeof DOE.requestPermission === "function") {
      const onFirstPointer = () => {
        window.removeEventListener("pointerdown", onFirstPointer);
        DOE.requestPermission().then((state: string) => {
          if (state === "granted") window.addEventListener("deviceorientation", onOrient);
        }).catch(() => {});
      };
      window.addEventListener("pointerdown", onFirstPointer);
      return () => {
        window.removeEventListener("pointerdown", onFirstPointer);
        window.removeEventListener("deviceorientation", onOrient);
      };
    }

    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, []);

  // ── Global tap ripple + iOS audio unlock ──
  useEffect(() => {
    function spawn(e: PointerEvent) {
      unlockAudio(); // resumes AudioContext on first tap (required on iOS)
      const el = document.createElement("div");
      el.className = "tap-ripple";
      el.style.left = `${e.clientX}px`;
      el.style.top  = `${e.clientY}px`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 800);
    }
    window.addEventListener("pointerdown", spawn);
    return () => window.removeEventListener("pointerdown", spawn);
  }, []);

  useEffect(() => {
    return () => { if (sectorTimer.current) clearTimeout(sectorTimer.current); };
  }, []);

  function showSector(sector: string) {
    if (sectorTimer.current) clearTimeout(sectorTimer.current);
    setSectorLabel(sector);
    sectorTimer.current = setTimeout(() => setSectorLabel(null), 1300);
  }

  async function signOut() {
    playSignOut();
    vibrate([8, 44, 8, 44, 18]);
    await clearCache("auth:userId");
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex flex-col max-w-xl mx-auto relative">

      {/* ── CRT scan line ── */}
      <div className="scanline" aria-hidden="true" />

      {/* ── Ambient orbs (gyroscope-driven parallax via CSS translate) ── */}
      <div className="orb orb-1" aria-hidden="true" />
      <div className="orb orb-2" aria-hidden="true" />
      <div className="orb orb-3" aria-hidden="true" />

      {/* ── Floating Glass Header (home + settings only, hidden during active workout) ── */}
      <AnimatePresence>
      {showHeader && (
        <motion.header
          key="app-header"
          initial={{ opacity: 0, y: -20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -14, scale: 0.96 }}
          transition={{ ...PILL_SPRING, delay: 0.04 }}
          className="liquid-header mx-4 safe-area-header mb-1 flex items-center justify-between px-4 py-3 relative z-20"
        >
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={26} height={26} className="logo-gem" />
            <span className="metric text-[16px] font-bold tracking-tight text-[var(--text)]">
              GymTrack
            </span>
          </div>
          <motion.button
            whileTap={{ scale: 0.90, opacity: 0.65 }}
            transition={{ type: "spring", stiffness: 600, damping: 25 }}
            onClick={signOut}
            className="text-[12px] font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors duration-150 px-3 py-1.5 rounded-xl hover:bg-[var(--surface)]"
          >
            {t.nav.signOut}
          </motion.button>
        </motion.header>
      )}
      </AnimatePresence>

      {/* ── Offline / sync banner (all pages) ── */}
      {(!isOnline || syncState === "syncing" || syncState === "done") && (
        <div className={`mx-4 mb-1 px-3 py-1.5 rounded-xl text-[11px] font-medium text-center transition-colors ${
          !isOnline
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : syncState === "syncing"
            ? "bg-[var(--surface)] text-[var(--muted)]"
            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        }`}>
          {!isOnline
            ? t.nav.offline
            : syncState === "syncing"
            ? t.nav.syncing
            : t.nav.synced}
        </div>
      )}

      {/* ── Page content with physics transitions ── */}
      <main className="flex-1 px-4 pt-2 safe-area-content relative z-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={path}
            initial={{ opacity: 0, y: 22, scale: 0.975 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 1.012 }}
            transition={PAGE_SPRING}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── Liquid Glass Bottom Nav ── */}
      <AnimatePresence>
      {!navHidden && (
      <motion.nav
        key="bottom-nav"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className="fixed z-50 w-[min(92vw,368px)] safe-area-bottom-nav"
        style={{ left: "50%", x: "-50%" }}
      >
        {/* Sector readout — instrument panel label */}
        <div className="flex justify-center mb-2" style={{ height: "26px" }}>
          <AnimatePresence>
            {sectorLabel && (
              <motion.div
                key={sectorLabel}
                initial={{ opacity: 0, y: 10, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.90 }}
                transition={{ type: "spring", stiffness: 540, damping: 28 }}
                className="sector-readout"
              >
                ◈ {sectorLabel} / NOMINAL
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.88 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...PILL_SPRING, delay: 0.08 }}
          className="liquid-nav rounded-[26px] p-1.5"
        >
          <div className="relative flex">
            {NAV.map(({ href, label, sector, Icon }) => {
              const active = path === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex-1"
                  onClick={() => {
                    if (path !== href) {
                      playNavTap();
                      vibrate(6);
                    }
                    showSector(sector);
                  }}
                >
                  <motion.div
                    whileTap={{ scale: 0.86 }}
                    transition={{ type: "spring", stiffness: 650, damping: 26 }}
                    className="relative flex flex-col items-center gap-[3px] py-2.5 rounded-[20px]"
                  >
                    {/* Physics-spring shared-element pill */}
                    {active && (
                      <motion.div
                        layoutId="liquid-pill"
                        className="liquid-pill absolute inset-0 rounded-[20px]"
                        transition={PILL_SPRING}
                      />
                    )}

                    <motion.span
                      animate={{ scale: active ? 1.14 : 1 }}
                      transition={{ type: "spring", stiffness: 520, damping: 28 }}
                      className={`relative z-10 transition-colors duration-200 ${
                        active ? "text-[var(--accent)]" : "text-[var(--muted)]"
                      }`}
                    >
                      <Icon active={active} />
                    </motion.span>

                    <motion.span
                      animate={{ opacity: active ? 1 : 0.42 }}
                      transition={{ duration: 0.18 }}
                      className="relative z-10 text-[9px] tracking-wide text-[var(--text)]"
                      style={{ fontWeight: active ? 650 : 400 }}
                    >
                      {label}
                    </motion.span>
                  </motion.div>
                </Link>
              );
            })}
          </div>
        </motion.div>
      </motion.nav>
      )}
      </AnimatePresence>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────── */

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2.2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function TrainIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2.2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 6.5h11M6.5 17.5h11M4 9.5h2v5H4zM18 9.5h2v5h-2z" />
      <rect x="2" y="11" width="2" height="2" rx="0.5" />
      <rect x="20" y="11" width="2" height="2" rx="0.5" />
    </svg>
  );
}

function StatsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2.2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6"  y1="20" x2="6"  y2="14" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2.2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
