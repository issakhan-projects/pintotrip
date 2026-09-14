"use client";

/**
 * Minimal map legend for city-area highlights.
 */
export function MapCityLegend() {
  return (
    <div
      className="pointer-events-none absolute bottom-24 left-3 z-[5] rounded-lg bg-surface-elevated/95 px-3 py-2 text-xs text-text shadow-sm ring-1 ring-border backdrop-blur-sm"
      aria-label="City area legend"
    >
      <ul className="flex flex-col gap-1.5">
        <li className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: "#16A34A" }}
            aria-hidden
          />
          <span>Visited</span>
        </li>
        <li className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: "#2563EB" }}
            aria-hidden
          />
          <span>Planned</span>
        </li>
      </ul>
    </div>
  );
}
