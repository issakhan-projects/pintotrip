"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cx } from "@/lib/utils";

/** Visual style of the button surface. */
export type ButtonVariant = "solid" | "outline" | "ghost" | "soft";

/** Semantic color — uses design tokens from globals.css. */
export type ButtonColor =
  | "primary"
  | "neutral"
  | "success"
  | "warning"
  | "error";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color"> {
  /**
   * Surface style. `"primary"` / `"secondary"` are aliases kept for existing
   * call sites (`primary` → solid+primary, `secondary` → outline+neutral).
   */
  variant?: ButtonVariant | "primary" | "secondary";
  /** Semantic color. Defaults from variant when omitted. */
  color?: ButtonColor;
  size?: ButtonSize;
  /** Left icon (hidden while `loading`). */
  icon?: LucideIcon;
  /** Right icon (hidden while `loading`). */
  iconRight?: LucideIcon;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 px-3 text-xs rounded-lg",
  md: "h-11 gap-2 px-4 text-[13px] rounded-lg",
  lg: "h-12 gap-2 px-5 text-sm rounded-xl",
  icon: "h-10 w-10 gap-0 p-0 rounded-lg",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
  icon: "h-4 w-4",
};

type Resolved = { variant: ButtonVariant; color: ButtonColor };

function resolveVariantColor(
  variant: ButtonProps["variant"],
  color: ButtonColor | undefined
): Resolved {
  if (variant === "primary") {
    return { variant: "solid", color: color ?? "primary" };
  }
  if (variant === "secondary") {
    return { variant: "outline", color: color ?? "neutral" };
  }
  return {
    variant: variant ?? "solid",
    color: color ?? "primary",
  };
}

function colorClasses(variant: ButtonVariant, color: ButtonColor): string {
  const map: Record<ButtonColor, Record<ButtonVariant, string>> = {
    primary: {
      solid:
        "border-transparent bg-primary text-white shadow-sm hover:bg-primary-hover focus:ring-primary-light/30",
      outline:
        "border-border bg-surface text-text shadow-sm hover:bg-primary-tint hover:text-primary focus:ring-primary/30",
      ghost:
        "border-transparent bg-transparent text-primary hover:bg-primary-tint focus:ring-primary/30",
      soft: "border-transparent bg-primary-tint text-primary hover:bg-primary/15 focus:ring-primary/30",
    },
    neutral: {
      solid:
        "border-transparent bg-text text-white shadow-sm hover:bg-text/90 focus:ring-text/20",
      outline:
        "border-border bg-surface-elevated text-text shadow-sm hover:bg-surface focus:ring-primary/30",
      ghost:
        "border-transparent bg-transparent text-text-secondary hover:bg-surface hover:text-text focus:ring-primary/30",
      soft: "border-transparent bg-surface text-text hover:bg-divider focus:ring-primary/30",
    },
    success: {
      solid:
        "border-transparent bg-success text-white shadow-sm hover:bg-success/90 focus:ring-success/30",
      outline:
        "border-success/30 bg-surface-elevated text-success shadow-sm hover:bg-success-background focus:ring-success/30",
      ghost:
        "border-transparent bg-transparent text-success hover:bg-success-background focus:ring-success/30",
      soft: "border-transparent bg-success-background text-success hover:bg-success/15 focus:ring-success/30",
    },
    warning: {
      solid:
        "border-transparent bg-warning text-white shadow-sm hover:bg-warning/90 focus:ring-warning/30",
      outline:
        "border-warning/30 bg-surface-elevated text-warning shadow-sm hover:bg-warning-background focus:ring-warning/30",
      ghost:
        "border-transparent bg-transparent text-warning hover:bg-warning-background focus:ring-warning/30",
      soft: "border-transparent bg-warning-background text-warning hover:bg-warning/15 focus:ring-warning/30",
    },
    error: {
      solid:
        "border-transparent bg-error text-white shadow-sm hover:bg-error/90 focus:ring-error/30",
      outline:
        "border-error/30 bg-surface-elevated text-error shadow-sm hover:bg-error-background focus:ring-error/30",
      ghost:
        "border-transparent bg-transparent text-error hover:bg-error-background focus:ring-error/30",
      soft: "border-transparent bg-error-background text-error hover:bg-error/15 focus:ring-error/30",
    },
  };

  return map[color][variant];
}

/**
 * Shared PinToTrip button — use across app, sheets, and forms.
 *
 * @example
 * <Button>Save</Button>
 * <Button variant="secondary" icon={Plus}>Add place</Button>
 * <Button color="error" icon={Trash2}>Delete</Button>
 * <Button variant="soft" color="success" size="sm" loading>Saving…</Button>
 */
export function Button({
  variant = "primary",
  color,
  size = "md",
  loading = false,
  fullWidth = false,
  icon: Icon,
  iconRight: IconRight,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const resolved = resolveVariantColor(variant, color);
  const iconClass = ICON_SIZE[size];

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center font-medium",
        "border transition-all duration-200",
        "focus:outline-none focus:ring-2",
        "active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        SIZE_CLASSES[size],
        colorClasses(resolved.variant, resolved.color),
        fullWidth && "w-full",
        className
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className={cx(iconClass, "shrink-0 animate-spin")} aria-hidden />
      ) : Icon ? (
        <Icon className={cx(iconClass, "shrink-0")} aria-hidden />
      ) : null}
      {children}
      {!loading && IconRight ? (
        <IconRight className={cx(iconClass, "shrink-0")} aria-hidden />
      ) : null}
    </button>
  );
}
