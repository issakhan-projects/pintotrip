"use client";

import { useId, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Check,
  ChevronRight,
  ClipboardList,
  Coins,
  ExternalLink,
  FileText,
  Info,
  ListChecks,
  Luggage,
  Map,
  Plane,
  Plus,
  Shield,
  Shirt,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button, TextInput } from "@/components/ui";
import type {
  PreparationCategory,
  PreparationItem,
  TripPlannerDoc,
} from "@/types/trip-planner";
import { preparationProgress } from "./tripUtils";
import { cx } from "@/lib/utils";

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
  onToggleItem: (itemId: string, completed: boolean) => void;
  onAddItem: (title: string) => void;
  onGoToDetails: () => void;
  onGoToPlaces: () => void;
  onViewGuide?: () => void;
}

export function BeforeYouGoStep({
  trip,
  onToggleItem,
  onAddItem,
  onGoToDetails,
  onGoToPlaces,
  onViewGuide,
}: BeforeYouGoStepProps) {
  const items = [...trip.preparation.items].sort((a, b) => a.order - b.order);
  const progress = preparationProgress(items);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addInputId = useId();

  const intel = trip.cityIntelligence.result;
  const exchange = intel?.exchangeRate ?? intel?.details?.currency?.exchangeRate;
  const destCurrency =
    intel?.details?.currency?.code ||
    trip.currency.code ||
    intel?.currency ||
    "";
  const rateFrom = exchange?.from;
  const rateTo = exchange?.to;
  const rateValue =
    typeof exchange?.rate === "number" && Number.isFinite(exchange.rate)
      ? exchange.rate
      : null;

  const currencyTip =
    intel?.details?.practicalInfo?.payment ||
    "It's a good idea to have some cash for small purchases, transport and tips.";

  const aiInsight = buildAiInsight(trip);

  function submitCustomItem() {
    const title = draft.trim();
    if (!title) return;
    onAddItem(title);
    setDraft("");
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
              />
            ))}
          </ul>

          {adding ? (
            <form
              className="mt-4 flex gap-2"
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
                className="flex-1"
              />
              <Button type="submit" disabled={!draft.trim()}>
                Add
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setAdding(false);
                  setDraft("");
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-surface px-4 py-3 text-sm font-medium text-text-secondary transition-colors hover:bg-primary-tint hover:text-primary"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add custom item
            </button>
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

          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <Coins className="h-4 w-4" aria-hidden />
              </span>
              <h3 className="text-sm font-semibold text-text">Currency</h3>
            </div>

            {rateFrom && rateTo && rateValue != null ? (
              <p className="mt-3 flex items-center justify-between gap-2 text-sm font-medium text-text">
                <span>
                  1 {rateFrom} ≈ {formatRate(rateValue)} {rateTo}
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-text-muted"
                  aria-hidden
                />
              </p>
            ) : destCurrency ? (
              <p className="mt-3 flex items-center justify-between gap-2 text-sm font-medium text-text">
                <span>
                  Local currency: {destCurrency}
                  {trip.currency.symbol ? ` (${trip.currency.symbol})` : ""}
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-text-muted"
                  aria-hidden
                />
              </p>
            ) : (
              <p className="mt-3 text-sm text-text-secondary">
                Exchange rate unavailable yet.
              </p>
            )}

            <div className="mt-3 flex gap-2 rounded-xl bg-primary-tint px-3 py-2.5 text-xs leading-relaxed text-primary">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <p>{currencyTip}</p>
            </div>
          </div>
        </aside>
      </div>

      {aiInsight ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary-tint px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
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
}: {
  item: PreparationItem;
  onToggle: () => void;
}) {
  const Icon = CATEGORY_ICON[item.category] ?? ClipboardList;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 py-5 text-left transition-colors first:pt-1 last:pb-1 hover:bg-surface/60"
      >
        <span
          className={cx(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            item.completed
              ? "border-primary bg-primary text-white"
              : "border-border bg-white text-transparent"
          )}
          aria-hidden
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>

        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>

        <span className="min-w-0 flex-1">
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
        </span>
{/* 
        <ChevronRight
          className="h-4 w-4 shrink-0 text-text-muted"
          aria-hidden
        /> */}
      </button>
    </li>
  );
}

function formatRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(0);
  if (rate >= 10) return rate.toFixed(1);
  if (rate >= 1) return rate.toFixed(2);
  return rate.toPrecision(3);
}

function buildAiInsight(trip: TripPlannerDoc): string | null {
  const result = trip.cityIntelligence.result;
  if (!result) return null;

  const city = trip.destination.cityName;
  const parts: string[] = [];

  const best =
    result.bestTimeToVisit?.summary ||
    result.details?.bestTimeToVisit?.description;
  if (best) parts.push(best);

  const visa =
    result.visaRequirements?.summary || result.details?.visa?.description;
  if (visa) parts.push(visa);

  if (parts.length === 0) return null;

  const joined = parts.join(" ");
  if (joined.toLowerCase().includes(city.toLowerCase())) return joined;
  return `For ${city}: ${joined}`;
}
