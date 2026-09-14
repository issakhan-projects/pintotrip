"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, TextInput } from "@/components/ui";
import { Search as SearchIcon, Clock } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { SavedLocation } from "@/hooks/useLocations";

const RECENT_KEY = "pintototrip.recentSearches";

interface SearchSheetProps {
  open: boolean;
  onClose: () => void;
  locations: SavedLocation[];
  onSelectPlace: (place: SavedLocation) => void;
}

export function SearchSheet({
  open,
  onClose,
  locations,
  onSelectPlace,
}: SearchSheetProps) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      setRecent(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setRecent([]);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return locations.filter((place) => {
      const hay = [
        place.title,
        place.city.name,
        place.country.name,
        place.description,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [locations, query]);

  function remember(term: string) {
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, 8);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  }

  return (
    <Sheet open={open} onClose={onClose} title="Search" size="md">
      <div className="flex flex-col gap-4">
        <TextInput
          icon={SearchIcon}
          placeholder="Search places, cities, countries…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {!query.trim() ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              Recent searches
            </p>
            {recent.length === 0 ? (
              <p className="text-sm text-text-secondary">
                No recent searches yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {recent.map((term) => (
                  <li key={term}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-text hover:bg-surface"
                      onClick={() => setQuery(term)}
                    >
                      <Clock className="h-4 w-4 text-text-muted" />
                      {term}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {results.length === 0 ? (
              <p className="text-sm text-text-secondary">No matches.</p>
            ) : (
              results.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface px-3 py-3 text-left"
                  onClick={() => {
                    remember(query.trim());
                    onSelectPlace(place);
                    onClose();
                  }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text">
                      {place.title}
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {place.city.name}, {place.country.name}
                    </p>
                  </div>
                  <StatusBadge status={place.status} />
                </button>
              ))
            )}
          </div>
        )}

        {query.trim() ? (
          <Button
            variant="secondary"
            onClick={() => remember(query.trim())}
            className="!bg-surface !text-text-secondary !border-border"
          >
            Save to recent
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
