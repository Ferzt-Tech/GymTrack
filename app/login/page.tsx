"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useLanguage, useT, type Language } from "@/lib/context/LanguageContext";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const t = useT();

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [mode,     setMode]     = useState<Mode>("login");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [message,  setMessage]  = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
      router.push("/home");
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
      setMessage(t.login.checkEmail);
      setMode("login");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[var(--bg)]">
      <div className="w-full max-w-[360px] animate-fade-in">

        {/* Language picker */}
        <div className="flex justify-end mb-6">
          <div className="flex border border-[var(--border)] rounded-xl overflow-hidden">
            {(["en", "es"] as Language[]).map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={cn(
                  "px-4 py-1.5 text-xs font-semibold tracking-widest uppercase transition-colors",
                  language === lang
                    ? "bg-[var(--text)] text-[var(--bg)]"
                    : "text-[var(--sub)] hover:text-[var(--muted)]"
                )}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        {/* Wordmark */}
        <div className="mb-10">
          <p className="text-[11px] tracking-[0.2em] uppercase text-[var(--faint)] mb-1">{t.login.welcomeTo}</p>
          <h1 className="text-4xl font-bold tracking-tight text-[var(--text)]">GymTrack</h1>
          <p className="text-[var(--sub)] text-sm mt-1">{t.login.tagline}</p>
        </div>

        {/* Tab toggle */}
        <div className="flex border border-[var(--border)] rounded-xl overflow-hidden mb-5">
          {(["login", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 py-2.5 text-sm font-medium transition-colors",
                mode === m
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "text-[var(--sub)] hover:text-[var(--muted)]"
              )}
            >
              {m === "login" ? t.login.login : t.login.signup}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder={t.login.email}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="input-base"
          />
          <input
            type="password"
            placeholder={t.login.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="input-base"
          />

          {error   && <p className="text-[#e05] text-[13px]">{error}</p>}
          {message && <p className="text-[var(--muted)] text-[13px]">{message}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full mt-1">
            {loading ? t.login.loading : mode === "login" ? t.login.login : t.login.createAccount}
          </button>
        </form>

        <p className="text-[var(--dim)] text-[11px] text-center mt-8">
          {t.login.privacyNote}
        </p>
      </div>
    </div>
  );
}
