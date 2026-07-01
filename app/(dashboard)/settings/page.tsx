"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useProfile } from "@/lib/hooks/useProfile";
import { useWaterReminder } from "@/lib/hooks/useWaterReminder";
import { useTheme } from "@/lib/context/ThemeContext";
import { useLanguage, useT, type Language } from "@/lib/context/LanguageContext";
import type { WeightUnit, DistanceUnit } from "@/types";

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
  const { requestPermission } = useWaterReminder(profile);
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
