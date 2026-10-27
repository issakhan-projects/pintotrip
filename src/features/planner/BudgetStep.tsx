"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  BedDouble,
  Bus,
  CircleDollarSign,
  Loader2,
  MapPin,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { SavedLocation } from "@/hooks/useLocations";
import {
  BUDGET_CATEGORIES,
  type BudgetCategory,
  type TripBudget,
  type TripBudgetItem,
  type TripPlannerDoc,
  type TripRoute,
} from "@/types/trip-planner";
import { Button, SearchableSelect, TextInput } from "@/components/ui";
import type { SearchableSelectOption } from "@/components/ui";
import { fetchFrankfurterRate } from "@/lib/currency";
import { CURRENCY_OPTIONS, resolveCurrencyCode } from "@/lib/currencies";
import { cx } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { listTripAccommodations } from "./essentialsHelpers";
import { currencySymbolForCode } from "./tripUtils";
import {
  convertBudgetAmount,
  customBudgetLines,
  formatApproxMoney,
  formatDualBudgetMoney,
  listEstimatedBudgetLines,
  newCustomBudgetItemId,
  parseBudgetAmount,
  sumBudgetByCategory,
  sumBudgetInCurrency,
  type BudgetLineItem,
  type BudgetRateLookup,
} from "./tripBudget";

const CATEGORY_ICON: Record<BudgetCategory, LucideIcon> = {
  accommodation: BedDouble,
  transport: Bus,
  food: Utensils,
  activities: MapPin,
  shopping: ShoppingBag,
  other: Wallet,
};

const CATEGORY_ACCENT: Record<BudgetCategory, string> = {
  accommodation: "bg-primary-tint text-primary",
  transport: "bg-[#EEF4FF] text-[#3B5BDB]",
  food: "bg-[#FFF4E8] text-[#C2410C]",
  activities: "bg-[#ECFDF5] text-[#047857]",
  shopping: "bg-[#FDF2F8] text-[#BE185D]",
  other: "bg-surface text-text-secondary",
};

const CATEGORY_BAR: Record<BudgetCategory, string> = {
  accommodation: "bg-primary",
  transport: "bg-[#5C7CFA]",
  food: "bg-[#F97316]",
  activities: "bg-[#10B981]",
  shopping: "bg-[#EC4899]",
  other: "bg-text-muted",
};

interface BudgetStepProps {
  trip: TripPlannerDoc;
  locations: SavedLocation[];
  routes: TripRoute[];
  /** User's preferred home currency (ISO 4217). */
  homeCurrency?: string;
  onSaveBudget: (budget: TripBudget) => Promise<void> | void;
}

export function BudgetStep({
  trip,
  locations,
  routes,
  homeCurrency,
  onSaveBudget,
}: BudgetStepProps) {
  const { t } = useI18n();
  const titleId = useId();
  const amountId = useId();

  const customItems = trip.budget?.items ?? [];

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

  const destCurrency =
    resolveCurrencyCode(
      intelExchange?.to ||
        trip.currency?.code ||
        trip.currency?.name ||
        trip.cityIntelligence.results?.[0]?.details?.dailyBudget?.currency ||
        ""
    ) || "USD";
  const userCurrency =
    resolveCurrencyCode(
      homeCurrency ||
        intelExchange?.from ||
        trip.cityIntelligence.results?.[0]?.exchangeRate?.from ||
        trip.currency?.code ||
        "USD"
    ) || destCurrency;

  const [currency, setCurrency] = useState(destCurrency);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<BudgetCategory>("other");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [rateMap, setRateMap] = useState<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (intelExchange) {
      const from = resolveCurrencyCode(intelExchange.from);
      const to = resolveCurrencyCode(intelExchange.to);
      if (from && to) {
        map.set(`${from}:${to}`, intelExchange.rate);
        map.set(`${to}:${from}`, 1 / intelExchange.rate);
      }
    }
    return map;
  });
  const [fxLoading, setFxLoading] = useState(false);

  const byId = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations]
  );
  const accommodations = useMemo(
    () => listTripAccommodations(trip),
    [trip]
  );

  const estimatedLines = useMemo(
    () =>
      listEstimatedBudgetLines(
        trip.itinerary.days,
        byId,
        routes,
        accommodations
      ),
    [trip.itinerary.days, byId, routes, accommodations]
  );
  const customLines = useMemo(
    () => customBudgetLines(customItems),
    [customItems]
  );
  const allLines = useMemo(
    () => [...estimatedLines, ...customLines],
    [estimatedLines, customLines]
  );

  const lineCurrencies = useMemo(() => {
    const codes = new Set<string>();
    for (const line of allLines) {
      const code = line.currency.trim().toUpperCase();
      if (code) codes.add(code);
    }
    codes.add(destCurrency);
    codes.add(userCurrency);
    return [...codes];
  }, [allLines, destCurrency, userCurrency]);

  useEffect(() => {
    setCurrency((prev) => {
      const next = resolveCurrencyCode(prev) || destCurrency;
      return next || destCurrency;
    });
  }, [destCurrency]);

  useEffect(() => {
    let cancelled = false;

    const pairs: Array<[string, string]> = [];
    const pushPair = (from: string, to: string) => {
      if (!from || !to || from === to) return;
      pairs.push([from, to]);
    };

    pushPair(userCurrency, destCurrency);
    for (const code of lineCurrencies) {
      pushPair(code, destCurrency);
      pushPair(code, userCurrency);
    }

    const needed = pairs.filter(([from, to]) => {
      const key = `${from}:${to}`;
      const inv = `${to}:${from}`;
      return !rateMap.has(key) && !rateMap.has(inv);
    });

    if (intelExchange) {
      const from = resolveCurrencyCode(intelExchange.from);
      const to = resolveCurrencyCode(intelExchange.to);
      if (from && to) {
        setRateMap((prev) => {
          if (prev.has(`${from}:${to}`)) return prev;
          const next = new Map(prev);
          next.set(`${from}:${to}`, intelExchange.rate);
          next.set(`${to}:${from}`, 1 / intelExchange.rate);
          return next;
        });
      }
    }

    if (needed.length === 0) {
      setFxLoading(false);
      return;
    }

    setFxLoading(true);
    void Promise.all(
      needed.map(async ([from, to]) => {
        try {
          const result = await fetchFrankfurterRate(from, to);
          return {
            from: result.base,
            to: result.quote,
            rate: result.rate,
          };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setRateMap((prev) => {
        const next = new Map(prev);
        for (const row of results) {
          if (!row) continue;
          next.set(`${row.from}:${row.to}`, row.rate);
          next.set(`${row.to}:${row.from}`, 1 / row.rate);
        }
        return next;
      });
      setFxLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed + fetch missing FX pairs
  }, [destCurrency, userCurrency, lineCurrencies, intelExchange]);

  const getRate: BudgetRateLookup = (from, to) => {
    const a = from.trim().toUpperCase();
    const b = to.trim().toUpperCase();
    if (!a || !b) return null;
    if (a === b) return 1;
    return rateMap.get(`${a}:${b}`) ?? null;
  };

  const dualCurrencies = destCurrency !== userCurrency;
  const totalDest = useMemo(
    () => sumBudgetInCurrency(allLines, destCurrency, getRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getRate closes over rateMap
    [allLines, destCurrency, rateMap]
  );
  const totalUser = useMemo(
    () => sumBudgetInCurrency(allLines, userCurrency, getRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getRate closes over rateMap
    [allLines, userCurrency, rateMap]
  );
  const estimatedDest = useMemo(
    () => sumBudgetInCurrency(estimatedLines, destCurrency, getRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getRate closes over rateMap
    [estimatedLines, destCurrency, rateMap]
  );
  const estimatedUser = useMemo(
    () => sumBudgetInCurrency(estimatedLines, userCurrency, getRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getRate closes over rateMap
    [estimatedLines, userCurrency, rateMap]
  );
  const customDest = useMemo(
    () => sumBudgetInCurrency(customLines, destCurrency, getRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getRate closes over rateMap
    [customLines, destCurrency, rateMap]
  );
  const customUser = useMemo(
    () => sumBudgetInCurrency(customLines, userCurrency, getRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getRate closes over rateMap
    [customLines, userCurrency, rateMap]
  );
  const byCategory = useMemo(
    () => sumBudgetByCategory(allLines),
    [allLines]
  );

  const categoryShares = useMemo(() => {
    if (totalDest == null || totalDest <= 0) return [];
    return byCategory
      .map((row) => {
        const categoryLines = allLines.filter(
          (line) => line.category === row.category
        );
        const amount =
          sumBudgetInCurrency(categoryLines, destCurrency, getRate) ?? 0;
        return {
          category: row.category,
          amount,
          percent: Math.max(0, Math.round((amount / totalDest) * 1000) / 10),
          dual: formatDualTotals(
            amount,
            destCurrency,
            sumBudgetInCurrency(categoryLines, userCurrency, getRate),
            userCurrency,
            dualCurrencies
          ),
        };
      })
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getRate closes over rateMap
  }, [allLines, byCategory, destCurrency, userCurrency, dualCurrencies, rateMap, totalDest]);

  const categoryOptions: SearchableSelectOption[] = useMemo(
    () =>
      BUDGET_CATEGORIES.map((id) => ({
        value: id,
        label: t(`planner.budget.category.${id}`),
        icon: CATEGORY_ICON[id],
      })),
    [t]
  );

  const currencyOptions: SearchableSelectOption[] = useMemo(() => {
    const preferred = [destCurrency, userCurrency].filter(
      (code, index, arr) => Boolean(code) && arr.indexOf(code) === index
    );
    const preferredSet = new Set(preferred);
    const preferredOpts = preferred.map((code) => {
      const meta = CURRENCY_OPTIONS.find((c) => c.code === code);
      const symbol = currencySymbolForCode(code);
      const name = meta?.name || code;
      const role =
        code === destCurrency && code === userCurrency
          ? t("planner.budget.currencyBoth")
          : code === destCurrency
            ? t("planner.budget.currencyDestination")
            : t("planner.budget.currencyUser");
      return {
        value: code,
        label: `${code} — ${name} (${symbol})`,
        description: role,
      };
    });
    const rest = CURRENCY_OPTIONS.filter((c) => !preferredSet.has(c.code)).map(
      (c) => {
        const symbol = currencySymbolForCode(c.code);
        return {
          value: c.code,
          label: `${c.code} — ${c.name} (${symbol})`,
          description: c.name,
        };
      }
    );
    return [...preferredOpts, ...rest];
  }, [destCurrency, userCurrency, t]);

  function resetForm() {
    setTitle("");
    setAmount("");
    setCategory("other");
    setCurrency(destCurrency);
    setFormError(null);
    setAdding(false);
  }

  async function persist(items: TripBudgetItem[]) {
    setSaving(true);
    try {
      await onSaveBudget({ items });
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd() {
    const trimmed = title.trim();
    const parsed = parseBudgetAmount(amount);
    const code = resolveCurrencyCode(currency) || destCurrency;
    if (!trimmed) {
      setFormError(t("planner.budget.errorTitle"));
      return;
    }
    if (parsed == null) {
      setFormError(t("planner.budget.errorAmount"));
      return;
    }
    if (!code) {
      setFormError(t("planner.budget.errorCurrency"));
      return;
    }
    const maxOrder = customItems.reduce(
      (max, item) => Math.max(max, item.order),
      -1
    );
    const next: TripBudgetItem = {
      id: newCustomBudgetItemId(),
      title: trimmed,
      amount: parsed,
      currency: code,
      category,
      order: maxOrder + 1,
    };
    await persist([...customItems, next]);
    resetForm();
  }

  async function handleDelete(itemId: string) {
    await persist(customItems.filter((item) => item.id !== itemId));
  }

  const hasAny = allLines.length > 0;
  const totalDual = formatDualTotals(
    totalDest,
    destCurrency,
    totalUser,
    userCurrency,
    dualCurrencies
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {t("planner.budget.title")}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            {t("planner.budget.subtitle")}
          </p>
        </div>
        {!adding ? (
          <Button
            type="button"
            color="primary"
            icon={Plus}
            className="shrink-0 self-start sm:self-auto"
            onClick={() => {
              setCurrency(destCurrency);
              setAdding(true);
            }}
          >
            {t("planner.budget.add")}
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

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-primary uppercase shadow-sm ring-1 ring-primary/10">
                <Wallet className="h-3.5 w-3.5" aria-hidden />
                {t("planner.budget.totalLabel")}
              </span>
              {dualCurrencies ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-text-secondary ring-1 ring-border/80">
                  {destCurrency}
                  <ArrowLeftRight className="h-3 w-3 text-text-muted" aria-hidden />
                  {userCurrency}
                </span>
              ) : (
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-text-secondary ring-1 ring-border/80">
                  {destCurrency}
                </span>
              )}
              {fxLoading ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  {t("planner.budget.fxLoading")}
                </span>
              ) : null}
            </div>

            <p className="mt-3 text-3xl font-semibold tracking-tight text-text tabular-nums sm:text-4xl">
              {hasAny && totalDual.primary ? totalDual.primary : "—"}
            </p>
            {hasAny && totalDual.secondary ? (
              <p className="mt-1 text-base font-medium tabular-nums text-text-secondary">
                {totalDual.secondary}
              </p>
            ) : null}
            <p className="mt-2 max-w-md text-xs leading-relaxed text-text-secondary">
              {dualCurrencies
                ? t("planner.budget.totalHintDual", {
                    destination: destCurrency,
                    user: userCurrency,
                  })
                : t("planner.budget.totalHint")}
            </p>
          </div>

          {hasAny ? (
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:min-w-[17rem]">
              <SummaryChip
                label={t("planner.budget.estimatedTitle")}
                dual={formatDualTotals(
                  estimatedDest,
                  destCurrency,
                  estimatedUser,
                  userCurrency,
                  dualCurrencies,
                  true
                )}
                count={estimatedLines.length}
                tone="estimate"
              />
              <SummaryChip
                label={t("planner.budget.customTitle")}
                dual={formatDualTotals(
                  customDest,
                  destCurrency,
                  customUser,
                  userCurrency,
                  dualCurrencies
                )}
                count={customLines.length}
                tone="custom"
              />
            </div>
          ) : null}
        </div>

        {categoryShares.length > 0 ? (
          <div className="relative mt-6 space-y-3">
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/70 ring-1 ring-border/60"
              role="img"
              aria-label={categoryShares
                .map(
                  (row) =>
                    `${t(`planner.budget.category.${row.category}`)} ${row.percent}%`
                )
                .join(", ")}
            >
              {categoryShares.map((row) => (
                <div
                  key={row.category}
                  className={cx(
                    "h-full min-w-[4px] transition-all duration-500",
                    CATEGORY_BAR[row.category]
                  )}
                  style={{ flexGrow: Math.max(row.percent, 0.5), flexBasis: 0 }}
                  title={`${t(`planner.budget.category.${row.category}`)} · ${row.percent}%`}
                />
              ))}
            </div>

            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {categoryShares.map((row) => {
                const Icon = CATEGORY_ICON[row.category];
                return (
                  <li
                    key={row.category}
                    className="flex items-center gap-2.5 rounded-2xl bg-white/75 px-3 py-2.5 shadow-sm ring-1 ring-border/70 backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5"
                  >
                    <span
                      className={cx(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        CATEGORY_ACCENT[row.category]
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-text">
                        {t(`planner.budget.category.${row.category}`)}
                      </p>
                      <p className="text-[10px] text-text-muted">
                        {row.percent}%
                      </p>
                    </div>
                    <DualAmount
                      dual={row.dual}
                      className="shrink-0 text-right"
                      primaryClassName="text-xs font-semibold tabular-nums text-text"
                      secondaryClassName="text-[10px] tabular-nums text-text-muted"
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <BudgetLinesSection
          title={t("planner.budget.estimatedTitle")}
          subtitle={t("planner.budget.estimatedSubtitle")}
          lines={estimatedLines}
          total={formatDualTotals(
            estimatedDest,
            destCurrency,
            estimatedUser,
            userCurrency,
            dualCurrencies,
            true
          )}
          empty={t("planner.budget.estimatedEmpty")}
          destCurrency={destCurrency}
          userCurrency={userCurrency}
          getRate={getRate}
          estimated
          badge={
            estimatedLines.length > 0
              ? t(
                  estimatedLines.length === 1
                    ? "planner.budget.items_one"
                    : "planner.budget.items_other",
                  { count: estimatedLines.length }
                )
              : null
          }
        />

        <section className="flex flex-col rounded-3xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-tint text-primary">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-text">
                    {t("planner.budget.customTitle")}
                  </h3>
                  {customLines.length > 0 ? (
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-secondary ring-1 ring-border">
                      {t(
                        customLines.length === 1
                          ? "planner.budget.items_one"
                          : "planner.budget.items_other",
                        { count: customLines.length }
                      )}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {t("planner.budget.customSubtitle")}
                </p>
              </div>
            </div>
            {customLines.length > 0 ? (
              <DualAmount
                dual={formatDualTotals(
                  customDest,
                  destCurrency,
                  customUser,
                  userCurrency,
                  dualCurrencies
                )}
                className="text-right"
                primaryClassName="text-sm font-semibold tabular-nums text-text"
                secondaryClassName="text-[11px] tabular-nums text-text-muted"
              />
            ) : null}
          </div>

          {customLines.length > 0 ? (
            <ul className="mt-4 flex-1 space-y-1.5">
              {customLines.map((line) => (
                <BudgetLineRow
                  key={line.id}
                  line={line}
                  destCurrency={destCurrency}
                  userCurrency={userCurrency}
                  getRate={getRate}
                  onDelete={() => void handleDelete(line.id)}
                  deleteLabel={t("planner.budget.delete")}
                  deleting={saving}
                />
              ))}
            </ul>
          ) : (
            <EmptyState message={t("planner.budget.customEmpty")} />
          )}

          {adding ? (
            <form
              className="mt-4 space-y-3 rounded-2xl border border-primary/15 bg-primary-tint/40 p-3.5 sm:p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleAdd();
              }}
            >
              <div>
                <label
                  htmlFor={titleId}
                  className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-muted uppercase"
                >
                  {t("planner.budget.fieldTitle")}
                </label>
                <TextInput
                  id={titleId}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("planner.budget.titlePlaceholder")}
                  autoFocus
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={amountId}
                    className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-muted uppercase"
                  >
                    {t("planner.budget.fieldAmountLabel")}
                  </label>
                  <TextInput
                    id={amountId}
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="tabular-nums"
                  />
                </div>
                <div>
                  <p className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                    {t("planner.budget.fieldCurrency")}
                  </p>
                  <SearchableSelect
                    value={currency}
                    onChange={setCurrency}
                    options={currencyOptions}
                    placeholder={t("planner.budget.fieldCurrency")}
                    clearable={false}
                  />
                </div>
              </div>
              <div>
                <p className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("planner.budget.fieldCategory")}
                </p>
                <SearchableSelect
                  value={category}
                  onChange={(value) =>
                    setCategory((value as BudgetCategory) || "other")
                  }
                  options={categoryOptions}
                  placeholder={t("planner.budget.fieldCategory")}
                  searchable={false}
                  clearable={false}
                />
              </div>
              {formError ? (
                <p className="rounded-xl bg-error-background px-3 py-2 text-xs text-error">
                  {formError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="submit"
                  color="primary"
                  icon={Plus}
                  disabled={saving}
                  loading={saving}
                >
                  {t("planner.budget.save")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={resetForm}
                >
                  {t("planner.budget.cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="secondary"
              icon={Plus}
              className="mt-4 w-full"
              onClick={() => {
                setCurrency(destCurrency);
                setAdding(true);
              }}
            >
              {t("planner.budget.add")}
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  dual,
  count,
  tone,
}: {
  label: string;
  dual: { primary: string; secondary: string | null };
  count: number;
  tone: "estimate" | "custom";
}) {
  return (
    <div
      className={cx(
        "rounded-2xl px-3 py-2.5 shadow-sm ring-1 backdrop-blur-sm",
        tone === "estimate"
          ? "bg-white/75 ring-border/70"
          : "bg-white/90 ring-primary/15"
      )}
    >
      <p className="text-[10px] font-semibold tracking-wide text-text-muted uppercase">
        {label}
        {count > 0 ? (
          <span className="ml-1 font-medium normal-case text-text-secondary">
            · {count}
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-text">
        {dual.primary || "—"}
      </p>
      {dual.secondary ? (
        <p className="text-[10px] tabular-nums text-text-muted">
          {dual.secondary}
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/70 px-4 py-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-tint text-primary">
        <Wallet className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-3 max-w-[16rem] text-sm leading-relaxed text-text-secondary">
        {message}
      </p>
    </div>
  );
}

function formatDualTotals(
  destAmount: number | null,
  destCurrency: string,
  userAmount: number | null,
  userCurrency: string,
  dual: boolean,
  approximate = false
): { primary: string; secondary: string | null } {
  const prefix = approximate ? "≈ " : "";
  if (destAmount == null && userAmount == null) {
    return { primary: "", secondary: null };
  }
  if (!dual || destCurrency === userCurrency) {
    const amount = destAmount ?? userAmount;
    const code = destAmount != null ? destCurrency : userCurrency;
    if (amount == null) return { primary: "", secondary: null };
    return {
      primary: `${prefix}${formatApproxMoney(amount, code)}`,
      secondary: null,
    };
  }
  const primary =
    destAmount != null
      ? `${prefix}${formatApproxMoney(destAmount, destCurrency)}`
      : "";
  const secondary =
    userAmount != null
      ? `≈ ${formatApproxMoney(userAmount, userCurrency)}`
      : null;
  return { primary, secondary };
}

function DualAmount({
  dual,
  className,
  primaryClassName,
  secondaryClassName,
}: {
  dual: { primary: string; secondary: string | null };
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
}) {
  if (!dual.primary) return null;
  return (
    <div className={className}>
      <p className={primaryClassName}>{dual.primary}</p>
      {dual.secondary ? (
        <p className={secondaryClassName}>{dual.secondary}</p>
      ) : null}
    </div>
  );
}

function BudgetLinesSection({
  title,
  subtitle,
  lines,
  total,
  empty,
  destCurrency,
  userCurrency,
  getRate,
  estimated,
  badge,
}: {
  title: string;
  subtitle: string;
  lines: BudgetLineItem[];
  total: { primary: string; secondary: string | null };
  empty: string;
  destCurrency: string;
  userCurrency: string;
  getRate: BudgetRateLookup;
  estimated?: boolean;
  badge?: string | null;
}) {
  return (
    <section className="flex flex-col rounded-3xl border border-border bg-surface-elevated p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface text-primary ring-1 ring-border">
            <CircleDollarSign className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text">{title}</h3>
              {badge ? (
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-secondary ring-1 ring-border">
                  {badge}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p>
          </div>
        </div>
        {lines.length > 0 ? (
          <DualAmount
            dual={total}
            className="text-right"
            primaryClassName="text-sm font-semibold tabular-nums text-text"
            secondaryClassName="text-[11px] tabular-nums text-text-muted"
          />
        ) : null}
      </div>

      {lines.length > 0 ? (
        <ul className="mt-4 flex-1 space-y-1.5">
          {lines.map((line) => (
            <BudgetLineRow
              key={line.id}
              line={line}
              destCurrency={destCurrency}
              userCurrency={userCurrency}
              getRate={getRate}
              estimated={estimated}
            />
          ))}
        </ul>
      ) : (
        <EmptyState message={empty} />
      )}
    </section>
  );
}

function BudgetLineRow({
  line,
  destCurrency,
  userCurrency,
  getRate,
  estimated,
  onDelete,
  deleteLabel,
  deleting,
}: {
  line: BudgetLineItem;
  destCurrency: string;
  userCurrency: string;
  getRate: BudgetRateLookup;
  estimated?: boolean;
  onDelete?: () => void;
  deleteLabel?: string;
  deleting?: boolean;
}) {
  const { t } = useI18n();
  const Icon = CATEGORY_ICON[line.category];
  const source = line.currency.trim().toUpperCase() || destCurrency;
  const dualCurrencies = destCurrency !== userCurrency;

  const destAmount = convertBudgetAmount(
    line.amount,
    source,
    destCurrency,
    getRate
  );
  const userAmount = convertBudgetAmount(
    line.amount,
    source,
    userCurrency,
    getRate
  );

  const dual =
    destAmount != null
      ? formatDualBudgetMoney(
          destAmount,
          destCurrency,
          dualCurrencies ? userAmount : null,
          dualCurrencies ? userCurrency : null,
          { approximate: estimated }
        )
      : formatDualBudgetMoney(
          line.amount,
          source,
          dualCurrencies ? userAmount : null,
          dualCurrencies ? userCurrency : null,
          { approximate: estimated }
        );

  const sourceNote =
    source && source !== destCurrency && source !== userCurrency
      ? ` · ${formatApproxMoney(line.amount, source)}`
      : "";

  return (
    <li
      className={cx(
        "group flex items-center gap-3 rounded-2xl px-2.5 py-2.5 transition-colors",
        "hover:bg-surface",
        estimated ? "bg-transparent" : "bg-surface/40"
      )}
    >
      <span
        className={cx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105",
          CATEGORY_ACCENT[line.category]
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{line.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-text-muted">
          {t(`planner.budget.category.${line.category}`)}
          {line.subtitle ? ` · ${line.subtitle}` : ""}
          {sourceNote}
        </p>
      </div>
      <DualAmount
        dual={dual}
        className="shrink-0 text-right"
        primaryClassName={cx(
          "text-sm font-semibold tabular-nums text-text",
          estimated && "text-text-secondary"
        )}
        secondaryClassName="text-[10px] tabular-nums text-text-muted"
      />
      {onDelete ? (
        <button
          type="button"
          aria-label={deleteLabel}
          disabled={deleting}
          onClick={onDelete}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-text-muted opacity-70 transition-all hover:bg-error-background hover:text-error hover:opacity-100 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}
