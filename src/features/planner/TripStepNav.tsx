"use client";

import { Check } from "lucide-react";
import { cx } from "@/lib/utils";
import type { TripPlannerStep } from "@/types/trip-planner";

const STEPS: Array<{
  id: TripPlannerStep;
  label: string;
  shortLabel: string;
  number: number;
}> = [
  { id: "details", label: "Trip details", shortLabel: "Details", number: 1 },
  {
    id: "preparation",
    label: "Before you go",
    shortLabel: "Prep",
    number: 2,
  },
  { id: "routes", label: "Routes", shortLabel: "Routes", number: 3 },
  { id: "places", label: "Places", shortLabel: "Places", number: 4 },
];

interface TripStepNavProps {
  active: TripPlannerStep;
  completed: Partial<Record<TripPlannerStep, boolean>>;
  onChange: (step: TripPlannerStep) => void;
  /** Optional per-step progress for incomplete steps */
  progress?: Partial<
    Record<TripPlannerStep, { completed: number; total: number }>
  >;
  /** Compact pill row (legacy) vs compact progress tiles */
  variant?: "pills" | "tiles";
}

export function TripStepNav({
  active,
  completed,
  onChange,
  progress,
  variant = "tiles",
}: TripStepNavProps) {
  if (variant === "pills") {
    return (
      <nav
        aria-label="Trip steps"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {STEPS.map((step) => {
          const isActive = active === step.id;
          const isDone = Boolean(completed[step.id]);
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onChange(step.id)}
              className={cx(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors",
                isActive
                  ? "border-primary bg-primary-tint text-primary"
                  : "border-border bg-surface-elevated text-text-secondary hover:border-primary/30 hover:text-text"
              )}
            >
              <span
                className={cx(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                  isActive
                    ? "bg-primary text-white"
                    : isDone
                      ? "bg-success text-white"
                      : "bg-surface text-text-muted"
                )}
              >
                {isDone && !isActive ? (
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                ) : (
                  step.number
                )}
              </span>
              <span className="font-medium whitespace-nowrap">{step.label}</span>
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Trip steps"
      className="grid grid-cols-4 gap-1.5 sm:gap-2"
    >
      {STEPS.map((step) => {
        const isActive = active === step.id;
        const isDone = Boolean(completed[step.id]);
        const stepProgress = progress?.[step.id];
        const progressPct =
          stepProgress && stepProgress.total > 0
            ? Math.round(
                (stepProgress.completed / stepProgress.total) * 100
              )
            : null;

        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onChange(step.id)}
            title={step.label}
            className={cx(
              "relative flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-center transition-colors sm:flex-row sm:items-center sm:gap-2 sm:px-2.5 sm:py-2 sm:text-left",
              isActive
                ? "border-primary/25 bg-primary-tint"
                : "border-border/80 bg-surface-elevated hover:border-primary/20 hover:bg-surface"
            )}
          >
            <span
              className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                isActive
                  ? "bg-primary text-white"
                  : isDone
                    ? "bg-success text-white"
                    : "bg-surface text-text-muted ring-1 ring-border"
              )}
            >
              {isDone && !isActive ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              ) : (
                step.number
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cx(
                  "block truncate text-[11px] font-medium sm:text-xs",
                  isActive ? "text-primary" : "text-text"
                )}
              >
                <span className="sm:hidden">{step.shortLabel}</span>
                <span className="hidden sm:inline">{step.label}</span>
              </span>
              {isDone ? (
                <span className="mt-0.5 hidden text-[10px] font-medium text-success sm:inline">
                  Done
                </span>
              ) : progressPct != null ? (
                <span className="mt-1 hidden sm:block">
                  <span className="block h-1 overflow-hidden rounded-full bg-surface">
                    <span
                      className="block h-full rounded-full bg-primary transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </span>
                </span>
              ) : null}
            </span>
            {!isDone && progressPct != null ? (
              <span
                className="absolute inset-x-2 bottom-1 h-0.5 overflow-hidden rounded-full bg-surface sm:hidden"
                aria-hidden
              >
                <span
                  className="block h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
