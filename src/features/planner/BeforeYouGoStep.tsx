"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BedDouble,
  Check,
  ClipboardList,
  Coins,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  Luggage,
  Map,
  Plane,
  Plus,
  Shield,
  Shirt,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button, TextInput } from "@/components/ui";
import { fetchFrankfurterRate } from "@/lib/currency";
import { resolveCurrencyCode } from "@/lib/currencies";
import { listTravelDocuments } from "@/lib/documents";
import type {
  PreparationCategory,
  PreparationItem,
  TripPlannerDoc,
} from "@/types/trip-planner";
import { preparationProgress } from "./tripUtils";
import { listTripDestinations } from "./tripDestinations";
import { cx } from "@/lib/utils";
import {
  isCustomPreparationItem,
  preparationInputFromTrip,
  preparationItemsEqual,
  syncTripPreparationItems,
  type LocalDocSignals,
} from "./buildPreparation";
import { parseHttpUrl } from "./preparationLinks";

const KERBEZ_URL = "https://kerbez.app";

const CATEGORY_ICON: Record<PreparationCategory, LucideIcon> = {
  documents: FileText,
  booking: BedDouble,
  transport: Plane,
  health: Shield,
  money: Coins,
  packing: Shirt,
  other: Map,
};

interface BeforeYouGoStepProps {
  trip: TripPlannerDoc;
  userId: string;
  /** User's preferred home currency (ISO 4217). */
  homeCurrency?: string;
  onToggleItem: (itemId: string, completed: boolean) => void;
  onAddItem: (title: string, link?: string) => void;
  onDeleteItem?: (itemId: string) => void;
  onSyncItems?: (items: PreparationItem[]) => void;
  onGoToDetails: () => void;
  onGoToPlaces: () => void;
  onViewGuide?: () => void;
}

export function BeforeYouGoStep({
  trip,
  userId,
  homeCurrency,
  onToggleItem,
  onAddItem,
  onDeleteItem,
  onSyncItems,
  onGoToDetails,
  onGoToPlaces,
  onViewGuide,
}: BeforeYouGoStepProps) {
  const items = [...trip.preparation.items].sort((a, b) => a.order - b.order);
  const progress = preparationProgress(items);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftLink, setDraftLink] = useState("");
  const [draftLinkError, setDraftLinkError] = useState<string | null>(null);
  const addInputId = useId();
  const addLinkInputId = useId();

  const localDocs = useMemo(
    () => localDocSignals(userId, trip.startDate?.toDate?.()),
    [userId, trip.startDate]
  );

  const onSyncItemsRef = useRef(onSyncItems);
  onSyncItemsRef.current = onSyncItems;

  useEffect(() => {
    const sync = onSyncItemsRef.current;
    if (!sync) return;
    const next = syncTripPreparationItems(
      trip.preparation.items,
      preparationInputFromTrip(trip, localDocs)
    );
    if (!preparationItemsEqual(trip.preparation.items, next)) {
      sync(next);
    }
    // trip.preparation.items is read but omitted from deps so toggles/custom
    // items are not rebuilt (and clobbered) on every checkbox click.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [
    localDocs,
    trip.id,
    trip.destinations,
    trip.from,
    trip.leisureType,
    trip.spendMoney,
    trip.startDate,
    trip.cityIntelligence,
    trip.preparation.documents,
    trip.preparation.visa,
  ]);

  const intel = trip.cityIntelligence.results?.[0];
  /** Prefer trip-stored Frankfurter rate from city intelligence. */
  const intelExchange = useMemo(() => {
    const results = trip.cityIntelligence.results ?? [];
    for (const result of results) {
      const er = result.exchangeRate;
      if (
        er &&
        typeof er.rate === "number" &&
        Number.isFinite(er.rate) &&
        er.rate > 0 &&
        er.from?.trim() &&
        er.to?.trim()
      ) {
        return er;
      }
    }
    return null;
  }, [trip.cityIntelligence.results]);

  const destCurrency = resolveCurrencyCode(
    intelExchange?.to ||
      trip.currency?.code ||
      trip.currency?.name ||
      intel?.details?.dailyBudget?.currency ||
      ""
  );
  // Prefer profile currency; fall back to city-intel "from", then USD.
  const fromCurrency = resolveCurrencyCode(
    homeCurrency || intelExchange?.from || intel?.exchangeRate?.from || "USD"
  );
  const destLabel = trip.currency?.name?.trim() || destCurrency;
  const destSymbol = trip.currency?.symbol?.trim() || "";

  const [fxRate, setFxRate] = useState<number | null>(
    () => intelExchange?.rate ?? null
  );
  const [fxDate, setFxDate] = useState<string | null>(
    () => intelExchange?.asOf ?? null
  );
  const [fxSource, setFxSource] = useState<string | null>(
    () => intelExchange?.source?.trim() || (intelExchange ? "City intelligence" : null)
  );
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);
  const [convertAmount, setConvertAmount] = useState("100");
  const [convertDirection, setConvertDirection] = useState<"home-to-local" | "local-to-home">(
    "home-to-local"
  );

  useEffect(() => {
    // City intelligence already has the rate — no network needed.
    if (intelExchange) {
      setFxRate(intelExchange.rate);
      setFxDate(intelExchange.asOf || null);
      setFxSource(intelExchange.source?.trim() || "City intelligence");
      setFxError(null);
      setFxLoading(false);
      return;
    }

    if (!destCurrency) {
      setFxRate(null);
      setFxDate(null);
      setFxSource(null);
      setFxError(null);
      setFxLoading(false);
      return;
    }

    if (fromCurrency === destCurrency) {
      setFxRate(1);
      setFxDate(null);
      setFxSource(null);
      setFxError(null);
      setFxLoading(false);
      return;
    }

    let cancelled = false;
    setFxLoading(true);
    setFxError(null);

    void fetchFrankfurterRate(fromCurrency, destCurrency)
      .then((result) => {
        if (cancelled) return;
        setFxRate(result.rate);
        setFxDate(result.date);
        setFxSource("Frankfurter");
        setFxError(null);
        setFxLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setFxRate(null);
        setFxDate(null);
        setFxSource(null);
        setFxError(
          err instanceof Error ? err.message : "Could not load exchange rate."
        );
        setFxLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [intelExchange, fromCurrency, destCurrency]);

  const aiInsight = buildAiInsight(trip);

  const convertedAmount = useMemo(() => {
    if (fxRate == null || fxRate <= 0) return null;
    const raw = Number.parseFloat(convertAmount.replace(",", "."));
    if (!Number.isFinite(raw) || raw < 0) return null;
    const value =
      convertDirection === "home-to-local" ? raw * fxRate : raw / fxRate;
    return value;
  }, [convertAmount, convertDirection, fxRate]);

  const inputCurrency =
    convertDirection === "home-to-local" ? fromCurrency : destCurrency;
  const outputCurrency =
    convertDirection === "home-to-local" ? destCurrency : fromCurrency;

  function submitCustomItem() {
    const title = draft.trim();
    if (!title) return;
    const url = parseHttpUrl(draftLink);
    if (draftLink.trim() && !url) {
      setDraftLinkError("Enter a valid http(s) link.");
      return;
    }
    onAddItem(title, url);
    setDraft("");
    setDraftLink("");
    setDraftLinkError(null);
    setAdding(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            Before you go
          </h2>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            Take care of the essentials and prepare for a smooth and enjoyable
            trip.
          </p>
        </div>

        {progress.total > 0 ? (
          <div className="w-full shrink-0 sm:max-w-xs">
            <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
              <span>
                {progress.completed} of {progress.total} completed
              </span>
              <span className="font-semibold tabular-nums text-text">
                {progress.percent}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <section className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-tint text-primary">
                <ListChecks className="h-4 w-4" aria-hidden />
              </span>
              <h3 className="text-sm font-semibold text-text">Checklist</h3>
            </div>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-white px-3 text-sm font-medium text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add item
            </button>
          </div>

          <ul className="divide-y divide-divider">
            {items.map((item) => (
              <ChecklistRow
                key={item.id}
                item={item}
                onToggle={() => onToggleItem(item.id, !item.completed)}
                onDelete={
                  onDeleteItem && isCustomPreparationItem(item)
                    ? () => onDeleteItem(item.id)
                    : undefined
                }
              />
            ))}
          </ul>

          {adding ? (
            <form
              className="mt-4 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitCustomItem();
              }}
            >
              <label htmlFor={addInputId} className="sr-only">
                Custom checklist item
              </label>
              <TextInput
                id={addInputId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Custom item title…"
                autoFocus
              />
              <label htmlFor={addLinkInputId} className="sr-only">
                Optional link
              </label>
              <TextInput
                id={addLinkInputId}
                type="url"
                value={draftLink}
                onChange={(e) => {
                  setDraftLink(e.target.value);
                  if (draftLinkError) setDraftLinkError(null);
                }}
                placeholder="Optional link — https://…"
              />
              {draftLinkError ? (
                <p className="text-xs text-red-600">{draftLinkError}</p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" icon={Plus} color="primary" disabled={!draft.trim()}>
                  Add item
                </Button>
                <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-4 w-full"
              icon={Plus}
              color="primary"
            >
              Add custom item
            </Button>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <a
            href={KERBEZ_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative overflow-hidden rounded-2xl border border-primary/15 bg-primary-tint p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <p className="text-[10px] font-semibold tracking-[0.14em] text-primary/80 uppercase">
              Powered by KERBEZ
            </p>
            <p className="mt-2 text-base font-semibold text-text">
              Prepare your wardrobe
            </p>
            <p className="mt-1 max-w-[11.5rem] text-xs leading-relaxed text-text-secondary">
              Create outfits for your trip based on weather, activities and your
              personal style.
            </p>

            <div className="pointer-events-none absolute -right-2 bottom-3 h-28 w-28 sm:h-32 sm:w-32">
              <div className="relative h-full w-full overflow-hidden rounded-full border-4 border-white/80 bg-gradient-to-br from-violet-100 via-white to-fuchsia-50 shadow-sm">
                <span className="absolute top-4 left-5 flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary shadow-sm">
                  <Shirt className="h-4 w-4" aria-hidden />
                </span>
                <span className="absolute top-10 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white text-amber-600 shadow-sm">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="absolute bottom-5 left-1/2 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-white text-primary shadow-sm">
                  <Luggage className="h-5 w-5" aria-hidden />
                </span>
              </div>
            </div>

            <span className="mt-6 inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-sm transition-transform group-hover:translate-x-0.5">
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </a>

          {aiInsight ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary-tint px-4 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-primary shadow-sm">
                  <Sparkles className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary">AI Insight</p>
                  <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                    {aiInsight}
                  </p>
                </div>
              </div>

              {onViewGuide ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0 border-primary/25 bg-white text-primary hover:bg-white hover:text-primary-hover"
                  onClick={onViewGuide}
                >
                  View full guide
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </Button>
              ) : null}
            </section>
          ) : null}

          {destCurrency && fromCurrency ? (
            <section className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-tint text-primary">
                  <Coins className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text">
                    Money converter
                  </h3>
                  <p className="text-xs text-text-secondary">
                    {destLabel}
                    {destSymbol ? ` (${destSymbol})` : ""}
                  </p>
                </div>
              </div>

              {fxLoading ? (
                <p className="mt-3 inline-flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Loading rate…
                </p>
              ) : null}

              {fxError ? (
                <p className="mt-3 text-xs text-error">{fxError}</p>
              ) : null}

              {fxRate != null ? (
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-text-secondary">
                    1 {fromCurrency} ={" "}
                    <span className="font-semibold tabular-nums text-text">
                      {formatRate(fxRate)} {destCurrency}
                    </span>
                  </p>

                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label className="mb-1 block text-[11px] font-medium text-text-muted">
                        {inputCurrency}
                      </label>
                      <TextInput
                        type="text"
                        inputMode="decimal"
                        value={convertAmount}
                        onChange={(e) => setConvertAmount(e.target.value)}
                        placeholder="0"
                        className="tabular-nums"
                      />
                    </div>
                    <button
                      type="button"
                      aria-label="Swap currencies"
                      title="Swap currencies"
                      onClick={() =>
                        setConvertDirection((d) =>
                          d === "home-to-local"
                            ? "local-to-home"
                            : "home-to-local"
                        )
                      }
                      className="mb-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
                    >
                      <ArrowLeftRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>

                  <div className="rounded-xl bg-surface px-3 py-2.5">
                    <p className="text-[11px] font-medium text-text-muted">
                      {outputCurrency}
                    </p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-text">
                      {convertedAmount != null
                        ? formatConverted(convertedAmount)
                        : "—"}
                    </p>
                  </div>

                  {fxSource ? (
                    <p className="text-[11px] text-text-muted">
                      Rate from {fxSource}
                      {fxDate ? ` · ${fxDate.slice(0, 10)}` : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>

 

      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          icon={ArrowLeft}
          className="w-full shrink-0 sm:w-auto sm:min-w-[10rem]"
          onClick={onGoToDetails}
        >
          Trip details
        </Button>
        <Button
          type="button"
          size="lg"
          iconRight={ArrowRight}
          color="primary"
          className="w-full shrink-0 sm:ml-auto sm:w-auto sm:min-w-[14rem]"
          onClick={onGoToPlaces}
        >
          Continue to Places
        </Button>
      </div>
    </div>
  );
}

function ChecklistRow({
  item,
  onToggle,
  onDelete,
}: {
  item: PreparationItem;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  const Icon = CATEGORY_ICON[item.category] ?? ClipboardList;

  return (
    <li>
      <div className="flex w-full items-center gap-3 py-5 text-left transition-colors first:pt-1 last:pb-1 hover:bg-surface/60">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={item.completed}
          aria-label={item.title}
          className={cx(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            item.completed
              ? "border-primary bg-primary text-white"
              : "border-border bg-white text-transparent"
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </button>

        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            className="block w-full text-left"
          >
            <span
              className={cx(
                "block text-sm font-semibold",
                item.completed ? "text-text-secondary line-through" : "text-text"
              )}
            >
              {item.title}
            </span>
            {item.description ? (
              <span className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
                {item.description}
              </span>
            ) : null}
          </button>
          {item.link ? (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-primary/20 bg-primary-tint px-3 py-2 text-sm font-semibold text-primary shadow-sm hover:bg-primary/10"
            >
              <span className="truncate">
                {item.linkLabel?.trim() || "Open link"}
              </span>
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            </a>
          ) : null}
        </div>

        {onDelete ? (
          <button
            type="button"
            aria-label={`Remove ${item.title}`}
            onClick={onDelete}
            className="rounded-md p-1 text-text-muted hover:bg-surface hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function formatRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(0);
  if (rate >= 10) return rate.toFixed(1);
  if (rate >= 1) return rate.toFixed(2);
  return rate.toPrecision(3);
}

function formatConverted(amount: number): string {
  if (amount >= 1000) {
    return amount.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    });
  }
  if (amount >= 100) {
    return amount.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    });
  }
  return amount.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function buildAiInsight(trip: TripPlannerDoc): string | null {
  const results = trip.cityIntelligence.results ?? [];
  if (results.length === 0) return null;

  const destinations = listTripDestinations(trip);
  const fromCountryId = trip.from.countryId?.trim().toLowerCase();
  const fromCountryName = trip.from.countryName?.trim().toLowerCase();
  const allDomestic =
    destinations.length > 0 &&
    destinations.every((d) => {
      const destId = d.countryId?.trim().toLowerCase();
      if (fromCountryId && destId) return fromCountryId === destId;
      const destName = d.countryName?.trim().toLowerCase();
      return Boolean(fromCountryName && destName && fromCountryName === destName);
    });

  const cities = [
    ...new Set(destinations.map((d) => d.cityName).filter(Boolean)),
  ];
  const city = cities.join(", ") || destinations[0]?.cityName || "";
  const parts: string[] = [];

  for (const result of results) {
    const best = result.bestTimeToVisit?.summary;
    if (best) parts.push(best);
    if (!allDomestic) {
      const visa = result.visa?.description;
      if (visa) parts.push(visa);
    }
  }

  if (parts.length === 0) return null;

  const joined = parts.join(" ");
  if (cities.some((name) => joined.toLowerCase().includes(name.toLowerCase()))) {
    return joined;
  }
  return `For ${city}: ${joined}`;
}

function passportValidForTrip(
  expiryDate: string | undefined,
  startDate?: Date
): boolean {
  if (!expiryDate?.trim()) return true;
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return true;
  const need = startDate ? new Date(startDate) : new Date();
  need.setMonth(need.getMonth() + 6);
  return expiry >= need;
}

function localDocSignals(userId: string, startDate?: Date): LocalDocSignals {
  const docs = listTravelDocuments(userId);
  const passports = docs.filter((doc) => doc.kind === "passport");
  const ids = docs.filter((doc) => doc.kind === "id");
  return {
    hasPassport: passports.length > 0,
    passportValidForTrip:
      passports.length === 0
        ? true
        : passports.some((doc) =>
            passportValidForTrip(doc.data.expiryDate, startDate)
          ),
    hasId: ids.length > 0,
  };
}
