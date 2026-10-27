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
  Trash2,
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
import { useI18n } from "@/i18n";
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

const CATEGORY_ACCENT: Record<PreparationCategory, string> = {
  documents: "bg-primary-tint text-primary",
  booking: "bg-[#EEF4FF] text-[#3B5BDB]",
  transport: "bg-[#ECFDF5] text-[#047857]",
  health: "bg-[#FFF4E8] text-[#C2410C]",
  money: "bg-[#FEF9C3] text-[#A16207]",
  packing: "bg-[#FDF2F8] text-[#BE185D]",
  other: "bg-surface text-text-secondary",
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
  const { t } = useI18n();
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
    () =>
      intelExchange?.source?.trim() ||
      (intelExchange ? "City intelligence" : null)
  );
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);
  const [convertAmount, setConvertAmount] = useState("100");
  const [convertDirection, setConvertDirection] = useState<
    "home-to-local" | "local-to-home"
  >("home-to-local");

  useEffect(() => {
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
          err instanceof Error ? err.message : t("planner.beforeYouGo.fxError")
        );
        setFxLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [intelExchange, fromCurrency, destCurrency, t]);

  const aiInsight = buildAiInsight(trip, t);

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

  function resetAddForm() {
    setDraft("");
    setDraftLink("");
    setDraftLinkError(null);
    setAdding(false);
  }

  function submitCustomItem() {
    const title = draft.trim();
    if (!title) return;
    const url = parseHttpUrl(draftLink);
    if (draftLink.trim() && !url) {
      setDraftLinkError(t("planner.beforeYouGo.invalidLink"));
      return;
    }
    onAddItem(title, url);
    resetAddForm();
  }

  const remaining = Math.max(0, progress.total - progress.completed);
  const allDone = progress.total > 0 && progress.percent === 100;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {t("planner.beforeYouGo.title")}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            {t("planner.beforeYouGo.subtitle")}
          </p>
        </div>
        {!adding ? (
          <Button
            type="button"
            color="primary"
            icon={Plus}
            className="shrink-0 self-start sm:self-auto"
            onClick={() => setAdding(true)}
          >
            {t("planner.beforeYouGo.addItem")}
          </Button>
        ) : null}
      </div>

      <section className="relative overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-br from-primary-tint via-surface-elevated to-surface p-5 shadow-sm sm:p-6">
        <div
          className="pointer-events-none absolute -top-16 -right-10 h-44 w-44 rounded-full bg-primary/10 blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-primary-light/10 blur-3xl"
          aria-hidden
        />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-primary uppercase shadow-sm ring-1 ring-primary/10">
                <ListChecks className="h-3.5 w-3.5" aria-hidden />
                {t("planner.beforeYouGo.progressLabel")}
              </span>
              {allDone ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-background px-2.5 py-1 text-[11px] font-semibold text-success ring-1 ring-success/15">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                  {t("planner.beforeYouGo.allSet")}
                </span>
              ) : null}
            </div>

            <p className="mt-3 text-3xl font-semibold tracking-tight text-text tabular-nums sm:text-4xl">
              {progress.total > 0 ? `${progress.percent}%` : "—"}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {progress.total > 0
                ? t("planner.beforeYouGo.progressDone", {
                    completed: progress.completed,
                    total: progress.total,
                  })
                : t("planner.beforeYouGo.progressEmpty")}
            </p>
          </div>

          {progress.total > 0 ? (
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:min-w-[14rem]">
              <StatChip
                label={t("planner.beforeYouGo.statDone")}
                value={String(progress.completed)}
                tone="done"
              />
              <StatChip
                label={t("planner.beforeYouGo.statLeft")}
                value={String(remaining)}
                tone="left"
              />
            </div>
          ) : null}
        </div>

        {progress.total > 0 ? (
          <div className="relative mt-5">
            <div className="h-2.5 overflow-hidden rounded-full bg-white/70 ring-1 ring-border/60">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <section className="flex flex-col rounded-3xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-tint text-primary">
                <ClipboardList className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-text">
                    {t("planner.beforeYouGo.checklist")}
                  </h3>
                  {progress.total > 0 ? (
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-secondary ring-1 ring-border">
                      {progress.completed}/{progress.total}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-white px-3 text-sm font-medium text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("planner.beforeYouGo.addItem")}
            </button>
          </div>

          {items.length > 0 ? (
            <ul className="space-y-1.5">
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
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/70 px-4 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-tint text-primary">
                <ListChecks className="h-5 w-5" aria-hidden />
              </span>
              <p className="mt-3 max-w-[18rem] text-sm leading-relaxed text-text-secondary">
                {t("planner.beforeYouGo.emptyChecklist")}
              </p>
            </div>
          )}

          {adding ? (
            <form
              className="mt-4 space-y-3 rounded-2xl border border-primary/15 bg-primary-tint/40 p-3.5 sm:p-4"
              onSubmit={(e) => {
                e.preventDefault();
                submitCustomItem();
              }}
            >
              <div>
                <label
                  htmlFor={addInputId}
                  className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-muted uppercase"
                >
                  {t("planner.beforeYouGo.customItemLabel")}
                </label>
                <TextInput
                  id={addInputId}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("planner.beforeYouGo.customTitlePlaceholder")}
                  autoFocus
                />
              </div>
              <div>
                <label
                  htmlFor={addLinkInputId}
                  className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-muted uppercase"
                >
                  {t("planner.beforeYouGo.optionalLinkLabel")}
                </label>
                <TextInput
                  id={addLinkInputId}
                  type="url"
                  value={draftLink}
                  onChange={(e) => {
                    setDraftLink(e.target.value);
                    if (draftLinkError) setDraftLinkError(null);
                  }}
                  placeholder={t("planner.beforeYouGo.linkPlaceholder")}
                />
              </div>
              {draftLinkError ? (
                <p className="rounded-xl bg-error-background px-3 py-2 text-xs text-error">
                  {draftLinkError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="submit"
                  icon={Plus}
                  color="primary"
                  disabled={!draft.trim()}
                >
                  {t("planner.beforeYouGo.addItem")}
                </Button>
                <Button type="button" variant="secondary" onClick={resetAddForm}>
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-4 w-full"
              icon={Plus}
              variant="secondary"
            >
              {t("planner.beforeYouGo.addCustom")}
            </Button>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <a
            href={KERBEZ_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary-tint via-white to-surface p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div
              className="pointer-events-none absolute -top-10 -right-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl"
              aria-hidden
            />
            <p className="relative text-[10px] font-semibold tracking-[0.14em] text-primary/80 uppercase">
              {t("planner.beforeYouGo.kerbezEyebrow")}
            </p>
            <p className="relative mt-2 text-base font-semibold text-text">
              {t("planner.beforeYouGo.kerbezTitle")}
            </p>
            <p className="relative mt-1 max-w-[12rem] text-xs leading-relaxed text-text-secondary">
              {t("planner.beforeYouGo.kerbezBody")}
            </p>

            <div className="pointer-events-none absolute -right-1 bottom-2 h-28 w-28 sm:h-32 sm:w-32">
              <div className="relative h-full w-full overflow-hidden rounded-full border-4 border-white/80 bg-gradient-to-br from-primary-tint via-white to-surface shadow-sm">
                <span className="absolute top-4 left-5 flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary shadow-sm">
                  <Shirt className="h-4 w-4" aria-hidden />
                </span>
                <span className="absolute top-10 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white text-amber-700 shadow-sm">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="absolute bottom-5 left-1/2 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-white text-primary shadow-sm">
                  <Luggage className="h-5 w-5" aria-hidden />
                </span>
              </div>
            </div>

            <span className="relative mt-8 inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-sm transition-transform duration-300 group-hover:translate-x-0.5">
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </a>

          {aiInsight ? (
            <section className="flex flex-col gap-3 rounded-3xl border border-primary/15 bg-primary-tint/70 p-4 shadow-sm">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-primary shadow-sm ring-1 ring-primary/10">
                  <Sparkles className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary">
                    {t("planner.beforeYouGo.aiInsight")}
                  </p>
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
                  {t("planner.beforeYouGo.viewGuide")}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </Button>
              ) : null}
            </section>
          ) : null}

          {destCurrency && fromCurrency ? (
            <section className="rounded-3xl border border-border bg-surface-elevated p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-tint text-primary">
                  <Coins className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text">
                    {t("planner.beforeYouGo.moneyTitle")}
                  </h3>
                  <p className="text-xs text-text-secondary">
                    {t("planner.beforeYouGo.moneySubtitle", {
                      label: `${destLabel}${destSymbol ? ` (${destSymbol})` : ""}`,
                    })}
                  </p>
                </div>
              </div>

              {fxLoading ? (
                <p className="mt-3 inline-flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {t("planner.beforeYouGo.moneyLoading")}
                </p>
              ) : null}

              {fxError ? (
                <p className="mt-3 rounded-xl bg-error-background px-3 py-2 text-xs text-error">
                  {fxError}
                </p>
              ) : null}

              {fxRate != null ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl bg-surface px-3 py-2.5 ring-1 ring-border/70">
                    <p className="text-xs text-text-secondary">
                      {t("planner.beforeYouGo.moneyRate", {
                        from: fromCurrency,
                        rate: formatRate(fxRate),
                        to: destCurrency,
                      })}
                    </p>
                  </div>

                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-muted uppercase">
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
                      aria-label={t("planner.beforeYouGo.moneySwap")}
                      title={t("planner.beforeYouGo.moneySwap")}
                      onClick={() =>
                        setConvertDirection((d) =>
                          d === "home-to-local"
                            ? "local-to-home"
                            : "home-to-local"
                        )
                      }
                      className="mb-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-text-secondary transition-all hover:border-primary/30 hover:bg-primary-tint hover:text-primary active:scale-95"
                    >
                      <ArrowLeftRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>

                  <div className="rounded-2xl bg-gradient-to-br from-primary-tint/80 to-surface px-3.5 py-3 ring-1 ring-primary/10">
                    <p className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                      {outputCurrency}
                    </p>
                    <p className="mt-0.5 text-xl font-semibold tabular-nums text-text">
                      {convertedAmount != null
                        ? formatConverted(convertedAmount)
                        : "—"}
                    </p>
                  </div>

                  {fxSource ? (
                    <p className="text-[11px] text-text-muted">
                      {t("planner.beforeYouGo.moneyRateFrom", {
                        source: fxSource,
                      })}
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
          {t("planner.beforeYouGo.tripDetails")}
        </Button>
        <Button
          type="button"
          size="lg"
          iconRight={ArrowRight}
          color="primary"
          className="w-full shrink-0 sm:ml-auto sm:w-auto sm:min-w-[14rem]"
          onClick={onGoToPlaces}
        >
          {t("planner.beforeYouGo.continuePlaces")}
        </Button>
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "done" | "left";
}) {
  return (
    <div
      className={cx(
        "rounded-2xl px-3 py-2.5 shadow-sm ring-1 backdrop-blur-sm",
        tone === "done"
          ? "bg-white/90 ring-success/15"
          : "bg-white/75 ring-border/70"
      )}
    >
      <p className="text-[10px] font-semibold tracking-wide text-text-muted uppercase">
        {label}
      </p>
      <p
        className={cx(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "done" ? "text-success" : "text-text"
        )}
      >
        {value}
      </p>
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
  const { t } = useI18n();
  const Icon = CATEGORY_ICON[item.category] ?? ClipboardList;

  return (
    <li>
      <div
        className={cx(
          "group flex w-full items-start gap-3 rounded-2xl px-2.5 py-3 text-left transition-colors",
          item.completed ? "bg-surface/50" : "hover:bg-surface"
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={item.completed}
          aria-label={item.title}
          className={cx(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all",
            item.completed
              ? "border-primary bg-primary text-white shadow-sm"
              : "border-border bg-white text-transparent hover:border-primary/40"
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </button>

        <span
          className={cx(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105",
            CATEGORY_ACCENT[item.category] ?? CATEGORY_ACCENT.other
          )}
        >
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
                "block text-sm font-semibold transition-colors",
                item.completed
                  ? "text-text-secondary line-through"
                  : "text-text"
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
              className="mt-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-primary/20 bg-primary-tint px-3 py-2 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-primary/10"
            >
              <span className="truncate">
                {item.linkLabel?.trim() || t("planner.beforeYouGo.openLink")}
              </span>
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            </a>
          ) : null}
        </div>

        {onDelete ? (
          <button
            type="button"
            aria-label={t("planner.beforeYouGo.removeItem", {
              title: item.title,
            })}
            onClick={onDelete}
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-text-muted opacity-60 transition-all hover:bg-error-background hover:text-error hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
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

function buildAiInsight(
  trip: TripPlannerDoc,
  t: (key: string, params?: Record<string, string | number>) => string
): string | null {
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
      return Boolean(
        fromCountryName && destName && fromCountryName === destName
      );
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
  return t("planner.beforeYouGo.forCity", { city, joined });
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
