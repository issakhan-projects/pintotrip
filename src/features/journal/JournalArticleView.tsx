"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bookmark,
  ChevronRight,
  Loader2,
  MapPin,
  MapPinned,
  MoreHorizontal,
  Share2,
} from "lucide-react";
import { getPublishedJournal } from "@/services/journals";
import {
  estimateReadMinutes,
  extractJournalIntro,
  extractJournalToc,
  resolveJournalTitle,
  type JournalTocItem,
} from "./html";
import type { Journal } from "./types";
import { JournalShell } from "./JournalShell";
import { JournalCategoryLine } from "./JournalCategoryLine";
import { JournalArticleBody } from "./JournalArticleBody";
import { JournalCtaBanner } from "./JournalCtaBanner";
import { cx } from "@/lib/utils";

type Props = {
  journalId: string;
};

function formatDate(ms: number): string {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function ArticleNotFound() {
  return (
    <JournalShell>
      <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-20 text-center sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
          Journal
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-manrope)] text-2xl font-semibold tracking-tight text-text">
          Article not found
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          This story is unavailable or no longer published.
        </p>
        <Link
          href="/journal"
          className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Browse journals
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </main>
    </JournalShell>
  );
}

function IconGhostButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-text-secondary transition-colors hover:border-text/20 hover:text-text"
    >
      {children}
    </button>
  );
}

function ArticleTocCard({
  items,
  coverImageUrl,
}: {
  items: JournalTocItem[];
  coverImageUrl?: string;
}) {
  if (items.length === 0) return null;

  const placeLabel = `${items.length} place${items.length === 1 ? "" : "s"}`;
  const mid = Math.ceil(items.length / 2);
  const columns = [items.slice(0, mid), items.slice(mid)];

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-white">
      <div className="grid lg:grid-cols-[1.55fr_0.95fr]">
        {/* Left — the list */}
        <div className="p-5 sm:p-7 lg:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
            In this article
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="font-[family-name:var(--font-manrope)] text-2xl font-bold tracking-tight text-text sm:text-[1.75rem]">
              The list
            </h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {placeLabel}
            </span>
          </div>

          <div className="mt-6 grid sm:grid-cols-2 sm:gap-x-8">
            {columns.map((column, colIndex) => (
              <ol key={colIndex} className="min-w-0">
                {column.map((item, rowIndex) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className={cx(
                        "group flex items-center gap-3 py-3.5 transition-colors",
                        rowIndex < column.length - 1
                          ? "border-b border-border/80"
                          : ""
                      )}
                    >
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-50 text-xs font-semibold text-violet-800">
                        {item.index}
                      </span>

                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- dynamic CMS URLs
                        <img
                          src={item.imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-11 w-14 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="h-11 w-14 shrink-0 rounded-lg bg-slate-100" />
                      )}

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text group-hover:text-primary">
                          {item.title}
                        </span>
                        {item.subtitle ? (
                          <span className="mt-0.5 block truncate text-xs text-text-muted">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>

                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text"
                        aria-hidden
                      />
                    </a>
                  </li>
                ))}
              </ol>
            ))}
          </div>
        </div>

        {/* Right — cover + CTA */}
        <aside className="flex flex-col gap-4 border-t border-border bg-slate-50/60 p-5 sm:p-6 lg:border-t-0 lg:border-l lg:border-border">
          {coverImageUrl ? (
            <div className="relative aspect-[16/11] w-full overflow-hidden rounded-2xl bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- dynamic Firestore URLs */}
              <img
                src={coverImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          ) : null}

          <div className="flex flex-1 flex-col justify-between rounded-2xl bg-rose-50 p-5">
            <div>
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rose-200/80 bg-white text-rose-500">
                <MapPinned className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="mt-4 font-[family-name:var(--font-manrope)] text-base font-semibold text-text">
                Save your favorite places
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                Create your itinerary with PinToTrip and keep all your favorite
                places in one map.
              </p>
            </div>
            <Link
              href="/login"
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Start Planning
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}

/**
 * Single journal article — magazine editorial layout.
 */
export function JournalArticleView({ journalId }: Props) {
  const [journal, setJournal] = useState<Journal | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setJournal(undefined);
    getPublishedJournal(journalId)
      .then((doc) => {
        if (!cancelled) setJournal(doc);
      })
      .catch(() => {
        if (!cancelled) setJournal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [journalId]);

  const meta = useMemo(() => {
    if (!journal) return null;
    const html = journal.content.en;
    return {
      title: resolveJournalTitle(html, journal.title),
      intro: extractJournalIntro(html),
      toc: extractJournalToc(html),
      readMinutes: estimateReadMinutes(html),
      date: formatDate(journal.createdAt),
    };
  }, [journal]);

  async function shareArticle() {
    if (!meta) return;
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: meta.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // User cancelled share — ignore.
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures.
    }
  }

  if (journal === undefined) {
    return (
      <JournalShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2
            className="h-7 w-7 animate-spin text-primary"
            aria-label="Loading article"
          />
        </div>
      </JournalShell>
    );
  }

  if (journal === null || !meta) {
    return <ArticleNotFound />;
  }

  return (
    <JournalShell>
      <article>
        <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12 lg:px-8 lg:pt-14">
          {/* Hero: copy + cover */}
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12 xl:gap-16">
            <div className="min-w-0">
              <JournalCategoryLine categories={journal.categories} />

              <h1 className="mt-4 font-[family-name:var(--font-manrope)] text-[1.85rem] font-bold tracking-tight text-text sm:text-4xl sm:leading-[1.12] lg:text-[2.65rem]">
                {meta.title}
              </h1>

              {meta.intro ? (
                <p className="mt-4 max-w-xl text-base leading-relaxed text-text-secondary sm:text-lg sm:leading-relaxed">
                  {meta.intro}
                </p>
              ) : null}

              <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Image
                    src="/icon.png"
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full object-cover ring-1 ring-border"
                  />
                  <div>
                    <p className="text-sm text-text">
                      By <span className="font-semibold">PinToTrip</span>
                    </p>
                    <p className="text-xs text-text-muted sm:text-sm">
                      {meta.date ? (
                        <time
                          dateTime={new Date(journal.createdAt).toISOString()}
                        >
                          {meta.date}
                        </time>
                      ) : null}
                      {meta.date ? " · " : null}
                      {meta.readMinutes} min read
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <IconGhostButton label="Save link" onClick={copyLink}>
                    <Bookmark className="h-4 w-4" aria-hidden />
                  </IconGhostButton>
                  <IconGhostButton label="Share article" onClick={shareArticle}>
                    <Share2 className="h-4 w-4" aria-hidden />
                  </IconGhostButton>
                  <IconGhostButton label="More options" onClick={copyLink}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </IconGhostButton>
                  {copied ? (
                    <span className="text-xs text-text-muted">Link copied</span>
                  ) : null}
                </div>
              </div>
            </div>

            {journal.coverImageUrl ? (
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-surface sm:aspect-[5/4] lg:aspect-auto lg:min-h-[320px] lg:self-stretch">
                {/* eslint-disable-next-line @next/next/no-img-element -- dynamic Firestore URLs */}
                <img
                  src={journal.coverImageUrl}
                  alt=""
                  fetchPriority="high"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="hidden min-h-[280px] rounded-3xl bg-gradient-to-br from-slate-100 via-rose-50 to-slate-50 lg:block" />
            )}
          </div>

          {/* TOC + CTA */}
          <div className="mt-10 sm:mt-12">
            <ArticleTocCard
              items={meta.toc}
              coverImageUrl={journal.coverImageUrl}
            />
          </div>

          {/* Body */}
          <div className="mx-auto mt-12 max-w-3xl sm:mt-16">
            <JournalArticleBody
              html={journal.content.en}
              stripLeadingH1
              stripLeadingIntro={Boolean(meta.intro)}
            />
          </div>

          {/* End CTA */}
          <div className="mt-14 pb-20 sm:mt-20 sm:pb-28">
            <JournalCtaBanner
              categories={journal.categories}
              imageUrl={journal.coverImageUrl}
            />
          </div>
        </div>
      </article>
    </JournalShell>
  );
}
