/**
 * Travel documents stored only on-device (localStorage).
 * Never send these fields to Firebase, backend, AI, or analytics.
 */

export const TRAVEL_DOCUMENT_KINDS = [
  "passport",
  "id",
  "phone",
  "emergency_contact",
  "other",
] as const;

export type TravelDocumentKind = (typeof TRAVEL_DOCUMENT_KINDS)[number];

export const TRAVEL_DOCUMENT_KIND_LABELS: Record<TravelDocumentKind, string> = {
  passport: "Passport",
  id: "ID / document",
  phone: "Phone number",
  emergency_contact: "Emergency contact",
  other: "Other",
};

export type TravelDocumentData = {
  fullName?: string;
  documentNumber?: string;
  nationality?: string;
  expiryDate?: string;
  phoneNumber?: string;
  relationship?: string;
  notes?: string;
};

export type TravelDocument = {
  id: string;
  kind: TravelDocumentKind;
  /** Optional custom title; defaults to kind label in UI. */
  label: string;
  data: TravelDocumentData;
  createdAt: string;
  updatedAt: string;
};

export type TravelDocumentInput = {
  kind: TravelDocumentKind;
  label: string;
  data: TravelDocumentData;
};
