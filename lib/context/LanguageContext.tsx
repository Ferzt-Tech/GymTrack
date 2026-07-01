"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { en, type Translations } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

export type Language = "en" | "es";

interface LanguageContextValue {
  language:    Language;
  setLanguage: (l: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  language:    "en",
  setLanguage: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    const stored = localStorage.getItem("language") as Language | null;
    if (stored === "en" || stored === "es") setLanguageState(stored);
  }, []);

  function setLanguage(next: Language) {
    setLanguageState(next);
    localStorage.setItem("language", next);
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useT(): Translations {
  const { language } = useLanguage();
  return language === "es" ? es : en;
}
