"use client";

import type { ReactNode } from "react";
import { CalendarRange, List, Lock, Map, Plus, UserRound } from "lucide-react";
import { cx } from "@/lib/utils";

export type AppTab = "map" | "places" | "planner" | "profile";

interface BottomNavProps {
  active: AppTab;
  onMap: () => void;
  onPlaces: () => void;
  onPlanner: () => void;
  onProfile: () => void;
  onAdd: () => void;
  /** When true, show a Pro lock overlay on the Planner icon. */
  plannerLocked?: boolean;
}

/**
 * Floating dock — white pill + black add circle.
 * Same layout on mobile and desktop.
 */
export function BottomNav({
  active,
  onMap,
  onPlaces,
  onPlanner,
  onProfile,
  onAdd,
  plannerLocked = false,
}: BottomNavProps) {
  return (
    <nav
      aria-label="Main"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto flex items-center gap-3">
        <div className="flex h-14 items-center rounded-full bg-white px-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          <NavSlot
            label="Map"
            active={active === "map"}
            onClick={onMap}
            icon={<Map className="h-4 w-4" strokeWidth={2} />}
          />
          <NavSlot
            label="Places"
            active={active === "places"}
            onClick={onPlaces}
            icon={<List className="h-4 w-4" strokeWidth={2} />}
          />
          <NavSlot
            label="Planner"
            active={active === "planner"}
            onClick={onPlanner}
            locked={plannerLocked}
            icon={<CalendarRange className="h-4 w-4" strokeWidth={2} />}
          />
          <NavSlot
            label="Profile"
            active={active === "profile"}
            onClick={onProfile}
            icon={<UserRound className="h-4 w-4" strokeWidth={2} />}
          />
        </div>

        <button
          type="button"
          aria-label="Add place"
          onClick={onAdd}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-[0_8px_30px_rgba(0,0,0,0.18)] transition-transform active:scale-95"
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
}

function NavSlot({
  label,
  icon,
  active,
  onClick,
  locked = false,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={locked ? `${label} (Pro)` : label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cx(
        "relative flex h-11 min-w-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-full px-4 transition-colors",
        active
          ? "bg-neutral-200/90 text-text"
          : "bg-transparent text-text-secondary hover:bg-neutral-100/80 hover:text-text"
      )}
    >
      <span className="relative inline-flex">
        {icon}
        {locked ? (
          <span
            className="absolute -right-2.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-white shadow-sm ring-1 ring-white"
            aria-hidden
          >
            <Lock className="h-2 w-2" strokeWidth={3} />
          </span>
        ) : null}
      </span>
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </button>
  );
}
