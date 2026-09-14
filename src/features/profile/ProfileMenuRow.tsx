"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "@/lib/utils";

interface ProfileMenuRowProps {
  icon: ReactNode;
  title: string;
  description?: string;
  onClick?: () => void;
  muted?: boolean;
  danger?: boolean;
}

export function ProfileMenuRow({
  icon,
  title,
  description,
  onClick,
  muted,
  danger,
}: ProfileMenuRowProps) {
  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-colors",
        onClick ? "hover:bg-surface" : undefined,
        muted ? "opacity-70" : undefined
      )}
    >
      <span
        className={cx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary",
          danger && "bg-error-background text-error"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cx(
            "block text-sm font-medium",
            danger ? "text-error" : "text-text"
          )}
        >
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs text-text-secondary">
            {description}
          </span>
        ) : null}
      </span>
      {onClick ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
      ) : null}
    </Comp>
  );
}
