"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { todayISO, waterPercent } from "@/lib/utils";
import { enqueue } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import type { WaterLog } from "@/types";
import WaterHistorySheet from "./WaterHistorySheet";
import { useT } from "@/lib/context/LanguageContext";

const STEPS = [0.25, 0.5, 0.75, 1.0] as const;
const SEGMENTS = 8;

interface Props {
  goal:         number;
  todayLog:     WaterLog | null;
  historyLogs:  WaterLog[];
  onUpdate:     (log: WaterLog) => void;
  name?:        string | null;
}

export default function WaterTracker({ goal, todayLog, historyLogs, onUpdate, name }: Props) {
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const t = useT();
  const { triggerSync } = useOnlineSync();

  const current = todayLog?.amount_liters ?? 0;
  const percent = waterPercent(current, goal);
  const filled  = Math.round((percent / 100) * SEGMENTS);

  async function add(amount: number) {
    setSaving(true);
    const userId = await resolveUserId();
    if (!userId) { setSaving(false); return; }

    const newAmount  = Math.min(goal * 2, current + amount);
    const today      = todayISO();
    const updatedAt  = new Date().toISOString();
    const payload    = { user_id: userId, logged_date: today, amount_liters: newAmount, updated_at: updatedAt };
    const fakeLog: WaterLog = {
      id:            todayLog?.id ?? `local-${Date.now()}`,
      user_id:       userId,
      logged_date:   today,
      amount_liters: newAmount,
      updated_at:    updatedAt,
    };

    const queue = async () => {
      await enqueue({ type: "upsert", table: "water_logs", payload, conflictOn: "user_id,logged_date" });
      onUpdate(fakeLog);
      setSaving(false);
    };

    if (!navigator.onLine) { await queue(); return; }

    try {
      const { data, error } = todayLog
        ? await supabase.from("water_logs").update(payload).eq("id", todayLog.id).select().single()
        : await supabase.from("water_logs").insert(payload).select().single();
      if (error) throw error;
      onUpdate(data);
      setSaving(false);
    } catch {
      await queue();
      triggerSync();
    }
  }

  async function reset() {
    if (!todayLog) return;
    setSaving(true);
    const userId = await resolveUserId();
    if (!userId) { setSaving(false); return; }

    const updatedAt = new Date().toISOString();
    const payload = { user_id: userId, logged_date: todayISO(), amount_liters: 0, updated_at: updatedAt };

    const queue = async () => {
      await enqueue({ type: "upsert", table: "water_logs", payload, conflictOn: "user_id,logged_date" });
      onUpdate({ ...todayLog, amount_liters: 0, updated_at: updatedAt });
      setSaving(false);
    };

    if (!navigator.onLine) { await queue(); return; }

    try {
      const { data, error } = await supabase
        .from("water_logs")
        .update({ amount_liters: 0, updated_at: updatedAt })
        .eq("id", todayLog.id)
        .select()
        .single();
      if (error) throw error;
      onUpdate(data);
      setSaving(false);
    } catch {
      await queue();
      triggerSync();
    }
  }

  return (
    <div className="card-glass p-4">
      <div className="flex items-baseline justify-between mb-4">
        <p className="section-label mb-0">{t.waterTracker.waterIntake}</p>
        <div className="flex items-baseline gap-3">
          <button
            onClick={() => setShowHistory(true)}
            className="text-[11px] text-[var(--accent)] hover:opacity-70 transition-opacity"
          >
            {t.waterTracker.history}
          </button>
          <span className="metric text-[11px] text-[var(--faint)]">
            {current.toFixed(2)} / {goal} L
          </span>
        </div>
      </div>

      {/* Progress segments — filled ones glow with accent */}
      <div className="flex gap-1.5 mb-4">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
              i < filled
                ? "bg-[var(--accent)] shadow-[0_0_6px_rgba(var(--accent-rgb),0.55)]"
                : "bg-[var(--border)]"
            }`}
          />
        ))}
      </div>

      {percent >= 100 ? (
        <p className="text-[var(--text)] text-[13px] text-center mb-3 font-medium">
          {name
            ? <>{t.waterTracker.goalReachedPrefix}<span className="text-[var(--accent)]">{name}</span>{t.waterTracker.goalReachedSuffix}</>
            : t.waterTracker.goalReached}
        </p>
      ) : percent > 0 && (
        <p className="text-[var(--faint)] text-[11px] text-center mb-3">
          {name
            ? <>{t.waterTracker.stillPrefix}<span className="text-[var(--text)]">{(goal - current).toFixed(2)}L</span>{t.waterTracker.lToGo}<span className="text-[var(--accent)]">{name}</span>{t.waterTracker.remainingSuffix}</>
            : t.waterTracker.lRemaining((goal - current).toFixed(2))}
        </p>
      )}

      <div className="grid grid-cols-4 gap-2">
        {STEPS.map(amt => (
          <button
            key={amt}
            onClick={() => add(amt)}
            disabled={saving}
            className="btn-outline text-center py-2 text-[13px]"
          >
            +{amt}L
          </button>
        ))}
      </div>

      <button
        onClick={reset}
        disabled={saving || current === 0}
        className="mt-3 w-full text-[11px] text-[var(--dim)] hover:text-[var(--muted)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {t.waterTracker.reset}
      </button>

      <WaterHistorySheet
        open={showHistory}
        onClose={() => setShowHistory(false)}
        logs={historyLogs}
        goal={goal}
      />
    </div>
  );
}
