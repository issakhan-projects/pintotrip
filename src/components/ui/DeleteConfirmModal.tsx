"use client";

import type { ReactNode } from "react";
import { ConfirmModal } from "./ConfirmModal";

export interface DeleteConfirmModalProps {
  open: boolean;
  /**
   * Short noun for the default title, e.g. `"trip"` → `"Delete this trip?"`.
   * Ignored when `title` is provided.
   */
  entity?: string;
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Shared destructive delete confirm — use for trips, places, routes, etc.
 */
export function DeleteConfirmModal({
  open,
  entity = "item",
  title,
  description = "This can’t be undone.",
  confirmLabel = "Delete",
  cancelLabel = "Keep",
  loading = false,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  return (
    <ConfirmModal
      open={open}
      title={title ?? `Delete this ${entity}?`}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      tone="danger"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
