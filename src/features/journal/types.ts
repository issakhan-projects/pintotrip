import type { JournalCategory } from "./categories";

/** Localized article body — currently English HTML with Tailwind classes. */
export type JournalContent = {
  en: string;
};

/**
 * Firestore `journals/{journalId}` document.
 * `title` is optional; when missing the first `<h1>` in `content.en` is used.
 */
export type Journal = {
  id: string;
  categories: JournalCategory[];
  coverImageUrl?: string;
  content: JournalContent;
  /** When false the article must not be shown. */
  status: boolean;
  createdAt: number;
  updatedAt: number;
  /** Optional explicit title (preferred over HTML h1). */
  title?: string;
};

export type JournalListItem = {
  id: string;
  title: string;
  categories: JournalCategory[];
  coverImageUrl?: string;
  createdAt: number;
  updatedAt: number;
};
