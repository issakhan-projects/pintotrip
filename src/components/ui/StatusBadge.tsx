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
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { Icon, className: tone } = STATUS_META[status];

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        tone,
        className
      )}
      aria-label={`Status: ${statusLabel(status)}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {statusLabel(status)}
    </span>
  );
}
