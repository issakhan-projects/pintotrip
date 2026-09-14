"use client";

import type { InputHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "@/lib/utils";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Optional leading icon (Tremor-compatible). */
  icon?: LucideIcon;
};

/**
 * PinToTrip text field — replaces Tremor TextInput.
 */
export function TextInput({
  className,
  type = "text",
  icon: Icon,
  ...rest
}: TextInputProps) {
  if (!Icon) {
    return (
      <input
        type={type}
        className={cx(
          "block w-full rounded-xl border border-border bg-surface-elevated",
          "px-3 py-2.5 text-sm text-text placeholder:text-text-muted",
          "shadow-sm outline-none transition-colors",
          "focus:border-primary focus:ring-2 focus:ring-primary/20",
          "disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60",
          className
        )}
        {...rest}
      />
    );
  }

  return (
    <div className="relative">
      <Icon
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
        aria-hidden
      />
      <input
        type={type}
        className={cx(
          "block w-full rounded-xl border border-border bg-surface-elevated",
          "py-2.5 pl-9 pr-3 text-sm text-text placeholder:text-text-muted",
          "shadow-sm outline-none transition-colors",
          "focus:border-primary focus:ring-2 focus:ring-primary/20",
          "disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60",
          className
        )}
        {...rest}
      />
    </div>
  );
}
