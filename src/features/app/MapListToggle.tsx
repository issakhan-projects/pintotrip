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
      className="inline-flex shrink-0 rounded-full border border-border bg-surface-elevated/95 p-1 shadow-sm backdrop-blur"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-label={label}
          className={cx(
            "inline-flex items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3.5",
            mode === value
              ? "bg-primary text-white"
              : "text-text-secondary hover:text-text"
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
