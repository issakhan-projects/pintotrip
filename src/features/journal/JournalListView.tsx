"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Loader2 } from "lucide-react";
import { listPublishedJournals } from "@/services/journals";
import {
  JOURNAL_CATEGORIES,
  formatJournalCategory,
  getJournalCategoryIcon,
  type JournalCategory,
} from "./categories";
import type { JournalListItem } from "./types";
import { JournalShell } from "./JournalShell";
import { JournalCategoryLine } from "./JournalCategoryLine";
import { cx } from "@/lib/utils";

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

/** Categories present in published journals, keeping canonical order. */
function categoriesFromItems(items: JournalListItem[]): JournalCategory[] {
  const present = new Set<string>();
  for (const item of items) {
    for (const cat of item.categories) present.add(cat);
  }
  return JOURNAL_CATEGORIES.filter((cat) => present.has(cat));
}

function countByCategory(items: JournalListItem[]): Map<JournalCategory, number> {
  const counts = new Map<JournalCategory, number>();
  for (const item of items) {
    for (const cat of item.categories) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
  }
  return counts;
}

function JournalCard({
  item,
  featured = false,
}: {
  item: JournalListItem;
  featured?: boolean;
}) {
  const date = formatDate(item.createdAt);

  return (
    <Link
      href={`/journal/${item.id}`}
      className={
        featured
          ? "group relative block overflow-hidden rounded-3xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          : "group flex flex-col gap-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      }
    >
      <div
        className={
          featured
            ? "relative aspect-[16/10] w-full overflow-hidden bg-surface sm:aspect-[21/9]"
            : "relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-surface"
        }
      >
        {item.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- dynamic Firestore URLs
          <img
            src={item.coverImageUrl}
            alt=""
            loading={featured ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-surface via-primary-tint to-surface" />
        )}
        {featured ? (
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        ) : null}
      </div>

      <div
        className={
          featured
            ? "absolute inset-x-0 bottom-0 p-6 sm:p-10 lg:p-12"
            : "flex flex-1 flex-col"
        }
      >
        <JournalCategoryLine
          categories={item.categories.slice(0, featured ? 4 : 3)}
          className={
            featured
              ? "text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75"
              : undefined
          }
        />
        <h2
          className={
            featured
              ? "mt-3 max-w-2xl font-[family-name:var(--font-manrope)] text-2xl font-semibold tracking-tight text-white sm:text-4xl sm:leading-tight"
              : "mt-2 font-[family-name:var(--font-manrope)] text-lg font-semibold tracking-tight text-text transition-colors group-hover:text-primary sm:text-xl"
          }
        >
          {item.title}
        </h2>
        {date ? (
          <time
            dateTime={new Date(item.createdAt).toISOString()}
            className={
              featured
                ? "mt-3 block text-sm text-white/70"
                : "mt-2 text-sm text-text-muted"
            }
          >
            {date}
          </time>
        ) : null}
      </div>
    </Link>
  );
}

/**
 * Magazine-style index of published travel journals.
 */
export function JournalListView() {
  const [items, setItems] = useState<JournalListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<JournalCategory | "all">(
    "all"
  );

  useEffect(() => {
    let cancelled = false;
    listPublishedJournals()
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load journals. Please try again.");
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const availableCategories = useMemo(
    () => (items ? categoriesFromItems(items) : []),
    [items]
  );

  const categoryCounts = useMemo(
    () => (items ? countByCategory(items) : new Map<JournalCategory, number>()),
    [items]
  );

  const filtered = useMemo(() => {
    if (!items) return [];
    if (activeCategory === "all") return items;
    return items.filter((item) => item.categories.includes(activeCategory));
  }, [items, activeCategory]);

  // Drop stale selection if that category disappears from the feed.
  useEffect(() => {
    if (
      activeCategory !== "all" &&
      items &&
      !availableCategories.includes(activeCategory)
    ) {
      setActiveCategory("all");
    }
  }, [activeCategory, availableCategories, items]);

  const featured = filtered[0];
  const rest = filtered.slice(1);
  const allCount = items?.length ?? 0;

  return (
    <JournalShell>
      <main>
        <section className="border-b border-border bg-surface/60">
          <div className="mx-auto max-w-5xl px-4 pt-12 pb-6 sm:px-6 sm:pt-16 sm:pb-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              Travel Journal
            </p>
            <h1 className="mt-3 max-w-xl font-[family-name:var(--font-manrope)] text-3xl font-semibold tracking-tight text-text sm:text-4xl">
              Stories from the road
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-text-secondary sm:text-base">
              Destinations, itineraries, and quiet corners worth pinning —
              written for travelers who map what they love.
            </p>
          </div>

          {items !== null && items.length > 0 ? (
            <div className="border-t border-border/80">
              <div
                className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 py-3 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                role="tablist"
                aria-label="Journal categories"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === "all"}
                  onClick={() => setActiveCategory("all")}
                  className={cx(
                    "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors",
                    activeCategory === "all"
                      ? "border-text/15 bg-white font-medium text-text shadow-sm"
                      : "border-transparent text-text-secondary hover:bg-white/70 hover:text-text"
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>All</span>
                  <span
                    className={cx(
                      "rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                      activeCategory === "all"
                        ? "bg-violet-50 text-violet-700"
                        : "bg-black/5 text-text-muted"
                    )}
                  >
                    {allCount}
                  </span>
                </button>
                {availableCategories.map((cat) => {
                  const selected = activeCategory === cat;
                  const Icon = getJournalCategoryIcon(cat);
                  const count = categoryCounts.get(cat) ?? 0;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveCategory(cat)}
                      className={cx(
                        "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors",
                        selected
                          ? "border-text/15 bg-white font-medium text-text shadow-sm"
                          : "border-transparent text-text-secondary hover:bg-white/70 hover:text-text"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>{formatJournalCategory(cat)}</span>
                      <span
                        className={cx(
                          "rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                          selected
                            ? "bg-violet-50 text-violet-700"
                            : "bg-black/5 text-text-muted"
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        {items === null ? (
          <div className="flex min-h-[40vh] items-center justify-center px-4">
            <Loader2
              className="h-7 w-7 animate-spin text-primary"
              aria-label="Loading journals"
            />
          </div>
        ) : error ? (
          <div className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6">
            <p className="text-sm text-text-secondary">{error}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6">
            <p className="font-[family-name:var(--font-manrope)] text-lg font-medium text-text">
              New stories coming soon
            </p>
            <p className="mt-2 text-sm text-text-secondary">
              Check back for travel guides and destination notes.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6">
            <p className="font-[family-name:var(--font-manrope)] text-lg font-medium text-text">
              No stories in this category yet
            </p>
            <button
              type="button"
              onClick={() => setActiveCategory("all")}
              className="mt-3 text-sm text-primary transition-colors hover:text-primary-hover"
            >
              View all journals
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
            {featured ? (
              <div className="mb-12 sm:mb-16">
                <JournalCard item={featured} featured />
              </div>
            ) : null}

            {rest.length > 0 ? (
              <div className="grid gap-10 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-12 lg:grid-cols-3">
                {rest.map((item) => (
                  <JournalCard key={item.id} item={item} />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </main>
    </JournalShell>
  );
}
