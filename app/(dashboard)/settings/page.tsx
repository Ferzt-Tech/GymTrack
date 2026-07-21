"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useProfile } from "@/lib/hooks/useProfile";
import { useWaterReminder } from "@/lib/hooks/useWaterReminder";
import { useTheme } from "@/lib/context/ThemeContext";
import { useLanguage, useT, type Language } from "@/lib/context/LanguageContext";
import type { WeightUnit, DistanceUnit } from "@/types";
import {
  getOnlineSession,
  connectBackupAccount,
  signUpBackupAccount,
  disconnectBackupAccount,
  backupToCloud,
  restoreFromCloud,
} from "@/lib/backupService";
import { useDevMode } from "@/lib/hooks/useDevMode";
import { isAiScannerEnabled, setAiScannerEnabled } from "@/lib/devMode";
import { getUserGeminiKey, setUserGeminiKey } from "@/lib/foodAi";
import { exportAllAsJson, exportWorkoutsAsCsv } from "@/lib/exportData";

const aiT = {
  en: {
    title: "AI Meal Scanner",
    desc: "Estimate calories and macros from a photo or a text description of your meal, powered by Google Gemini. Paste your own free API key — it is stored only on this device and never uploaded.",
    getKey: "Get a free key at aistudio.google.com",
    keyPlaceholder: "Gemini API key",
    save: "Save key",
    saved: "AI scanner enabled — the AI tab is now available in the food logger.",
    removed: "Key removed — AI scanner disabled.",
    remove: "Remove key",
  },
  es: {
    title: "Escáner IA de Comidas",
    desc: "Estima calorías y macros desde una foto o una descripción de tu comida, con Google Gemini. Pega tu propia clave API gratuita — se guarda solo en este dispositivo y nunca se sube.",
    getKey: "Obtén una clave gratis en aistudio.google.com",
    keyPlaceholder: "Clave API de Gemini",
    save: "Guardar clave",
    saved: "Escáner IA activado — la pestaña IA ya está disponible en el registro de comidas.",
    removed: "Clave eliminada — escáner IA desactivado.",
    remove: "Eliminar clave",
  },
};

const exportT = {
  en: {
    title: "Data Export",
    desc: "Your data is 100% yours. Download everything stored on this device at any time.",
    json: "Export all data (JSON)",
    csv: "Export workouts (CSV)",
    error: "Export failed. Please try again.",
  },
  es: {
    title: "Exportar Datos",
    desc: "Tus datos son 100% tuyos. Descarga todo lo guardado en este dispositivo cuando quieras.",
    json: "Exportar todos los datos (JSON)",
    csv: "Exportar entrenamientos (CSV)",
    error: "La exportación falló. Inténtalo de nuevo.",
  },
};

const devT = {
  en: {
    title: "Developer Mode",
    desc: "Private tools for the developer account. This section is only visible to allowlisted accounts.",
    account: "Dev Account",
    aiToggle: "AI Meal Scanner",
    aiToggleDesc: "Gemini-powered calorie estimation in the food logger. Exclusive to this account — other users only see manual entry, database search and barcode scanning.",
  },
  es: {
    title: "Modo Desarrollador",
    desc: "Herramientas privadas para la cuenta de desarrollador. Esta sección solo es visible para cuentas autorizadas.",
    account: "Cuenta Dev",
    aiToggle: "Escáner IA de Comidas",
    aiToggleDesc: "Estimación de calorías con Gemini en el registro de comidas. Exclusivo de esta cuenta — los demás usuarios solo ven entrada manual, búsqueda en base de datos y escaneo de código de barras.",
  }
};

const backupT = {
  en: {
    title: "Cloud Backup & Restore",
    desc: "Create an online account to back up and restore your local data. GymTrack works 100% locally and offline by default, and never auto-saves to the cloud.",
    email: "Email Address",
    password: "Password",
    signIn: "Connect Account",
    signUp: "Create Backup Account",
    backupNow: "Backup to Cloud",
    restoreNow: "Restore from Cloud",
    disconnect: "Disconnect Account",
    backingUp: "Backing up...",
    restoring: "Restoring...",
    backupSuccess: "Local database successfully backed up to cloud!",
    restoreSuccess: "Database successfully restored from cloud! Reloading page...",
    statusConnected: "Connected to Cloud",
    account: "Account",
    emptyCredentials: "Email and password are required.",
    confirmRestore: "WARNING: Restoring from cloud will overwrite all your current local workout data and progress. Are you sure you want to proceed?",
  },
  es: {
    title: "Copia de Seguridad y Restauración",
    desc: "Crea una cuenta en línea para respaldar y restaurar tus datos locales. GymTrack funciona 100% de forma local y sin conexión de forma predeterminada, y nunca guarda automáticamente en la nube.",
    email: "Correo Electrónico",
    password: "Contraseña",
    signIn: "Conectar Cuenta",
    signUp: "Crear Cuenta de Respaldo",
    backupNow: "Respaldar en la Nube",
    restoreNow: "Restaurar de la Nube",
    disconnect: "Desconectar Cuenta",
    backingUp: "Respaldando...",
    restoring: "Restaurando...",
    backupSuccess: "¡Base de datos local respaldada en la nube con éxito!",
    restoreSuccess: "¡Base de datos restaurada de la nube con éxito! Recargando página...",
    statusConnected: "Conectado a la Nube",
    account: "Cuenta",
    emptyCredentials: "El correo y la contraseña son requeridos.",
    confirmRestore: "ADVERTENCIA: Restaurar desde la nube sobrescribirá todos tus datos de entrenamiento y progreso locales actuales. ¿Estás seguro de que deseas continuar?",
  }
};

const installT = {
  en: {
    title: "App Installation",
    desc: "Install GymTrack on your device's home screen for full-screen hypertrophy tracking, fast offline performance, and easy access.",
    btnInstall: "Install App",
    iosGuideTitle: "Install on iOS (Safari)",
    iosGuideDesc: "Safari on iOS does not support one-tap installation. To install: tap the share button (square with up arrow) at the bottom, then scroll down and tap 'Add to Home Screen'.",
    androidGuideDesc: "If the button above doesn't work, tap the browser's menu (three dots) in Chrome or Firefox and select 'Install app' or 'Add to Home screen'.",
    alreadyInstalled: "App is already installed and running in fullscreen standalone mode.",
  },
  es: {
    title: "Instalación de la Aplicación",
    desc: "Instala GymTrack en la pantalla de inicio de tu dispositivo para un seguimiento en pantalla completa, un rendimiento rápido sin conexión y un acceso sencillo.",
    btnInstall: "Instalar Aplicación",
    iosGuideTitle: "Instalar en iOS (Safari)",
    iosGuideDesc: "Safari en iOS no admite la instalación de un toque. Para instalar: toca el botón compartir (cuadrado con flecha hacia arriba) en la parte inferior, desplázate hacia abajo y toca 'Agregar a la pantalla de inicio'.",
    androidGuideDesc: "Si el botón anterior no funciona, toca el menú del navegador (tres puntos) en Chrome o Firefox y selecciona 'Instalar aplicación' o 'Agregar a la pantalla de inicio'.",
    alreadyInstalled: "La aplicación ya está instalada y ejecutándose en modo de pantalla completa.",
  }
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-all duration-200 shrink-0",
        checked
          ? "bg-[var(--accent)] shadow-[0_0_10px_rgba(var(--accent-rgb),0.40)]"
          : "bg-gray-300 dark:bg-[#2a2a2a]"
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 h-4 w-4 rounded-full transition-transform duration-200 shadow-sm",
          checked ? "translate-x-5 bg-[#041a1f]" : "bg-white dark:bg-[#555]"
        )}
      />
    </button>
  );
}

function SegmentPicker<T extends string>({
  options, value, onChange,
}: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex border border-[var(--border)] rounded-xl overflow-hidden">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "flex-1 py-2 text-sm font-semibold transition-all duration-150 uppercase tracking-wider metric",
            value === opt
              ? "bg-[var(--accent)] text-[#041a1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
              : "text-[var(--sub)] hover:text-[var(--muted)]"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { profile, loading, updateProfile } = useProfile();
  // Pass null so this instance never schedules a reminder interval —
  // the dashboard layout already runs one; here we only need requestPermission.
  const { requestPermission } = useWaterReminder(null);
  const { theme, setTheme }   = useTheme();
  const { language, setLanguage } = useLanguage();
  const t = useT();

  const [username,    setUsername]    = useState("");
  const [weightUnit,  setWeightUnit]  = useState<WeightUnit>("kg");
  const [distUnit,    setDistUnit]    = useState<DistanceUnit>("km");
  const [waterGoal,   setWaterGoal]   = useState("2.5");
  const [reminders,   setReminders]   = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [notifPerm,   setNotifPerm]   = useState<NotificationPermission | "unsupported">("default");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Backup / restore states
  const [onlineSession,   setOnlineSession]   = useState<any>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [cloudEmail,      setCloudEmail]      = useState("");
  const [cloudPassword,   setCloudPassword]   = useState("");
  const [cloudLoading,    setCloudLoading]    = useState(false);
  const [cloudError,      setCloudError]      = useState<string | null>(null);
  const [cloudSuccess,    setCloudSuccess]    = useState<string | null>(null);
  const [cloudOp,         setCloudOp]         = useState<"backup" | "restore" | null>(null);

  const bt = backupT[language === "es" ? "es" : "en"];

  // Developer mode (visible only to allowlisted accounts)
  const { isDev, devEmail } = useDevMode();
  const [devAiEnabled, setDevAiEnabled] = useState(true);
  const dt = devT[language === "es" ? "es" : "en"];

  // AI meal scanner — personal Gemini API key (any user, device-local)
  const at = aiT[language === "es" ? "es" : "en"];
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [hasGeminiKey,   setHasGeminiKey]   = useState(false);
  const [aiKeyMsg,       setAiKeyMsg]       = useState<string | null>(null);

  useEffect(() => {
    setHasGeminiKey(!!getUserGeminiKey());
  }, []);

  function saveGeminiKey() {
    if (!geminiKeyInput.trim()) return;
    setUserGeminiKey(geminiKeyInput);
    setGeminiKeyInput("");
    setHasGeminiKey(true);
    setAiKeyMsg(at.saved);
  }

  function removeGeminiKey() {
    setUserGeminiKey("");
    setHasGeminiKey(false);
    setAiKeyMsg(at.removed);
  }

  // Data export
  const xt = exportT[language === "es" ? "es" : "en"];
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const [exportErr, setExportErr] = useState(false);

  async function handleExport(kind: "json" | "csv") {
    setExporting(kind);
    setExportErr(false);
    try {
      if (kind === "json") await exportAllAsJson();
      else await exportWorkoutsAsCsv();
    } catch {
      setExportErr(true);
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => {
    setDevAiEnabled(isAiScannerEnabled());
  }, []);

  function toggleDevAi(v: boolean) {
    setDevAiEnabled(v);
    setAiScannerEnabled(v);
  }

  // PWA Install states
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOSBrowser, setIsIOSBrowser] = useState(false);
  const [isAndroidBrowser, setIsAndroidBrowser] = useState(false);

  const it = installT[language === "es" ? "es" : "en"];

  useEffect(() => {
    async function checkBackupSession() {
      try {
        const { session } = await getOnlineSession();
        setOnlineSession(session);
      } catch (err) {
        console.error("Error checking backup session", err);
      } finally {
        setCheckingSession(false);
      }
    }
    checkBackupSession();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check standalone mode
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone;
    setIsStandalone(!!standalone);

    // Platform checks
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    const isAndroid = /Android/.test(ua);
    setIsIOSBrowser(isIOS && !standalone);
    setIsAndroidBrowser(isAndroid && !standalone);

    if ((window as any).deferredPrompt) {
      setInstallPrompt((window as any).deferredPrompt);
    }

    const handleInstallable = () => {
      if ((window as any).deferredPrompt) {
        setInstallPrompt((window as any).deferredPrompt);
      }
    };
    window.addEventListener("pwa-installable", handleInstallable);
    return () => {
      window.removeEventListener("pwa-installable", handleInstallable);
    };
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallPrompt(null);
      (window as any).deferredPrompt = null;
    }
  }

  async function handleConnect(isSignUp = false) {
    if (!cloudEmail.trim() || !cloudPassword) {
      setCloudError(bt.emptyCredentials);
      return;
    }
    setCloudLoading(true);
    setCloudError(null);
    setCloudSuccess(null);
    try {
      const { data, error } = isSignUp
        ? await signUpBackupAccount(cloudEmail.trim(), cloudPassword)
        : await connectBackupAccount(cloudEmail.trim(), cloudPassword);

      if (error) {
        setCloudError(error.message);
      } else if (data) {
        const { session } = await getOnlineSession();
        setOnlineSession(session);
        setCloudEmail("");
        setCloudPassword("");
      }
    } catch (err: any) {
      setCloudError(err.message || "An error occurred.");
    } finally {
      setCloudLoading(false);
    }
  }

  async function handleDisconnect() {
    setCloudLoading(true);
    setCloudError(null);
    setCloudSuccess(null);
    try {
      await disconnectBackupAccount();
      setOnlineSession(null);
    } catch (err: any) {
      setCloudError(err.message || "An error occurred.");
    } finally {
      setCloudLoading(false);
    }
  }

  async function handleBackup() {
    setCloudLoading(true);
    setCloudOp("backup");
    setCloudError(null);
    setCloudSuccess(null);
    try {
      await backupToCloud();
      setCloudSuccess(bt.backupSuccess);
    } catch (err: any) {
      setCloudError(err.message || "Backup failed.");
    } finally {
      setCloudLoading(false);
      setCloudOp(null);
    }
  }

  async function handleRestore() {
    if (!window.confirm(bt.confirmRestore)) return;

    setCloudLoading(true);
    setCloudOp("restore");
    setCloudError(null);
    setCloudSuccess(null);
    try {
      await restoreFromCloud();
      setCloudSuccess(bt.restoreSuccess);
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      setCloudError(err.message || "Restore failed.");
    } finally {
      setCloudLoading(false);
      setCloudOp(null);
    }
  }

  useEffect(() => {
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, []);

  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username ?? "");
    setWeightUnit(profile.weight_unit);
    setDistUnit(profile.distance_unit);
    setWaterGoal(String(profile.water_goal_liters));
    setReminders(profile.water_reminder_enabled);
  }, [profile]);

  useEffect(() => {
    setNotifPerm(
      typeof Notification === "undefined" ? "unsupported" : Notification.permission
    );
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await updateProfile({
      username:               username.trim() || null,
      weight_unit:            weightUnit,
      distance_unit:          distUnit,
      water_goal_liters:      parseFloat(waterGoal),
      water_reminder_enabled: reminders,
    } as Parameters<typeof updateProfile>[0]);
    setSaving(false);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }

  async function enableNotifications() {
    const granted = await requestPermission();
    setNotifPerm(granted ? "granted" : "denied");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--muted)] text-sm">
        {t.settings.loading}
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      <h1 className="metric text-2xl font-semibold tracking-tight text-[var(--text)] mb-4 animate-spring-up">
        {t.settings.settings}
      </h1>

      <form onSubmit={handleSave} className="space-y-3">

        {/* Profile */}
        <div className="card-glass p-4 space-y-3 animate-spring-up stagger-1">
          <p className="section-label">{t.settings.profile}</p>
          <input
            type="text"
            placeholder={t.settings.displayName}
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="input-base"
          />
        </div>

        {/* Appearance */}
        <div className="card-glass p-4 space-y-3 animate-spring-up stagger-2">
          <p className="section-label">{t.settings.appearance}</p>
          <div className="flex items-center justify-between py-0.5">
            <div>
              <p className="text-sm text-[var(--text)]">{t.settings.darkMode}</p>
              <p className="text-[11px] text-[var(--faint)] mt-0.5">{t.settings.darkModeDesc}</p>
            </div>
            <Toggle checked={theme === "dark"} onChange={v => setTheme(v ? "dark" : "light")} />
          </div>
        </div>

        {/* Language */}
        <div className="card-glass p-4 space-y-3 animate-spring-up stagger-2">
          <p className="section-label">{t.settings.language}</p>
          <SegmentPicker<Language> options={["en", "es"]} value={language} onChange={setLanguage} />
        </div>

        {/* Units */}
        <div className="card-glass p-4 space-y-4 animate-spring-up stagger-3">
          <p className="section-label">{t.settings.units}</p>
          <div>
            <p className="text-sm text-[var(--muted)] mb-2">{t.settings.weight}</p>
            <SegmentPicker<WeightUnit> options={["kg", "lbs"]} value={weightUnit} onChange={setWeightUnit} />
          </div>
          <div>
            <p className="text-sm text-[var(--muted)] mb-2">{t.settings.distance}</p>
            <SegmentPicker<DistanceUnit> options={["km", "mi"]} value={distUnit} onChange={setDistUnit} />
          </div>
        </div>

        {/* Hydration */}
        <div className="card-glass p-4 space-y-4 animate-spring-up stagger-4">
          <p className="section-label">{t.settings.hydration}</p>

          <div>
            <p className="text-sm text-[var(--muted)] mb-2">{t.settings.dailyWaterGoal}</p>
            <div className="flex gap-2 mb-3">
              {["2.0", "2.5", "3.0"].map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setWaterGoal(v)}
                  className={cn(
                    "flex-1 py-2 rounded-xl border text-sm transition-all metric",
                    waterGoal === v
                      ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-faint)]"
                      : "border-[var(--border)] text-[var(--faint)] hover:text-[var(--muted)]"
                  )}
                >
                  {v} L
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.1"
                min="1"
                max="6"
                value={waterGoal}
                onChange={e => setWaterGoal(e.target.value)}
                className="input-base"
              />
              <span className="text-[var(--faint)] text-sm shrink-0">{t.settings.lPerDay}</span>
            </div>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <div>
              <p className="text-sm text-[var(--text)]">{t.settings.waterReminders}</p>
              <p className="text-[11px] text-[var(--faint)] mt-0.5">{t.settings.waterRemindersDesc}</p>
            </div>
            <Toggle checked={reminders} onChange={setReminders} />
          </div>

          {reminders && notifPerm !== "granted" && notifPerm !== "unsupported" && (
            <div className="bg-[var(--accent-faint)] border border-[rgba(var(--accent-rgb),0.15)] rounded-xl p-3">
              {notifPerm === "denied" ? (
                <p className="text-[12px] text-[var(--sub)]">
                  {t.settings.notificationsBlocked}
                </p>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-[var(--muted)]">
                    {t.settings.allowNotifications}
                  </p>
                  <button
                    type="button"
                    onClick={enableNotifications}
                    className="btn-outline shrink-0 py-1.5 px-3 text-[12px]"
                  >
                    {t.settings.allow}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <button type="submit" disabled={saving} className="btn-aqua w-full animate-spring-up stagger-5">
          {saved ? t.settings.saved : saving ? t.settings.saving : t.settings.saveSettings}
        </button>
      </form>

  {/* PWA App Installation Section */}
  {!isStandalone && (
    <div
      className="card-glass p-4 space-y-4 animate-spring-up stagger-5 mt-4"
      style={{ borderColor: "rgba(var(--accent-rgb), 0.2)" }}
    >
      <p className="section-label">{it.title}</p>
      <p className="text-[11px] text-[var(--faint)] leading-relaxed">
        {it.desc}
      </p>

      {installPrompt && (
        <button
          type="button"
          onClick={handleInstall}
          className="btn-aqua w-full text-xs py-2.5 animate-spring-scale"
        >
          {it.btnInstall}
        </button>
      )}

      {isIOSBrowser && (
        <div className="bg-[var(--accent-faint)] border border-[rgba(var(--accent-rgb),0.15)] rounded-xl p-3 space-y-2">
          <p className="text-[12px] font-semibold text-[var(--accent)] flex items-center gap-1.5">
            <span>◈</span> {it.iosGuideTitle}
          </p>
          <p className="text-[11px] text-[var(--muted)] leading-normal">
            {it.iosGuideDesc}
          </p>
        </div>
      )}

      {isAndroidBrowser && !installPrompt && (
        <div className="border border-[var(--border)] rounded-xl p-3">
          <p className="text-[11px] text-[var(--faint)] leading-normal">
            {it.androidGuideDesc}
          </p>
        </div>
      )}
    </div>
  )}

  {isStandalone && (
    <div
      className="card-glass p-4 animate-spring-up stagger-5 mt-4 border border-[var(--border)] opacity-80"
    >
      <p className="section-label">{it.title}</p>
      <p className="text-[11px] text-[var(--accent)] flex items-center gap-1.5">
        <span>✓</span> {it.alreadyInstalled}
      </p>
    </div>
  )}

      {/* Cloud Backup & Restore Section */}
      <div className="card-glass p-4 space-y-4 animate-spring-up stagger-5 mt-4" style={{ borderColor: "rgba(var(--accent-rgb), 0.2)" }}>
        <p className="section-label">{bt.title}</p>
        <p className="text-[11px] text-[var(--faint)] leading-relaxed">
          {bt.desc}
        </p>

        {checkingSession ? (
          <div className="h-12 skeleton rounded-xl" />
        ) : onlineSession ? (
          <div className="space-y-3">
            <div className="sector-readout text-xs py-2 px-3 flex justify-between items-center">
              <span>{bt.account}:</span>
              <span className="font-semibold text-[var(--accent)] select-all">{onlineSession.user.email}</span>
            </div>

            {cloudError && <p className="text-xs text-red-400 font-medium metric">{cloudError}</p>}
            {cloudSuccess && <p className="text-xs text-[var(--accent)] font-medium metric">{cloudSuccess}</p>}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={cloudLoading}
                onClick={handleBackup}
                className="btn-aqua text-xs py-2.5"
              >
                {cloudLoading && cloudOp === "backup" ? bt.backingUp : bt.backupNow}
              </button>
              <button
                type="button"
                disabled={cloudLoading}
                onClick={handleRestore}
                className="btn-outline text-xs py-2.5"
              >
                {cloudLoading && cloudOp === "restore" ? bt.restoring : bt.restoreNow}
              </button>
            </div>

            <button
              type="button"
              disabled={cloudLoading}
              onClick={handleDisconnect}
              className="btn-ghost w-full text-xs text-red-400 hover:text-red-300 py-1"
            >
              {bt.disconnect}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {cloudError && <p className="text-xs text-red-400 font-medium metric">{cloudError}</p>}
            {cloudSuccess && <p className="text-xs text-[var(--accent)] font-medium metric">{cloudSuccess}</p>}

            <input
              type="email"
              placeholder={bt.email}
              value={cloudEmail}
              onChange={e => setCloudEmail(e.target.value)}
              className="input-base"
              disabled={cloudLoading}
            />
            <input
              type="password"
              placeholder={bt.password}
              value={cloudPassword}
              onChange={e => setCloudPassword(e.target.value)}
              className="input-base"
              disabled={cloudLoading}
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={cloudLoading}
                onClick={() => handleConnect(false)}
                className="btn-primary text-xs py-2.5"
              >
                {cloudLoading ? "..." : bt.signIn}
              </button>
              <button
                type="button"
                disabled={cloudLoading}
                onClick={() => handleConnect(true)}
                className="btn-outline text-xs py-2.5"
              >
                {cloudLoading ? "..." : bt.signUp}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI Meal Scanner — bring your own Gemini key (allowlisted user sonluisfernando@gmail.com only) */}
      {isDev && (
        <div className="card-glass p-4 space-y-3 animate-spring-up stagger-5 mt-4">
          <p className="section-label mb-0">◈ {at.title}</p>
          <p className="text-[11px] text-[var(--faint)] leading-relaxed">{at.desc}</p>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[var(--accent)] underline underline-offset-2 block"
          >
            {at.getKey}
          </a>

          {hasGeminiKey ? (
            <div className="flex items-center justify-between gap-3">
              <span className="sector-readout text-xs py-2 px-3 flex-1">AI.KEY / ACTIVE</span>
              <button type="button" onClick={removeGeminiKey} className="btn-ghost text-xs text-red-400 shrink-0">
                {at.remove}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="password"
                value={geminiKeyInput}
                onChange={e => setGeminiKeyInput(e.target.value)}
                placeholder={at.keyPlaceholder}
                autoComplete="off"
                className="input-base flex-1 text-sm"
              />
              <button
                type="button"
                onClick={saveGeminiKey}
                disabled={!geminiKeyInput.trim()}
                className="btn-aqua px-4 shrink-0 disabled:opacity-50"
              >
                {at.save}
              </button>
            </div>
          )}
          {aiKeyMsg && <p className="text-[11px] text-[var(--accent)]">{aiKeyMsg}</p>}
        </div>
      )}

      {/* Data Export */}
      <div className="card-glass p-4 space-y-3 animate-spring-up stagger-6 mt-4">
        <p className="section-label mb-0">◈ {xt.title}</p>
        <p className="text-[11px] text-[var(--faint)] leading-relaxed">{xt.desc}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleExport("json")}
            disabled={exporting !== null}
            className="btn-outline flex-1 text-xs disabled:opacity-50"
          >
            {exporting === "json" ? "…" : xt.json}
          </button>
          <button
            type="button"
            onClick={() => handleExport("csv")}
            disabled={exporting !== null}
            className="btn-outline flex-1 text-xs disabled:opacity-50"
          >
            {exporting === "csv" ? "…" : xt.csv}
          </button>
        </div>
        {exportErr && <p className="text-[11px] text-red-400">{xt.error}</p>}
      </div>

      {/* Developer Mode (allowlisted accounts only) */}
      {isDev && (
        <div
          className="card-glass p-4 space-y-4 animate-spring-up stagger-6 mt-4"
          style={{ borderColor: "rgba(var(--accent-rgb), 0.35)" }}
        >
          <div className="flex items-center justify-between">
            <p className="section-label mb-0">◈ {dt.title}</p>
            <span className="sector-readout text-[10px]">DEV.SYS / ACTIVE</span>
          </div>
          <p className="text-[11px] text-[var(--faint)] leading-relaxed">{dt.desc}</p>

          <div className="sector-readout text-xs py-2 px-3 flex justify-between items-center w-full">
            <span>{dt.account}:</span>
            <span className="font-semibold text-[var(--accent)] select-all">{devEmail}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <div className="pr-3">
              <p className="text-sm text-[var(--text)]">{dt.aiToggle}</p>
              <p className="text-[11px] text-[var(--faint)] mt-0.5">{dt.aiToggleDesc}</p>
            </div>
            <Toggle checked={devAiEnabled} onChange={toggleDevAi} />
          </div>
        </div>
      )}

      <div className="text-center pt-4 pb-2 space-y-1">
        <p className="text-[var(--dim)] text-[11px] tracking-widest uppercase">GymTrack</p>
        <p className="text-[var(--dim)] text-[10px]">{t.settings.version}</p>
      </div>

      <div
        className="card-glass p-3 mt-2 mb-4 space-y-3"
        style={{ borderColor: "rgba(var(--accent-rgb), 0.25)" }}
      >
        <p className="sector-readout justify-center w-full text-center">
          {t.settings.creditsTitle}
        </p>
        <div className="metric text-[11px] text-[var(--accent)] space-y-1.5">
          <div className="flex justify-between opacity-80"><span>{t.settings.architect}</span><span>Ferzt360</span></div>
          <div className="flex justify-between opacity-80"><span>{t.settings.state}</span><span>{t.settings.stateVal}</span></div>
          <div className="flex justify-between opacity-80"><span>{t.settings.catStatus}</span><span>{t.settings.catStatusVal}</span></div>
          <div className="flex justify-between opacity-80"><span>{t.settings.theorem}</span><span>{t.settings.theoremVal}</span></div>
        </div>
        <p className="text-[10px] text-[var(--accent)] opacity-50 text-center italic border-t border-[rgba(var(--accent-rgb),0.15)] pt-2">
          {t.settings.quote}
        </p>
      </div>
    </div>
  );
}
