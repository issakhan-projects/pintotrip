"use client";

import { useMemo } from "react";
import { prepareJournalHtml } from "./html";

type Props = {
  html: string;
  /** When true, remove the first h1 (shown in the page header instead). */
  stripLeadingH1?: boolean;
  /** When true, remove the first paragraph (shown as the hero deck). */
  stripLeadingIntro?: boolean;
};

/**
 * Renders journal `content.en` HTML with lazy images and safe links.
 * Tailwind classes on the markup are preserved; editorial base styles live in globals.
 */
export function JournalArticleBody({
  html,
  stripLeadingH1 = true,
  stripLeadingIntro = false,
}: Props) {
  const prepared = useMemo(
    () => prepareJournalHtml(html, { stripLeadingH1, stripLeadingIntro }),
    [html, stripLeadingH1, stripLeadingIntro]
  );

  return (
    <div
      className="journal-prose"
      // Content is sanitized in prepareJournalHtml (scripts / handlers stripped).
      dangerouslySetInnerHTML={{ __html: prepared }}
    />
  );
}
