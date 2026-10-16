import type { Timestamp } from "firebase/firestore";

export const SUPPORT_TYPES = [
  "bug",
  "account",
  "billing",
  "places",
  "planner",
  "other",
] as const;

export type SupportTypeId = (typeof SUPPORT_TYPES)[number];

export type SupportTicketStatus = "open" | "closed";

/**
 * Firestore document: support/{ticketId}
 * Written by signed-in clients; status updates are Admin / support tools only.
 */
export interface SupportTicket {
  userId: string;
  email?: string;
  type: SupportTypeId;
  /** Localized topic label at submit time (admin-readable). */
  topicLabel?: string;
  question: string;
  status: SupportTicketStatus;
  language?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SupportTicketCreateInput = {
  userId: string;
  email?: string;
  type: SupportTypeId;
  topicLabel?: string;
  question: string;
  language?: string;
};
