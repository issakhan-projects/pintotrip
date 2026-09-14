"use client";

import { Check } from "lucide-react";
import { cx } from "@/lib/utils";
import type { TripPlannerStep } from "@/types/trip-planner";

const STEPS: Array<{ id: TripPlannerStep; label: string; number: number }> = [
  { id: "details", label: "Trip details", number: 1 },
  { id: "preparation", label: "Before you go", number: 2 },
  { id: "places", label: "Places", number: 3 },
];

interface TripStepNavProps {
  active: TripPlannerStep;
  completed: Partial<Record<TripPlannerStep, boolean>>;
  onChange: (step: TripPlannerStep) => void;
  /** Optional per-step progress for incomplete steps */
  progress?: Partial<
    Record<TripPlannerStep, { completed: number; total: number }>
  >;
  /** Compact pill row (legacy) vs progress-card tiles */
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
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
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
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-primary bg-primary-tint text-primary"
                  : "border-border bg-surface-elevated text-text-secondary hover:border-primary/30 hover:text-text"
              )}
            >
              <span
                className={cx(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                  isActive
                    ? "bg-primary text-white"
                    : isDone
                      ? "bg-success text-white"
                      : "bg-surface text-text-muted"
                )}
              >
                {isDone && !isActive ? "✓" : step.number}
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
      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
    >
      {STEPS.map((step) => {
        const isActive = active === step.id;
        const isDone = Boolean(completed[step.id]);
        const stepProgress = progress?.[step.id];

        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onChange(step.id)}
            className={cx(
              "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
              isActive
                ? "border-primary/25 bg-primary-tint"
                : "border-border/80 bg-surface-elevated hover:border-primary/20 hover:bg-surface"
            )}
          >
            <span
              className={cx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                isActive
                  ? "bg-primary text-white"
                  : isDone
                    ? "bg-success text-white"
                    : "bg-surface text-text-muted ring-1 ring-border"
              )}
            >
              {isDone && !isActive ? (
                <Check className="h-4 w-4" strokeWidth={2.5} />
              ) : (
                step.number
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cx(
                  "block truncate text-sm font-medium",
                  isActive ? "text-primary" : "text-text"
                )}
              >
                {step.label}
              </span>
              {isDone ? (
                <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-success">
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                  Completed
                </span>
              ) : stepProgress && stepProgress.total > 0 ? (
                <span className="mt-1 block">
                  <span className="text-xs text-text-secondary">
                    {stepProgress.completed} of {stepProgress.total}
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface">
                    <span
                      className="block h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.round(
                          (stepProgress.completed / stepProgress.total) * 100
                        )}%`,
                      }}
                    />
                  </span>
                </span>
              ) : (
                <span className="mt-0.5 block text-xs text-text-muted">
                  Not started
                </span>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
