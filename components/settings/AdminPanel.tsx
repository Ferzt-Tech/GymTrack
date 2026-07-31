"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/context/LanguageContext";
import { useNav } from "@/lib/context/NavContext";
import { isAiScannerGloballyEnabled, setAiScannerGloballyEnabled, fetchAdminStats } from "@/lib/appConfig";
import type { AdminStats } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

const adminT = {
  en: {
    sysLabel: "ADMIN.SYS",
    title: "Admin Panel",
    globalTitle: "AI Scanner — Global Access",
    globalDesc: "When enabled, every user can use the AI meal scanner from Settings → AI Meal Scanner, as long as they add their own free Gemini API key. This never affects your own access, which is always available.",
    enableForAll: "Enable for all users",
    flagError: "Could not update the setting. Check your connection and try again.",
    statsTitle: "App Stats",
    totalUsers: "Total Users",
    totalWorkoutSessions: "Workout Sessions",
    totalWorkoutSets: "Sets Logged",
    totalFoodLogs: "Food Logs",
    totalSavedFoods: "Saved Foods",
    totalExercises: "Exercises",
    usersWithOwnAiKey: "Users w/ Own AI Key",
    newUsersLast30d: "New Users (30d)",
    sessionsLast7d: "Sessions (7d)",
    foodLogsLast7d: "Food Logs (7d)",
    loading: "Loading stats…",
    statsError: "Could not load stats. Check your connection and try again.",
    retry: "Retry",
    refresh: "Refresh",
    generatedAt: "Updated",
  },
  es: {
    sysLabel: "ADMIN.SYS",
    title: "Panel de Administrador",
    globalTitle: "Escáner IA — Acceso Global",
    globalDesc: "Al activarlo, cualquier usuario podrá usar el escáner IA de comidas desde Ajustes → Escáner IA de Comidas, siempre que agregue su propia clave API de Gemini gratuita. Esto nunca afecta tu propio acceso, que siempre está disponible.",
    enableForAll: "Activar para todos los usuarios",
    flagError: "No se pudo actualizar el ajuste. Revisa tu conexión e inténtalo de nuevo.",
    statsTitle: "Estadísticas de la App",
    totalUsers: "Usuarios Totales",
    totalWorkoutSessions: "Sesiones de Entreno",
    totalWorkoutSets: "Series Registradas",
    totalFoodLogs: "Registros de Comida",
    totalSavedFoods: "Favoritos Guardados",
    totalExercises: "Ejercicios",
    usersWithOwnAiKey: "Usuarios con Clave IA Propia",
    newUsersLast30d: "Usuarios Nuevos (30d)",
    sessionsLast7d: "Sesiones (7d)",
    foodLogsLast7d: "Registros de Comida (7d)",
    loading: "Cargando estadísticas…",
    statsError: "No se pudieron cargar las estadísticas. Revisa tu conexión e inténtalo de nuevo.",
    retry: "Reintentar",
    refresh: "Actualizar",
    generatedAt: "Actualizado",
  },
};

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 disabled:opacity-50"
      style={{
        background: checked ? "var(--accent)" : undefined,
        boxShadow: checked ? "0 0 10px rgba(var(--accent-rgb), 0.40)" : undefined,
      }}
    >
      <span
        className="absolute top-1 left-1 h-4 w-4 rounded-full transition-transform duration-200 shadow-sm"
        style={{
          transform: checked ? "translateX(1.25rem)" : undefined,
          background: checked ? "#041a1f" : undefined,
        }}
      />
      {!checked && <span className="absolute top-1 left-1 h-4 w-4 rounded-full bg-gray-300 dark:bg-[#555]" />}
    </button>
  );
}

/** Full-screen "subpage" for the allowlisted admin account: global AI-scanner
 *  toggle + cross-user app stats. Not a route — an in-page overlay (mirrors
 *  FavoritesView): a nested route would break the nav pill/header, and
 *  hardware back is blocked while navHidden, so this ships its own back
 *  control. Only reachable via the Developer Mode card in Settings. */
export default function AdminPanel({ open, onClose }: Props) {
  const { language } = useLanguage();
  const { setNavHidden } = useNav();
  const at = adminT[language === "es" ? "es" : "en"];

  const [flagLoading, setFlagLoading] = useState(true);
  const [flagEnabled, setFlagEnabled] = useState(false);
  const [flagSaving, setFlagSaving] = useState(false);
  const [flagError, setFlagError] = useState(false);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    if (open) setNavHidden(true);
    return () => setNavHidden(false);
  }, [open, setNavHidden]);

  useEffect(() => {
    if (!open) return;
    loadFlag();
    loadStats();
  }, [open]);

  async function loadFlag() {
    setFlagLoading(true);
    setFlagError(false);
    try {
      setFlagEnabled(await isAiScannerGloballyEnabled());
    } catch {
      setFlagError(true);
    } finally {
      setFlagLoading(false);
    }
  }

  async function loadStats() {
    setStatsLoading(true);
    setStatsError(false);
    try {
      setStats(await fetchAdminStats());
    } catch {
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }

  async function toggleFlag(v: boolean) {
    const prev = flagEnabled;
    setFlagEnabled(v);
    setFlagSaving(true);
    setFlagError(false);
    try {
      await setAiScannerGloballyEnabled(v);
    } catch {
      setFlagEnabled(prev);
      setFlagError(true);
    } finally {
      setFlagSaving(false);
    }
  }

  const statTiles = stats
    ? [
        { label: at.totalUsers, value: stats.totalUsers },
        { label: at.totalWorkoutSessions, value: stats.totalWorkoutSessions },
        { label: at.totalWorkoutSets, value: stats.totalWorkoutSets },
        { label: at.totalFoodLogs, value: stats.totalFoodLogs },
        { label: at.totalSavedFoods, value: stats.totalSavedFoods },
        { label: at.totalExercises, value: stats.totalExercises },
        { label: at.usersWithOwnAiKey, value: stats.usersWithOwnAiKey },
        { label: at.newUsersLast30d, value: stats.newUsersLast30d },
        { label: at.sessionsLast7d, value: stats.sessionsLast7d },
        { label: at.foodLogsLast7d, value: stats.foodLogsLast7d },
      ]
    : [];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-[var(--bg)] flex flex-col">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 pb-3 border-b border-[var(--border)] shrink-0"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full border border-[var(--border)] hover:border-[var(--muted)] flex items-center justify-center text-[var(--muted)] shrink-0"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] text-[var(--accent)] font-mono tracking-widest uppercase">{at.sysLabel}</span>
          <h1 className="text-lg font-bold text-[var(--text)] leading-tight">{at.title}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Global AI access toggle */}
        <div
          className="card-glass p-4 space-y-3 animate-spring-up"
          style={{ borderColor: "rgba(var(--accent-rgb), 0.35)" }}
        >
          <div className="flex items-center justify-between">
            <p className="section-label mb-0">◈ {at.globalTitle}</p>
            <span className="sector-readout text-[10px]">{flagLoading ? "…" : flagEnabled ? "GLOBAL.ON" : "GLOBAL.OFF"}</span>
          </div>
          <p className="text-[11px] text-[var(--faint)] leading-relaxed">{at.globalDesc}</p>

          {flagLoading ? (
            <div className="h-8 skeleton rounded-xl" />
          ) : (
            <div className="flex items-center justify-between py-0.5">
              <p className="text-sm text-[var(--text)]">{at.enableForAll}</p>
              <Toggle checked={flagEnabled} onChange={toggleFlag} disabled={flagSaving} />
            </div>
          )}
          {flagError && <p className="text-[11px] text-red-400">{at.flagError}</p>}
        </div>

        {/* Cross-user app stats */}
        <div className="card-glass p-4 space-y-3 animate-spring-up stagger-1">
          <div className="flex items-center justify-between">
            <p className="section-label mb-0">◈ {at.statsTitle}</p>
            <button type="button" onClick={loadStats} className="text-[10px] text-[var(--accent)] underline underline-offset-2">
              {at.refresh}
            </button>
          </div>

          {statsLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-16 skeleton rounded-xl" />
              ))}
            </div>
          ) : statsError ? (
            <div className="space-y-2">
              <p className="text-[11px] text-red-400">{at.statsError}</p>
              <button type="button" onClick={loadStats} className="btn-outline text-xs py-2 w-full">
                {at.retry}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {statTiles.map(({ label, value }) => (
                  <div key={label} className="rounded-xl p-3 flex flex-col gap-1 bg-[var(--accent-faint)]">
                    <span className="metric text-[20px] font-semibold text-[var(--text)] leading-none">
                      {value.toLocaleString()}
                    </span>
                    <span className="text-[9px] font-mono text-[var(--faint)] uppercase tracking-wider leading-tight mt-0.5">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
              {stats && (
                <p className="text-[10px] text-[var(--dim)] text-center pt-1">
                  {at.generatedAt}: {new Date(stats.generatedAt).toLocaleString()}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
