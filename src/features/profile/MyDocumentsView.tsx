"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  BookUser,
  FileText,
  IdCard,
  Pencil,
  Phone,
  Plus,
  Shield,
  Trash2,
} from "lucide-react";
import { Button, DeleteConfirmModal, TextInput } from "@/components/ui";
import {
  createTravelDocument,
  deleteTravelDocument,
  listTravelDocuments,
  updateTravelDocument,
} from "@/lib/documents";
import { cx } from "@/lib/utils";
import {
  TRAVEL_DOCUMENT_KIND_LABELS,
  TRAVEL_DOCUMENT_KINDS,
  type TravelDocument,
  type TravelDocumentData,
  type TravelDocumentKind,
} from "@/types/travel-document";

type Mode =
  | { name: "list" }
  | { name: "view"; id: string }
  | { name: "form"; id?: string };

interface MyDocumentsViewProps {
  userId: string;
}

const KIND_ICONS: Record<TravelDocumentKind, typeof FileText> = {
  passport: BookUser,
  id: IdCard,
  phone: Phone,
  emergency_contact: Shield,
  other: FileText,
};

function emptyData(): TravelDocumentData {
  return {
    fullName: "",
    documentNumber: "",
    nationality: "",
    expiryDate: "",
    phoneNumber: "",
    relationship: "",
    notes: "",
  };
}

function documentTitle(doc: TravelDocument): string {
  const trimmed = doc.label.trim();
  return trimmed || TRAVEL_DOCUMENT_KIND_LABELS[doc.kind];
}

function previewLine(doc: TravelDocument): string {
  const { data } = doc;
  if (doc.kind === "phone") return data.phoneNumber?.trim() || "No number yet";
  if (doc.kind === "emergency_contact") {
    const parts = [data.fullName, data.phoneNumber].filter(Boolean);
    return parts.length ? parts.join(" · ") : "No details yet";
  }
  if (doc.kind === "other") {
    return data.notes?.trim() || "No details yet";
  }
  const parts = [data.fullName, data.documentNumber].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No details yet";
}

export function MyDocumentsView({ userId }: MyDocumentsViewProps) {
  const [docs, setDocs] = useState<TravelDocument[]>([]);
  const [mode, setMode] = useState<Mode>({ name: "list" });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function refresh() {
    setDocs(listTravelDocuments(userId));
  }

  useEffect(() => {
    setDocs(listTravelDocuments(userId));
  }, [userId]);

  const viewing =
    mode.name === "view" ? docs.find((d) => d.id === mode.id) : undefined;
  const editing =
    mode.name === "form" && mode.id
      ? docs.find((d) => d.id === mode.id)
      : undefined;

  useEffect(() => {
    if (mode.name === "view" && !viewing) {
      setMode({ name: "list" });
    }
  }, [mode, viewing]);

  if (mode.name === "form") {
    return (
      <DocumentForm
        initial={editing}
        onCancel={() =>
          setMode(editing ? { name: "view", id: editing.id } : { name: "list" })
        }
        onSave={(input) => {
          if (editing) {
            updateTravelDocument(userId, editing.id, input);
            refresh();
            setMode({ name: "view", id: editing.id });
          } else {
            const created = createTravelDocument(userId, input);
            refresh();
            setMode({ name: "view", id: created.id });
          }
        }}
      />
    );
  }

  if (mode.name === "view" && viewing) {
    return (
      <>
        <DocumentDetail
          doc={viewing}
          onBack={() => setMode({ name: "list" })}
          onEdit={() => setMode({ name: "form", id: viewing.id })}
          onDelete={() => setDeleteId(viewing.id)}
        />
        <DeleteConfirmModal
          open={deleteId === viewing.id}
          title="Delete document?"
          description="This removes it from this device only. It cannot be undone."
          onCancel={() => setDeleteId(null)}
          onConfirm={() => {
            deleteTravelDocument(userId, viewing.id);
            setDeleteId(null);
            refresh();
            setMode({ name: "list" });
          }}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <DeviceOnlyBanner />

      {docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface px-5 py-10 text-center">
          <p className="text-sm font-medium text-text">No documents yet</p>
          <p className="mt-1 text-xs text-text-secondary">
            Save passport, ID, phone, or emergency info for quick access while
            traveling.
          </p>
          <Button
            icon={Plus}
            color="primary"
            onClick={() => setMode({ name: "form" })}
            className="mt-5"
          >
            Add document
          </Button>
        </div>
      ) : (
        <>
          <ul className="overflow-hidden rounded-2xl border border-border bg-surface-elevated">
            {docs.map((doc, index) => {
              const Icon = KIND_ICONS[doc.kind];
              return (
                <li
                  key={doc.id}
                  className={cx(
                    index > 0 && "border-t border-divider"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setMode({ name: "view", id: doc.id })}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">
                        {documentTitle(doc)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-text-secondary">
                        {previewLine(doc)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <Button
            icon={Plus}
            color="primary"
            variant="secondary"
            onClick={() => setMode({ name: "form" })}
            className="w-full"
          >
            Add document
          </Button>
        </>
      )}

      <DeleteConfirmModal
        open={deleteId !== null && mode.name === "list"}
        title="Delete document?"
        description="This removes it from this device only. It cannot be undone."
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) {
            deleteTravelDocument(userId, deleteId);
            setDeleteId(null);
            refresh();
          }
        }}
      />
    </div>
  );
}

function DeviceOnlyBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-3">
      <Shield
        className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary"
        aria-hidden
      />
      <p className="text-xs leading-relaxed text-text-secondary">
        Stored only on this device. Never uploaded to PinToTrip or any cloud
        service.
      </p>
    </div>
  );
}

function DocumentDetail({
  doc,
  onBack,
  onEdit,
  onDelete,
}: {
  doc: TravelDocument;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const rows = detailRows(doc);

  return (
    <div className="space-y-4">
      <DeviceOnlyBanner />

      <div className="overflow-hidden rounded-2xl border border-border bg-surface-elevated">
        <div className="border-b border-divider px-4 py-3.5">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            {TRAVEL_DOCUMENT_KIND_LABELS[doc.kind]}
          </p>
          <h3 className="mt-1 text-base font-semibold text-text">
            {documentTitle(doc)}
          </h3>
        </div>
        {rows.length > 0 ? (
          <dl className="divide-y divide-divider">
            {rows.map((row) => (
              <div key={row.label} className="px-4 py-3">
                <dt className="text-xs text-text-secondary">{row.label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-text">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="px-4 py-6 text-sm text-text-secondary">
            No details saved yet.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          icon={Pencil}
          onClick={onEdit}
          className="flex-1"
        >
          Edit
        </Button>
        <Button
          variant="outline"
          color="error"
          icon={Trash2}
          onClick={onDelete}
          className="flex-1"
        >
          Delete
        </Button>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="w-full py-2 text-sm text-text-secondary transition-colors hover:text-text"
      >
        Back to list
      </button>
    </div>
  );
}

function detailRows(
  doc: TravelDocument
): { label: string; value: string }[] {
  const { data, kind } = doc;
  const rows: { label: string; value: string }[] = [];

  const push = (label: string, value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) rows.push({ label, value: trimmed });
  };

  if (kind === "passport" || kind === "id") {
    push("Full name", data.fullName);
    push("Document number", data.documentNumber);
    push("Nationality", data.nationality);
    push("Expiry date", data.expiryDate);
  } else if (kind === "phone") {
    push("Phone number", data.phoneNumber);
  } else if (kind === "emergency_contact") {
    push("Name", data.fullName);
    push("Relationship", data.relationship);
    push("Phone number", data.phoneNumber);
  }

  push("Notes", data.notes);
  return rows;
}

function DocumentForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: TravelDocument;
  onCancel: () => void;
  onSave: (input: {
    kind: TravelDocumentKind;
    label: string;
    data: TravelDocumentData;
  }) => void;
}) {
  const [kind, setKind] = useState<TravelDocumentKind>(
    initial?.kind ?? "passport"
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [data, setData] = useState<TravelDocumentData>(() => ({
    ...emptyData(),
    ...initial?.data,
  }));
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof TravelDocumentData>(
    key: K,
    value: string
  ) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    const hasContent =
      Object.values(data).some((v) => typeof v === "string" && v.trim()) ||
      label.trim();
    if (!hasContent) {
      setError("Add at least one field before saving.");
      return;
    }
    setError(null);
    onSave({
      kind,
      label: label.trim() || TRAVEL_DOCUMENT_KIND_LABELS[kind],
      data,
    });
  }

  return (
    <div className="space-y-4">
      <DeviceOnlyBanner />

      <Field label="Type">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TRAVEL_DOCUMENT_KINDS.map((k) => {
            const Icon = KIND_ICONS[k];
            const selected = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cx(
                  "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary-tint text-primary"
                    : "border-border bg-surface-elevated text-text-secondary hover:bg-surface"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="leading-snug">
                  {TRAVEL_DOCUMENT_KIND_LABELS[k]}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Label (optional)">
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={TRAVEL_DOCUMENT_KIND_LABELS[kind]}
        />
      </Field>

      {(kind === "passport" || kind === "id" || kind === "emergency_contact") && (
        <Field label={kind === "emergency_contact" ? "Name" : "Full name"}>
          <TextInput
            value={data.fullName ?? ""}
            onChange={(e) => setField("fullName", e.target.value)}
            autoComplete="off"
          />
        </Field>
      )}

      {(kind === "passport" || kind === "id") && (
        <>
          <Field label="Document number">
            <TextInput
              value={data.documentNumber ?? ""}
              onChange={(e) => setField("documentNumber", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Nationality">
            <TextInput
              value={data.nationality ?? ""}
              onChange={(e) => setField("nationality", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Expiry date">
            <TextInput
              value={data.expiryDate ?? ""}
              onChange={(e) => setField("expiryDate", e.target.value)}
              placeholder="YYYY-MM-DD"
              autoComplete="off"
            />
          </Field>
        </>
      )}

      {(kind === "phone" || kind === "emergency_contact") && (
        <Field label="Phone number">
          <TextInput
            type="tel"
            value={data.phoneNumber ?? ""}
            onChange={(e) => setField("phoneNumber", e.target.value)}
            autoComplete="off"
          />
        </Field>
      )}

      {kind === "emergency_contact" && (
        <Field label="Relationship">
          <TextInput
            value={data.relationship ?? ""}
            onChange={(e) => setField("relationship", e.target.value)}
            placeholder="e.g. Spouse, parent"
            autoComplete="off"
          />
        </Field>
      )}

      <Field label={kind === "other" ? "Details" : "Notes (optional)"}>
        <textarea
          value={data.notes ?? ""}
          onChange={(e) => setField("notes", e.target.value)}
          rows={kind === "other" ? 5 : 3}
          className={cx(
            "block w-full rounded-xl border border-border bg-surface-elevated",
            "px-3 py-2.5 text-sm text-text placeholder:text-text-muted",
            "shadow-sm outline-none transition-colors",
            "focus:border-primary focus:ring-2 focus:ring-primary/20",
            "resize-y"
          )}
          placeholder={
            kind === "other"
              ? "Insurance policy, booking refs, allergies…"
              : undefined
          }
          autoComplete="off"
        />
      </Field>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      <div className="flex gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button onClick={handleSubmit} className="flex-1">
          {initial ? "Save" : "Add"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-text">{label}</span>
      {children}
    </label>
  );
}
