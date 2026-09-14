"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
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
        className="absolute inset-0 bg-text/40"
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
          "relative z-10 flex w-full flex-col border border-border bg-surface-elevated shadow-xl",
          "rounded-t-2xl md:mx-4 md:max-w-lg md:rounded-2xl",
          heightClass,
          className
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border md:hidden" />
        {(title || showClose || actions) && (
          <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-text">
              {title ?? ""}
            </h2>
            <div className="flex shrink-0 items-center gap-0.5">
              {actions}
              {showClose ? (
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface hover:text-text"
                >
                  <X className="h-5 w-5" />
                </button>
              ) : null}
            </div>
          </div>
        )}
        <div
          className={cx(
            "min-h-0 flex-1 overflow-y-auto px-4 py-4",
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
