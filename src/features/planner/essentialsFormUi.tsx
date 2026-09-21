"use client";

import type { ReactNode } from "react";

export const ESSENTIALS_SHEET_CLASS = "md:!max-w-xl";
export const ESSENTIALS_FIELD_LABEL =
  "block text-xs font-medium text-text-secondary";
export const ESSENTIALS_FIELD_GAP = "mt-1.5";
export const ESSENTIALS_NOTES_CLASS =
  "mt-1.5 block w-full resize-y rounded-xl border border-border bg-white px-3 py-2.5 text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20";
export const ESSENTIALS_FORM_STACK = "space-y-3.5";
export const ESSENTIALS_ACTIONS =
  "flex flex-wrap items-center gap-2 border-t border-border pt-3.5";

export function EssentialsField({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className={ESSENTIALS_FIELD_LABEL}>
        {label}
      </label>
      <div className={ESSENTIALS_FIELD_GAP}>{children}</div>
      {hint ? <div className="mt-1.5">{hint}</div> : null}
    </div>
  );
}
