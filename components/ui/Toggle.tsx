"use client";

import { cn } from "@/lib/utils";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

/** Shared accent-colored switch used across Settings and the Admin panel. */
export default function Toggle({ checked, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 disabled:opacity-50",
        checked
          ? "bg-[var(--accent)] shadow-[0_0_10px_rgba(var(--accent-rgb),0.40)]"
          : "bg-gray-300 dark:bg-[#2a2a2a]"
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 h-4 w-4 rounded-full transition-transform duration-200 shadow-sm",
          checked ? "translate-x-5 bg-[var(--accent-ink)]" : "bg-white dark:bg-[#555]"
        )}
      />
    </button>
  );
}
