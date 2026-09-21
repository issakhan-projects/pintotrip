"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Optional subtitle under the title (form sheets). */
  description?: string;
  /** Optional leading mark (e.g. feature icon) beside the title. */
  leading?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  showClose?: boolean;
  /** Extra controls before the close button (e.g. share, overflow menu). */
  actions?: ReactNode;
  /** Extra classes on the dialog panel (e.g. wider max-width). */
  className?: string;
  /** Extra classes on the scrollable body. */
  bodyClassName?: string;
}

/**
 * Mobile bottom sheet / desktop centered panel.
 * Custom because Tremor Dialog is not a travel bottom-sheet pattern.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  leading,
  children,
  size = "md",
  showClose = true,
  actions,
  className,
  bodyClassName,
}: SheetProps) {
  const [mounted, setMounted] = useState(false);
  /** Prevent the opening click from immediately dismissing via the backdrop. */
  const [backdropArmed, setBackdropArmed] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setBackdropArmed(false);
      return;
    }

    const armId = window.setTimeout(() => setBackdropArmed(true), 120);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      window.clearTimeout(armId);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const heightClass =
    size === "sm"
      ? "max-h-[55vh] md:max-h-[70vh]"
      : size === "lg"
        ? "max-h-[92vh] md:max-h-[85vh]"
        : "max-h-[78vh] md:max-h-[80vh]";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center md:items-center">
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute inset-0 bg-text/35 backdrop-blur-[2px]"
        onClick={() => {
          if (backdropArmed) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className={cx(
          "relative z-10 flex w-full flex-col border border-border bg-surface-elevated shadow-[0_16px_48px_rgba(17,24,39,0.14)]",
          "rounded-t-2xl md:mx-4 md:max-w-lg md:rounded-2xl",
          heightClass,
          className
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border md:hidden" />
        {(title || description || leading || showClose || actions) && (
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5">
            {title || description || leading ? (
              <div className="flex min-w-0 flex-1 items-start gap-3 pr-2">
                {leading ? <div className="shrink-0">{leading}</div> : null}
                <div className="min-w-0 flex-1">
                  {title ? (
                    <h2 className="truncate text-base font-semibold tracking-tight text-text">
                      {title}
                    </h2>
                  ) : null}
                  {description ? (
                    <p className="mt-0.5 text-sm leading-snug text-text-secondary">
                      {description}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div
              className={cx(
                "flex shrink-0 items-center gap-0.5 pt-0.5",
                !(title || description || leading) && "min-w-0 flex-1"
              )}
            >
              {actions}
              {showClose ? (
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text"
                >
                  <X className="h-5 w-5" />
                </button>
              ) : null}
            </div>
          </div>
        )}
        <div
          className={cx(
            "min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5",
            bodyClassName
          )}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
