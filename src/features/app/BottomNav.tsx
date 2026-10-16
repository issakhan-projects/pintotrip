"use client";

import type { ReactNode } from "react";
import { CalendarRange, List, Lock, Map, Plus, UserRound } from "lucide-react";
import { useI18n } from "@/i18n";
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
 * Bottom navigation — floating frosted dock on mobile; pill dock on desktop.
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
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("app.nav.mainAria")}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:absolute sm:flex sm:justify-center sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto relative mx-auto flex w-full max-w-md items-center gap-0.5 rounded-full border border-border/70 bg-white/90 px-1.5 py-1.5 shadow-[0_10px_40px_rgba(66,0,94,0.14),0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl sm:mx-0 sm:w-auto sm:max-w-none sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none">
        <div className="flex min-w-0 flex-1 items-center sm:flex-none sm:rounded-full sm:bg-white sm:px-1.5 sm:shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          <NavSlot
            label={t("app.nav.map")}
            active={active === "map"}
            onClick={onMap}
            icon={<Map className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />}
          />
          <NavSlot
            label={t("app.nav.places")}
            active={active === "places"}
            onClick={onPlaces}
            icon={<List className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />}
          />

          <div className="relative flex w-[3.75rem] shrink-0 items-center justify-center self-stretch sm:w-auto sm:self-auto">
            <button
              type="button"
              aria-label={t("app.nav.addPlaceAria")}
              onClick={onAdd}
              className={cx(
                "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-white",
                "shadow-[0_6px_20px_rgba(66,0,94,0.35)] ring-[3px] ring-white",
                "transition-[transform,background-color,box-shadow] duration-200",
                "hover:bg-primary-hover hover:shadow-[0_8px_24px_rgba(66,0,94,0.4)]",
                "active:scale-95",
                "sm:h-16 sm:w-16 sm:shadow-[0_8px_30px_rgba(0,0,0,0.18)] sm:ring-0"
              )}
            >
              <Plus
                className="h-6 w-6 shrink-0"
                strokeWidth={3}
                absoluteStrokeWidth
              />
            </button>
          </div>

          <NavSlot
            label={t("app.nav.planner")}
            active={active === "planner"}
            onClick={onPlanner}
            locked={plannerLocked}
            icon={
              <CalendarRange className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
            }
          />
          <NavSlot
            label={t("app.nav.profile")}
            active={active === "profile"}
            onClick={onProfile}
            icon={
              <UserRound className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
            }
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
        "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1.5 py-1.5 transition-[color,background-color,transform] duration-200 active:scale-95",
        "sm:h-11 sm:min-w-[4.75rem] sm:flex-none sm:px-4 sm:py-0 sm:active:scale-100",
        active
          ? "bg-primary-tint text-primary sm:bg-neutral-200/90 sm:text-text"
          : "bg-transparent text-text-secondary hover:bg-primary-tint/60 hover:text-primary sm:hover:bg-neutral-100/80 sm:hover:text-text"
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
      <span
        className={cx(
          "max-w-full truncate text-[10px] font-semibold leading-none tracking-wide sm:text-[11px] sm:font-medium",
          active ? "text-primary sm:text-text" : undefined
        )}
      >
        {label}
      </span>
    </button>
  );
}
