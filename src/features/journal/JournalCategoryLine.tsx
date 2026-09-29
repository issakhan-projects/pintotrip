import { formatJournalCategory } from "./categories";

type Props = {
  categories: string[];
  className?: string;
};

/**
 * Editorial category line — subtle labels, not pill chips.
 */
export function JournalCategoryLine({ categories, className }: Props) {
  if (categories.length === 0) return null;

  return (
    <p
      className={
        className ??
        "text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted"
      }
    >
      {categories.map((cat, i) => (
        <span key={cat}>
          {i > 0 ? (
            <span className="mx-2 text-border" aria-hidden>
              ·
            </span>
          ) : null}
          {formatJournalCategory(cat)}
        </span>
      ))}
    </p>
  );
}
