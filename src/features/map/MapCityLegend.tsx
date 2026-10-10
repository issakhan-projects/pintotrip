"use client";

import { useI18n } from "@/i18n";

const LEGEND_ITEMS = [
  { key: "visited" as const, color: "#16A34A", countKey: "visited" as const },
  { key: "planned" as const, color: "#2563EB", countKey: "planned" as const },
  {
    key: "wantToVisit" as const,
    color: "#CA8A04",
    countKey: "wantToVisit" as const,
  },
];

export interface MapCityLegendCounts {
  visited: number;
  planned: number;
  wantToVisit: number;
}

interface MapCityLegendProps {
  counts: MapCityLegendCounts;
}

/**
 * Minimal map legend for city-area highlights.
 * Counts come from already-loaded locations (no extra fetch).
 */
export function MapCityLegend({ counts }: MapCityLegendProps) {
  const { t } = useI18n();

  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 z-[5] rounded-lg bg-surface-elevated/95 px-3 py-2 text-xs text-text shadow-sm ring-1 ring-border backdrop-blur-sm sm:bottom-24"
      aria-label={t("map.legendAria")}
    >
      <ul className="flex flex-col gap-1.5">
        {LEGEND_ITEMS.map(({ key, color, countKey }) => (
          <li key={key} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <span>{t(`map.legend.${key}`)}</span>
              <span className="tabular-nums text-text-muted">
                {counts[countKey]}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
