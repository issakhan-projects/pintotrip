"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X, type LucideIcon } from "lucide-react";
import { cx } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Optional secondary text shown in the list (e.g. native name, symbol). */
  description?: string;
  /** Optional leading image (e.g. airline logo). Hidden if load fails. */
  iconUrl?: string;
  /** Optional Lucide icon shown in the trigger and option list. */
  icon?: LucideIcon;
};

function OptionLeading({
  option,
  size = "md",
}: {
  option: SearchableSelectOption;
  size?: "sm" | "md";
}) {
  if (option.iconUrl) {
    return <OptionIcon src={option.iconUrl} alt="" size={size} />;
  }
  if (option.icon) {
    const Icon = option.icon;
    return (
      <Icon
        className={cx(
          "shrink-0 text-text-muted",
          size === "sm" ? "h-4 w-4" : "h-4 w-4"
        )}
        aria-hidden
      />
    );
  }
  return null;
}

function OptionIcon({
  src,
  alt,
  size = "md",
}: {
  src: string;
  alt: string;
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote CDN logos; plain img with onError
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cx(
        "shrink-0 rounded object-contain",
        size === "sm" ? "size-5" : "size-7"
      )}
    />
  );
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  /** Optional leading icon inside the trigger. */
  leadingIcon?: LucideIcon;
  /**
   * `stacked` shows label + description in the trigger (airport-style).
   * Default keeps a single-line label.
   */
  triggerLayout?: "single" | "stacked";
  /**
   * Layout for options inside the menu. Defaults to `triggerLayout`.
   * Use `stacked` for long titles + descriptions (leisure type).
   */
  listLayout?: "single" | "stacked";
  /** Hide the in-menu search field (useful for short option lists). */
  searchable?: boolean;
}

const MENU_MAX_HEIGHT = 240;
const MENU_GAP = 6;

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  clearable = true,
  disabled = false,
  className,
  leadingIcon: LeadingIcon,
  triggerLayout = "single",
  listLayout,
  searchable = true,
}: SearchableSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [mounted, setMounted] = useState(false);

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
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }

    function updatePosition() {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const estimatedHeight = Math.min(
        MENU_MAX_HEIGHT + (searchable ? 64 : 8),
        320
      );
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP;
      const openUp =
        spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
      const preferredWidth = Math.max(rect.width, searchable ? 260 : 180);
      const width = Math.min(preferredWidth, window.innerWidth - 16);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }

      setMenuStyle({
        position: "fixed",
        left,
        width,
        zIndex: 200,
        maxWidth: "min(100vw - 16px, 100%)",
        ...(openUp
          ? {
              bottom: window.innerHeight - rect.top + MENU_GAP,
              top: "auto",
            }
          : {
              top: rect.bottom + MENU_GAP,
              bottom: "auto",
            }),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    // Capture scroll from sheet / nested overflow containers.
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, filtered.length, searchable]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
      setQuery("");
      setFocusIndex(-1);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setFocusIndex(-1);
      if (searchable) {
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
    }
  }, [open, searchable]);

  function close() {
    setOpen(false);
    setQuery("");
    setFocusIndex(-1);
  }

  function select(next: string) {
    onChange(next);
    close();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        if (!disabled) setOpen(true);
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
    if (event.key === "Enter" && focusIndex >= 0) {
      event.preventDefault();
      const option = filtered[focusIndex];
      if (option) select(option.value);
    }
  }

  const stacked = triggerLayout === "stacked";
  const listStacked = (listLayout ?? triggerLayout) === "stacked";

  const menu =
    open && mounted && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
          >
            {searchable ? (
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
                    className="w-full rounded-lg border border-border bg-surface py-2 pr-2.5 pl-8 text-[13px] text-text outline-none placeholder:text-text-muted focus:border-primary"
                  />
                </div>
              </div>
            ) : null}

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
                    <li
                      key={option.value}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <button
                        type="button"
                        className={cx(
                          "flex w-full gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                          listStacked ? "items-start" : "items-center",
                          isSelected && "bg-primary-tint font-medium text-primary",
                          !isSelected && isFocused && "bg-surface",
                          !isSelected &&
                            !isFocused &&
                            "text-text hover:bg-surface"
                        )}
                        onMouseEnter={() => setFocusIndex(index)}
                        onClick={() => select(option.value)}
                      >
                        {option.iconUrl || option.icon ? (
                          <span className={cx("shrink-0", listStacked && "mt-0.5")}>
                            <OptionLeading option={option} size="sm" />
                          </span>
                        ) : null}
                        {listStacked ? (
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold leading-snug">
                              {option.label}
                            </span>
                            {option.description ? (
                              <span
                                className={cx(
                                  "mt-0.5 block text-xs leading-snug",
                                  isSelected
                                    ? "text-primary/80"
                                    : "text-text-secondary"
                                )}
                              >
                                {option.description}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <>
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
                          </>
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        )
      : null;

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
          "flex w-full items-center gap-2.5 rounded-xl border border-border bg-white pl-3 pr-10 text-left text-sm text-text outline-none transition",
          stacked ? "min-h-[3.25rem] py-2" : "min-h-11 py-1.5",
          "hover:border-text-muted",
          open && "border-primary ring-2 ring-primary/20",
          disabled && "cursor-not-allowed opacity-60"
        )}
      >
        {selected && (selected.iconUrl || selected.icon) ? (
          <OptionLeading option={selected} size="md" />
        ) : LeadingIcon ? (
          <LeadingIcon
            className="h-4 w-4 shrink-0 text-text-muted"
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 flex-1">
          {selected ? (
            stacked ? (
              <>
                <span className="block truncate text-sm font-semibold text-text">
                  {selected.label}
                </span>
                {selected.description ? (
                  <span className="mt-0.5 block truncate text-xs text-text-secondary">
                    {selected.description}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="block truncate text-text">{selected.label}</span>
            )
          ) : (
            <span className="block truncate text-text-muted">{placeholder}</span>
          )}
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

      {menu}
    </div>
  );
}
