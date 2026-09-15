"use client";

import { CheckCircle2, Loader, XCircle, type LucideIcon } from "lucide-react";
import type { LocationStatus } from "@/types/location";
import { statusLabel, cx } from "@/lib/utils";

const STATUS_META: Record<
  LocationStatus,
  { Icon: LucideIcon; className: string }
> = {
  visited: {
    Icon: CheckCircle2,
    className:
      "border-success/45 bg-success-background text-success",
  },
  planned: {
    Icon: Loader,
    className:
      "border-warning/45 bg-warning-background text-warning",
  },
  cancelled: {
    Icon: XCircle,
    className:
      "border-error/45 bg-error-background text-error",
  },
};

interface StatusBadgeProps {
  status: LocationStatus;
  className?: string;
  /** Icon only — pass `"mobile"` to hide the label below the `sm` breakpoint. */
  iconOnly?: boolean | "mobile";
}

export function StatusBadge({
  status,
  className,
  iconOnly = false,
}: StatusBadgeProps) {
  const { Icon, className: tone } = STATUS_META[status];
  const label = statusLabel(status);
  const alwaysIconOnly = iconOnly === true;
  const mobileIconOnly = iconOnly === "mobile";

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border text-xs font-medium",
        alwaysIconOnly || mobileIconOnly
          ? "gap-0 px-1.5 py-1"
          : "gap-1.5 px-2.5 py-1",
        mobileIconOnly && "sm:gap-1.5 sm:px-2.5",
        tone,
        className
      )}
      aria-label={`Status: ${label}`}
      title={label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {alwaysIconOnly ? null : mobileIconOnly ? (
        <span className="hidden sm:inline">{label}</span>
      ) : (
        label
      )}
    </span>
  );
}
