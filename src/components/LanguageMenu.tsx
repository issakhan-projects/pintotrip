"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Languages } from "lucide-react";
import { useI18n } from "@/i18n";
import { UI_LOCALES, type UiLocaleCode } from "@/i18n/locales";
import { cx } from "@/lib/utils";

type LanguageMenuProps = {
  className?: string;
  /** Compact trigger for nav bars (code only). */
  variant?: "nav" | "field";
  /** Called after locale changes (e.g. persist to profile). */
  onLocaleChange?: (code: UiLocaleCode) => void;
  disabled?: boolean;
};

const MENU_GAP = 6;

export function LanguageMenu({
  className,
  variant = "nav",
  onLocaleChange,
  disabled = false,
}: LanguageMenuProps) {
  const { locale, setLocale, t } = useI18n();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const current =
    UI_LOCALES.find((l) => l.code === locale) ?? UI_LOCALES[0];

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || variant === "field") {
      setMenuStyle(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;

    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(176, rect.width);
      let left = rect.right - width;
      left = Math.min(left, window.innerWidth - width - 8);
      left = Math.max(8, left);
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + MENU_GAP,
        left,
        width,
        zIndex: 80,
      });
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, variant]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function select(code: UiLocaleCode) {
    setLocale(code);
    onLocaleChange?.(code);
    setOpen(false);
  }

  const menu = (
    <ul
      ref={menuRef}
      id={listId}
      role="listbox"
      aria-label={t("profile.prefs.language")}
      style={variant === "nav" ? menuStyle ?? undefined : undefined}
      className={cx(
        "overflow-hidden rounded-xl border border-border bg-surface-elevated py-1 shadow-lg",
        variant === "field" &&
          "absolute left-0 right-0 z-50 mt-1 min-w-[11rem]",
        variant === "nav" && "min-w-[11rem]"
      )}
    >
      {UI_LOCALES.map((option) => {
        const selected = option.code === locale;
        return (
          <li key={option.code} role="option" aria-selected={selected}>
            <button
              type="button"
              onClick={() => select(option.code)}
              className={cx(
                "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors",
                selected
                  ? "bg-primary-tint font-medium text-primary"
                  : "text-text hover:bg-surface"
              )}
            >
              <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-text-secondary">
                {option.shortLabel}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {option.nativeLabel}
              </span>
              {selected ? (
                <Check className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <span className="w-4 shrink-0" aria-hidden />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      {variant === "field" ? (
        <p className="mb-1.5 text-sm font-medium text-text">
          {t("profile.prefs.language")}
        </p>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t("profile.prefs.language")}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated text-sm font-medium text-text transition-colors",
          "hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          "disabled:pointer-events-none disabled:opacity-50",
          variant === "nav" ? "h-9 px-2.5" : "h-11 w-full justify-between px-3"
        )}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <Languages className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
          {variant === "nav" ? (
            <span className="tabular-nums tracking-wide">{current.shortLabel}</span>
          ) : (
            <span className="truncate">
              {current.nativeLabel}
              {current.nativeLabel !== current.label
                ? ` · ${current.label}`
                : ""}
            </span>
          )}
        </span>
        <ChevronDown
          className={cx(
            "h-4 w-4 shrink-0 text-text-secondary transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && variant === "field" ? menu : null}
      {open && variant === "nav" && mounted && menuStyle
        ? createPortal(menu, document.body)
        : null}
    </div>
  );
}
