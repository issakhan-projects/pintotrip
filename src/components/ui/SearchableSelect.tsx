"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cx } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Optional secondary text shown in the list (e.g. native name, symbol). */
  description?: string;
};

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  clearable = true,
  disabled = false,
  className,
}: SearchableSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.description?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
        setFocusIndex(-1);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setFocusIndex(-1);
      window.setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    setFocusIndex(-1);
  }

  function select(next: string) {
    onChange(next);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
      return;
    }

    if (event.key === "Enter" && focusIndex >= 0 && filtered[focusIndex]) {
      event.preventDefault();
      select(filtered[focusIndex].value);
    }
  }

  return (
    <div
      ref={rootRef}
      className={cx("relative w-full", className)}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        className={cx(
          "flex w-full min-h-11 items-center gap-2 rounded-[10px] border-[1.5px] border-border bg-white px-2.5 py-1.5 pr-10 text-left text-sm text-text outline-none transition",
          "hover:border-text-muted",
          open &&
            "border-primary shadow-[0_0_0_3.5px_color-mix(in_srgb,var(--color-primary)_15%,transparent)]",
          disabled && "cursor-not-allowed opacity-60"
        )}
      >
        <span
          className={cx(
            "min-w-0 flex-1 truncate",
            selected ? "text-text" : "text-text-muted"
          )}
        >
          {selected ? selected.label : placeholder}
        </span>
      </button>

      {clearable && selected && !disabled ? (
        <button
          type="button"
          aria-label="Clear selection"
          className="absolute right-8 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-text-muted hover:bg-error-background hover:text-error"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
            close();
          }}
        >
          <X className="size-3.5" />
        </button>
      ) : null}

      <ChevronDown
        className={cx(
          "pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted transition",
          open && "rotate-180 text-primary"
        )}
      />

      {open ? (
        <div className="absolute top-[calc(100%+6px)] right-0 left-0 z-50 overflow-hidden rounded-xl border-[1.5px] border-border bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
          <div className="border-b border-divider p-2.5 pb-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full rounded-lg border-[1.5px] border-border bg-surface py-2 pr-2.5 pl-8 text-[13px] text-text outline-none placeholder:text-text-muted focus:border-primary"
              />
            </div>
          </div>

          <ul
            id={listId}
            role="listbox"
            className="max-h-60 overflow-y-auto p-1.5"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-5 text-center text-[13px] text-text-muted">
                No results
              </li>
            ) : (
              filtered.map((option, index) => {
                const isSelected = option.value === value;
                const isFocused = index === focusIndex;
                return (
                  <li key={option.value} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      className={cx(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                        isSelected && "bg-primary-tint font-medium text-primary",
                        !isSelected && isFocused && "bg-surface",
                        !isSelected && !isFocused && "text-text hover:bg-surface"
                      )}
                      onMouseEnter={() => setFocusIndex(index)}
                      onClick={() => select(option.value)}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="shrink-0 text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                          {option.description}
                        </span>
                      ) : (
                        <span className="shrink-0 font-mono text-[11px] font-semibold tracking-wide text-text-muted">
                          {option.value}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
