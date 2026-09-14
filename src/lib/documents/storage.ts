import {
  TRAVEL_DOCUMENT_KINDS,
  type TravelDocument,
  type TravelDocumentData,
  type TravelDocumentInput,
  type TravelDocumentKind,
} from "@/types/travel-document";

const STORAGE_PREFIX = "pintototrip.travel-documents.";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function isKind(value: unknown): value is TravelDocumentKind {
  return (
    typeof value === "string" &&
    (TRAVEL_DOCUMENT_KINDS as readonly string[]).includes(value)
  );
}

function sanitizeData(raw: unknown): TravelDocumentData {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const data: TravelDocumentData = {};
  const keys: (keyof TravelDocumentData)[] = [
    "fullName",
    "documentNumber",
    "nationality",
    "expiryDate",
    "phoneNumber",
    "relationship",
    "notes",
  ];
  for (const key of keys) {
    const value = src[key];
    if (typeof value === "string" && value.trim()) {
      data[key] = value.trim();
    }
  }
  return data;
}

function parseDocument(raw: unknown): TravelDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.id !== "string" || !src.id) return null;
  if (!isKind(src.kind)) return null;
  if (typeof src.createdAt !== "string" || typeof src.updatedAt !== "string") {
    return null;
  }
  return {
    id: src.id,
    kind: src.kind,
    label: typeof src.label === "string" ? src.label.trim() : "",
    data: sanitizeData(src.data),
    createdAt: src.createdAt,
    updatedAt: src.updatedAt,
  };
}

function readAll(userId: string): TravelDocument[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseDocument)
      .filter((doc): doc is TravelDocument => doc !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function writeAll(userId: string, docs: TravelDocument[]): void {
  if (typeof window === "undefined" || !userId) return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(docs));
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** List all travel documents for this user on this device. */
export function listTravelDocuments(userId: string): TravelDocument[] {
  return readAll(userId);
}

/** Create a travel document (localStorage only). */
export function createTravelDocument(
  userId: string,
  input: TravelDocumentInput
): TravelDocument {
  const now = new Date().toISOString();
  const doc: TravelDocument = {
    id: newId(),
    kind: input.kind,
    label: input.label.trim(),
    data: sanitizeData(input.data),
    createdAt: now,
    updatedAt: now,
  };
  const next = [doc, ...readAll(userId)];
  writeAll(userId, next);
  return doc;
}

/** Update an existing travel document (localStorage only). */
export function updateTravelDocument(
  userId: string,
  id: string,
  input: TravelDocumentInput
): TravelDocument | null {
  const docs = readAll(userId);
  const index = docs.findIndex((d) => d.id === id);
  if (index < 0) return null;
  const updated: TravelDocument = {
    ...docs[index],
    kind: input.kind,
    label: input.label.trim(),
    data: sanitizeData(input.data),
    updatedAt: new Date().toISOString(),
  };
  const next = [...docs];
  next[index] = updated;
  writeAll(userId, next);
  return updated;
}

/** Delete a travel document from this device. */
export function deleteTravelDocument(userId: string, id: string): boolean {
  const docs = readAll(userId);
  const next = docs.filter((d) => d.id !== id);
  if (next.length === docs.length) return false;
  writeAll(userId, next);
  return true;
}
