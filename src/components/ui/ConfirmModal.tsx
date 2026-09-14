"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { cx } from "@/lib/utils";

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling for delete / irreversible actions. */
  tone?: "default" | "danger";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Centered confirm dialog — used for destructive or irreversible actions.
 */
export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
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
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.clearTimeout(armId);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, loading, onCancel]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Dismiss"
        disabled={loading}
        className="absolute inset-0 bg-text/40"
        onClick={() => {
          if (backdropArmed && !loading) onCancel();
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className={cx(
          "relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-border",
          "bg-surface-elevated p-5 shadow-xl"
        )}
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight text-text">
          {title}
        </h2>
        {description ? (
          <div className="mt-2 text-sm leading-relaxed text-text-secondary">
            {description}
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <Button
            variant="secondary"
            disabled={loading}
            onClick={onCancel}
            className="flex-1"
          >
            {cancelLabel}
          </Button>
          <Button
            loading={loading}
            disabled={loading}
            color={tone === "danger" ? "error" : "primary"}
            onClick={() => void onConfirm()}
            className="flex-1"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
