import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import {
  isJournalCategory,
  type JournalCategory,
} from "@/features/journal/categories";
import { resolveJournalTitle } from "@/features/journal/html";
import type { Journal, JournalListItem } from "@/features/journal/types";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function parseCategories(raw: unknown): JournalCategory[] {
  const out: JournalCategory[] = [];
  for (const value of asStringArray(raw)) {
    const slug = value.trim().toLowerCase();
    if (isJournalCategory(slug) && !out.includes(slug)) {
      out.push(slug);
    }
  }
  return out;
}

function parseJournal(
  id: string,
  data: Record<string, unknown>
): Journal | null {
  const contentRaw = data.content;
  if (!contentRaw || typeof contentRaw !== "object") return null;
  const en = (contentRaw as Record<string, unknown>).en;
  if (typeof en !== "string" || !en.trim()) return null;
  if (typeof data.status !== "boolean") return null;

  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : undefined;

  return {
    id,
    categories: parseCategories(data.categories),
    coverImageUrl:
      typeof data.coverImageUrl === "string" && data.coverImageUrl.trim()
        ? data.coverImageUrl.trim()
        : undefined,
    content: { en },
    status: data.status,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    ...(title ? { title } : {}),
  };
}

function toListItem(journal: Journal): JournalListItem {
  return {
    id: journal.id,
    title: resolveJournalTitle(journal.content.en, journal.title),
    categories: journal.categories,
    coverImageUrl: journal.coverImageUrl,
    createdAt: journal.createdAt,
    updatedAt: journal.updatedAt,
  };
}

/**
 * Published journals newest-first.
 * Requires Firestore composite index: status Asc + createdAt Desc (auto-prompted).
 */
export async function listPublishedJournals(options?: {
  max?: number;
}): Promise<JournalListItem[]> {
  const max = options?.max ?? 48;
  const q = query(
    collection(getFirestoreDb(), FirestorePaths.journals),
    where("status", "==", true),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  const items: JournalListItem[] = [];
  for (const docSnap of snap.docs) {
    const journal = parseJournal(
      docSnap.id,
      docSnap.data() as Record<string, unknown>
    );
    if (journal?.status) items.push(toListItem(journal));
  }
  return items;
}

/**
 * Single journal by id. Returns null when missing or `status === false`.
 */
export async function getPublishedJournal(
  journalId: string
): Promise<Journal | null> {
  const id = journalId.trim();
  if (!id) return null;

  const snap = await getDoc(doc(getFirestoreDb(), FirestorePaths.journal(id)));
  if (!snap.exists()) return null;

  const journal = parseJournal(snap.id, snap.data() as Record<string, unknown>);
  if (!journal || !journal.status) return null;
  return journal;
}
