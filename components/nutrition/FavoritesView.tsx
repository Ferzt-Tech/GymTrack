"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/context/LanguageContext";
import { useNav } from "@/lib/context/NavContext";
import { cn } from "@/lib/utils";
import { savedBasisGrams, scaledFavorite } from "@/lib/savedFoods";
import { MacroSummary, NutritionFactsDetails, hasExtendedDetail } from "./NutritionFacts";
import type { SavedFood } from "@/types";

interface Props {
  open: boolean;
  favorites: SavedFood[];
  onClose: () => void;
  onAddToDiary: (fav: SavedFood) => void;
  onRemove: (fav: SavedFood) => void;
}

/** Full-screen "subpage" listing all favorites with expandable full nutrition.
 *  Not a route — an in-page overlay (mirrors ActiveWorkout): a nested route
 *  would break the nav pill/header, and hardware back is blocked while
 *  navHidden, so this ships its own back control. */
export default function FavoritesView({ open, favorites, onClose, onAddToDiary, onRemove }: Props) {
  const t = useT();
  const { setNavHidden } = useNav();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which basis the expanded card reads at: the food's own saved portion (a whole
  // 473 g can) or the per-100g reference that makes two foods comparable.
  const [showPer100g, setShowPer100g] = useState(false);

  useEffect(() => {
    if (open) setNavHidden(true);
    return () => setNavHidden(false);
  }, [open, setNavHidden]);

  useEffect(() => {
    if (!open) { setQuery(""); setCategory("all"); setExpandedId(null); setShowPer100g(false); }
  }, [open]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const f of favorites) { const c = f.detail?.category; if (c) set.add(c); }
    return Array.from(set).sort();
  }, [favorites]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return favorites.filter((f) => {
      if (category !== "all" && f.detail?.category !== category) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || (f.detail?.brand ?? "").toLowerCase().includes(q);
    });
  }, [favorites, query, category]);

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
          <span className="text-[10px] text-[var(--accent)] font-mono tracking-widest uppercase">FAVORITES.SYS</span>
          <h1 className="text-lg font-bold text-[var(--text)] leading-tight">{t.nutritionTracker.favoritesTitle}</h1>
        </div>
      </div>

      {/* Search + category filter */}
      <div className="px-4 py-3 space-y-2 border-b border-[var(--border)] shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.nutritionTracker.searchPlaceholder}
          className="input-base"
        />
        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {["all", ...categories].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  "shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors",
                  category === c
                    ? "bg-[var(--accent)] text-[#041a1f] border-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--sub)] hover:text-[var(--muted)]"
                )}
              >
                {c === "all" ? t.nutritionTracker.allCategories : c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        {filtered.length === 0 ? (
          <p className="text-sm text-[var(--muted)] text-center py-10">
            {favorites.length === 0 ? t.nutritionTracker.savedEmpty : t.nutritionTracker.favoritesViewEmpty}
          </p>
        ) : (
          filtered.map((fav) => {
            const expanded = expandedId === fav.id;
            const basisG = savedBasisGrams(fav);
            // Only foods saved at a real portion (a whole package, a scoop) have a
            // second basis worth offering; a plain per-100g favorite has one.
            const hasOwnBasis = Math.abs(basisG - 100) >= 0.5;
            const shownBasisG = hasOwnBasis && !showPer100g ? basisG : 100;
            const shown = scaledFavorite(fav, shownBasisG);
            const summary = scaledFavorite(fav, basisG);

            return (
              <div key={fav.id} className="card-glass overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setExpandedId(expanded ? null : fav.id); setShowPer100g(false); }}
                  className="w-full p-3 flex items-center gap-3 text-left"
                >
                  <span className="shrink-0 w-11 text-right">
                    <span className="metric block text-base font-bold leading-none text-[var(--text)]">
                      {summary.calories}
                    </span>
                    <span className="block text-[9px] font-mono uppercase tracking-wide text-[var(--faint)] leading-none mt-1">
                      kcal
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-[var(--text)] truncate">{fav.name}</h4>
                    <p className="text-[10px] text-[var(--faint)] font-mono uppercase truncate mt-0.5">
                      {fav.detail?.brand ? `${fav.detail.brand} · ` : ""}
                      {t.nutritionTracker.perBasis(basisG)}
                    </p>
                  </div>
                  <span className="text-[var(--faint)] text-xs shrink-0">{expanded ? "▲" : "▼"}</span>
                </button>

                {expanded && (
                  <div className="px-3 pb-3 space-y-4 animate-slide-up border-t border-[var(--border)] pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] text-[var(--faint)] font-mono uppercase tracking-wide">
                        {t.nutritionTracker.dataPer(`${Math.round(shownBasisG)} g`)}
                      </p>
                      {hasOwnBasis && (
                        <div className="flex border border-[var(--border)] rounded-lg overflow-hidden shrink-0">
                          {[false, true].map((per100) => (
                            <button
                              key={String(per100)}
                              type="button"
                              onClick={() => setShowPer100g(per100)}
                              className={cn(
                                "px-2.5 py-1 text-[10px] font-mono font-semibold uppercase transition-all",
                                showPer100g === per100
                                  ? "bg-[var(--accent)] text-[#041a1f]"
                                  : "text-[var(--sub)] hover:text-[var(--muted)]"
                              )}
                            >
                              {per100 ? "100 g" : `${Math.round(basisG)} g`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <MacroSummary
                      calories={shown.calories}
                      protein={shown.protein}
                      carbs={shown.carbs}
                      fats={shown.fats}
                    />
                    {hasExtendedDetail(shown.detail) && (
                      <NutritionFactsDetails detail={shown.detail} carbs={shown.carbs} fats={shown.fats} />
                    )}
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => onAddToDiary(fav)} className="btn-aqua flex-1 py-2.5 text-xs font-bold">
                        {t.nutritionTracker.addToDiary}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(fav)}
                        title={t.nutritionTracker.removeFavorite}
                        className="btn-outline px-4 py-2.5 text-sm text-red-400 border-red-400/30 shrink-0"
                      >
                        ♥
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
