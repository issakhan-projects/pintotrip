"use client";

import { cx } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * PinToTrip toggle — replaces Tremor Switch.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-primary/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-primary bg-primary"
          : "border-border bg-surface",
        className
      )}
    >
      <span
        className={cx(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
