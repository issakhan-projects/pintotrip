import type { Metadata } from "next";
import { JournalArticleView, resolveJournalTitle } from "@/features/journal";
import { getPublishedJournal } from "@/services/journals";

type PageProps = {
  params: Promise<{ journalId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { journalId } = await params;
  try {
    const journal = await getPublishedJournal(journalId);
    if (journal) {
      const title = resolveJournalTitle(journal.content.en, journal.title);
      const description = journal.categories.length
        ? `PinToTrip Journal · ${journal.categories.slice(0, 3).join(", ")}`
        : "A PinToTrip travel story.";
      return {
        title,
        description,
        openGraph: {
          title: `${title} — PinToTrip`,
          description,
          ...(journal.coverImageUrl
            ? { images: [{ url: journal.coverImageUrl }] }
            : {}),
        },
        alternates: {
          canonical: `/journal/${journalId}`,
        },
      };
    }
  } catch {
    // Fall through to generic metadata.
  }

  return {
    title: "Journal",
    description: "A PinToTrip travel story.",
    alternates: {
      canonical: `/journal/${journalId}`,
    },
  };
}

export default async function JournalArticlePage({ params }: PageProps) {
  const { journalId } = await params;
  return <JournalArticleView journalId={journalId} />;
}
