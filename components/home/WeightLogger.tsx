"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { todayISO } from "@/lib/utils";
import { enqueue } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import type { DailyWeightLog, WeightUnit } from "@/types";
import { useT } from "@/lib/context/LanguageContext";

interface Props {
  unit:       WeightUnit;
  weightLogs: DailyWeightLog[];
  onSaved:    (log: DailyWeightLog) => void;
}

export default function WeightLogger({ unit, weightLogs, onSaved }: Props) {
  const today = todayISO();
  const t = useT();
  const { triggerSync } = useOnlineSync();
  const [date,   setDate]   = useState(today);
  const [value,  setValue]  = useState("");
  const [saving, setSaving] = useState(false);
  const [done,   setDone]   = useState(false);

  const existing = weightLogs.find(l => l.logged_date === date) ?? null;

  useEffect(() => {
    const log = weightLogs.find(l => l.logged_date === date) ?? null;
    setValue(
      log
        ? unit === "lbs"
          ? (log.weight * 2.20462).toFixed(1)
          : String(log.weight)
        : ""
    );
  }, [date, weightLogs, unit]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    setSaving(true);

    const userId = await resolveUserId();
    if (!userId) { setSaving(false); return; }

    const weightKg = unit === "lbs" ? parseFloat(value) / 2.20462 : parseFloat(value);
    const weight   = Math.round(weightKg * 100) / 100;
    const payload  = { user_id: userId, logged_date: date, weight };

    const queue = async () => {
      await enqueue({ type: "upsert", table: "daily_weight_logs", payload, conflictOn: "user_id,logged_date" });
      const fakeLog: DailyWeightLog = {
        id:          existing?.id ?? `local-${Date.now()}`,
        user_id:     userId!,
        logged_date: date,
        weight,
        notes:       null,
        created_at:  new Date().toISOString(),
      };
      onSaved(fakeLog);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
      setSaving(false);
    };

    if (!navigator.onLine || userId === "guest-user") { await queue(); return; }

    try {
      const { data, error } = existing
        ? await supabase.from("daily_weight_logs").update(payload).eq("id", existing.id).select().single()
        : await supabase.from("daily_weight_logs").insert(payload).select().single();
      if (error) throw error;
      onSaved(data);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
      setSaving(false);
    } catch {
      await queue();
      triggerSync();
    }
  }

  const isToday = date === today;

  return (
    <div className="card-glass p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="section-label mb-0">{isToday ? t.weightLogger.todayWeight : t.weightLogger.logWeight}</p>
        <input
          type="date"
          value={date}
          max={today}
          onChange={e => { setDate(e.target.value); setDone(false); }}
          className="text-[11px] text-[var(--muted)] bg-transparent border-0 outline-none cursor-pointer"
        />
      </div>

      <form onSubmit={handleSave} className="flex gap-2 items-end">
        <div className="relative flex-1">
          <input
            type="number"
            step="0.1"
            min="20"
            max="500"
            placeholder={unit === "kg" ? "75.5" : "166.4"}
            value={value}
            onChange={e => setValue(e.target.value)}
            className="input-base pr-14 metric text-2xl tracking-tight"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--faint)] text-xs font-mono uppercase tracking-widest">
            {unit}
          </span>
        </div>
        <button
          type="submit"
          disabled={saving || !value}
          className="btn-aqua shrink-0"
        >
          {done ? t.weightLogger.done : saving ? t.weightLogger.saving : existing ? t.weightLogger.update : t.weightLogger.log}
        </button>
      </form>

      {existing && !done && (
        <p className="text-[11px] text-[var(--faint)] mt-2">
          {isToday ? t.weightLogger.alreadyLoggedToday : t.weightLogger.alreadyLoggedDate} — {t.weightLogger.savesWillUpdate}
        </p>
      )}
    </div>
  );
}
