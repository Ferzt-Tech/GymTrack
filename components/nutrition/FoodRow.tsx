"use client";

/** A tappable food row used by the /nutrition quick-add lists and the food
 *  logger's search/favorites tabs; opens the detail sheet.
 *
 *  The leading slot holds the energy readout rather than a decorative food icon:
 *  in an instrument-panel UI the most valuable thing at the start of the row is
 *  the number being compared, and a guessed-from-the-name emoji is both
 *  imprecise and visually cheap. `basis` states what the number is per, so a
 *  whole-package favorite (473 g) never reads as if it were per-100g. */
export default function FoodRow({
  name,
  brand,
  basis,
  kcal,
  tag,
  onClick,
}: {
  name: string;
  brand?: string | null;
  /** What `kcal` is measured over, e.g. "per 473 g". */
  basis?: string | null;
  kcal: number;
  /** Trailing metadata (category on search results). */
  tag?: string | null;
  onClick: () => void;
}) {
  const subtitle = [brand, basis].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      className="card-glass w-full p-3 flex items-center gap-3 text-left hover:border-[rgba(var(--accent-rgb),0.35)] transition-colors"
    >
      <span className="shrink-0 w-11 text-right">
        <span className="metric block text-base font-bold leading-none text-[var(--text)]">
          {Math.round(kcal)}
        </span>
        <span className="block text-[9px] font-mono uppercase tracking-wide text-[var(--faint)] leading-none mt-1">
          kcal
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold text-[var(--text)] truncate">{name}</h4>
        {subtitle && (
          <p className="text-[10px] text-[var(--faint)] font-mono uppercase truncate mt-0.5">{subtitle}</p>
        )}
      </div>
      {tag && (
        <span className="text-[10px] text-[var(--faint)] font-mono uppercase shrink-0 max-w-[30%] truncate">
          {tag}
        </span>
      )}
      <span className="text-[var(--faint)] shrink-0">›</span>
    </button>
  );
}
