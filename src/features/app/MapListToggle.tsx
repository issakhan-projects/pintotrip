"use client";

import { List, Map } from "lucide-react";
import { cx } from "@/lib/utils";

export type MapListMode = "map" | "list";

interface MapListToggleProps {
  mode: MapListMode;
  onChange: (mode: MapListMode) => void;
}

const OPTIONS = [
  { value: "map" as const, label: "Map", icon: Map },
  { value: "list" as const, label: "List", icon: List },
];

export function MapListToggle({ mode, onChange }: MapListToggleProps) {
  return (
    <div
      role="group"
      aria-label="Map or list view"
      className="inline-flex h-10 shrink-0 items-center rounded-full border border-border bg-surface-elevated/95 p-1 shadow-sm backdrop-blur sm:h-11"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-label={label}
          aria-pressed={mode === value}
          className={cx(
            "inline-flex h-full items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-medium transition-colors sm:px-3.5",
            mode === value
              ? "bg-primary text-white shadow-sm"
              : "text-text-secondary hover:text-text"
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
