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
 * Bottom navigation — fixed full-width bar on mobile; floating pill dock on desktop.
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
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 sm:absolute sm:flex sm:justify-center sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto flex w-full items-stretch border-t border-border bg-white pb-[env(safe-area-inset-bottom)] sm:w-auto sm:items-center sm:gap-3 sm:border-0 sm:bg-transparent sm:pb-0">
        <div className="flex h-13 min-w-0 flex-1 items-center sm:flex-none sm:rounded-full sm:bg-white sm:px-1.5 sm:shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
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


<button
          type="button"
          aria-label="Add place"
          onClick={onAdd}
          className="flex h-16 w-16 shrink-0 items-center justify-center bg-primary text-white transition-transform active:scale-95 sm:rounded-full sm:shadow-[0_8px_30px_rgba(0,0,0,0.18)]"
        >
          <Plus className="h-6 w-6" strokeWidth={3.5} />
        </button>

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
        "relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-2 transition-colors sm:h-11 sm:min-w-[4.75rem] sm:flex-none sm:rounded-full sm:px-4",
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
