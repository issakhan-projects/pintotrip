"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Timestamp } from "firebase/firestore";
import {
  ArrowLeft,
  ArrowRight,
  Backpack,
  Banknote,
  Briefcase,
  Building2,
  Bus,
  Cake,
  Car,
  Check,
  Compass,
  Footprints,
  Gem,
  Globe2,
  Heart,
  History,
  Home,
  Hotel,
  Landmark,
  MapPinned,
  Mountain,
  Plane,
  ShoppingBag,
  Sparkles,
  Train,
  Trees,
  Umbrella,
  Users,
  UtensilsCrossed,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { Button, TextInput } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { saveTravelProfile } from "@/services/users";
import { useAnalytics } from "@/hooks/useAnalytics";
import { AnalyticsEvents } from "@/types/analytics";
import { cx } from "@/lib/utils";
import {
  ACCOMMODATION_PREFERENCES,
  ACCOMMODATION_PREFERENCE_LABELS,
  PLANNING_STYLE_OPTIONS,
  PREFERRED_TRAVEL_TYPES,
  PREFERRED_TRAVEL_TYPE_LABELS,
  PREFERRED_TRIP_STYLE_OPTIONS,
  TRANSPORTATION_PREFERENCES,
  TRANSPORTATION_PREFERENCE_LABELS,
  TRAVEL_COMPANION_OPTIONS,
  TRAVEL_EXPERIENCE_OPTIONS,
  type AccommodationPreference,
  type PlanningStyle,
  type PreferredTravelType,
  type PreferredTripStyle,
  type TransportationPreference,
  type TravelCompanions,
  type TravelExperience,
  type TravelProfileInput,
} from "@/types/travel-profile";

const STEPS = [
  {
    title: "How experienced are you?",
    subtitle: "We’ll tune recommendations to your comfort level.",
  },
  {
    title: "What do you love?",
    subtitle: "Pick as many vibes as you like — you can change later.",
  },
  {
    title: "How do you like to travel?",
    subtitle: "Budget, trip length, stays, and getting around.",
  },
  {
    title: "Who’s coming along?",
    subtitle: "Companions and how detailed you like your plans.",
  },
] as const;

const EXPERIENCE_ICONS: Record<TravelExperience, LucideIcon> = {
  first_time: Sparkles,
  some_experience: Compass,
  frequent_traveler: Globe2,
};

const TRAVEL_TYPE_ICONS: Record<PreferredTravelType, LucideIcon> = {
  beach: Waves,
  city: Building2,
  nature: Trees,
  adventure: Mountain,
  culture: Landmark,
  history: History,
  food: UtensilsCrossed,
  shopping: ShoppingBag as LucideIcon,
  luxury: Gem,
  relaxation: Heart,
  business: Briefcase,
};

const TRIP_STYLE_ICONS: Record<PreferredTripStyle, LucideIcon> = {
  budget: Banknote,
  mid_range: Compass,
  luxury: Gem,
};

const ACCOMMODATION_ICONS: Record<AccommodationPreference, LucideIcon> = {
  hotel: Hotel,
  resort: Umbrella,
  apartment: Building2,
  hostel: Backpack,
  villa: Home,
};

const TRANSPORT_ICONS: Record<TransportationPreference, LucideIcon> = {
  flight: Plane,
  train: Train,
  car: Car,
  bus: Bus,
  walking: Footprints,
};

const COMPANION_ICONS: Record<TravelCompanions, LucideIcon> = {
  solo: MapPinned,
  couple: Heart,
  family: Home,
  friends: Users,
  business: Briefcase,
};

const DURATION_PRESETS = [
  { label: "Weekend", min: 2, max: 3 },
  { label: "Week", min: 5, max: 7 },
  { label: "2 weeks", min: 10, max: 14 },
] as const;

interface TravelProfileSheetProps {
  open: boolean;
  userId: string;
  onComplete: () => void;
}

function toggleInList<T extends string>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function SectionLabel({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-2">
      <p className="text-sm font-semibold text-text">{children}</p>
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

function ChoiceCard({
  selected,
  label,
  description,
  icon: Icon,
  onClick,
}: {
  selected: boolean;
  label: string;
  description?: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "group flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3.5 text-left transition-all duration-200",
        "active:scale-[0.99]",
        selected
          ? "border-primary bg-primary-tint shadow-sm ring-1 ring-primary/20"
          : "border-border bg-surface-elevated hover:border-primary/30 hover:bg-surface"
      )}
    >
      <span
        className={cx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
          selected
            ? "bg-primary text-white"
            : "bg-surface text-text-secondary group-hover:text-primary"
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="block text-[15px] font-semibold tracking-tight text-text">
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-sm leading-snug text-text-secondary">
            {description}
          </span>
        ) : null}
      </span>
      <span
        className={cx(
          "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected
            ? "border-primary bg-primary text-white"
            : "border-border bg-transparent text-transparent"
        )}
        aria-hidden
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    </button>
  );
}

function SelectChip({
  selected,
  label,
  icon: Icon,
  onClick,
}: {
  selected: boolean;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-medium transition-all duration-200",
        "active:scale-[0.98]",
        selected
          ? "border-primary bg-primary text-white shadow-sm"
          : "border-border bg-surface-elevated text-text hover:border-primary/35 hover:bg-primary-tint/60"
      )}
    >
      {Icon ? (
        <Icon
          className={cx(
            "h-4 w-4 shrink-0",
            selected ? "text-white" : "text-text-secondary"
          )}
          aria-hidden
        />
      ) : null}
      {label}
    </button>
  );
}

function buildPayload(state: {
  travelExperience: TravelExperience | null;
  countriesVisited: string;
  birthday: string;
  preferredTravelTypes: PreferredTravelType[];
  preferredTripStyle: PreferredTripStyle | null;
  minDays: string;
  maxDays: string;
  accommodationPreference: AccommodationPreference[];
  transportationPreference: TransportationPreference[];
  travelCompanions: TravelCompanions | null;
  planningStyle: PlanningStyle | null;
}): TravelProfileInput {
  const payload: TravelProfileInput = {};

  if (state.travelExperience) {
    payload.travelExperience = state.travelExperience;
  }

  const countries = Number.parseInt(state.countriesVisited, 10);
  if (Number.isFinite(countries) && countries >= 0) {
    payload.countriesVisited = countries;
  }

  if (state.birthday.trim()) {
    const date = new Date(`${state.birthday.trim()}T12:00:00`);
    if (!Number.isNaN(date.getTime())) {
      payload.birthday = Timestamp.fromDate(date);
    }
  }

  if (state.preferredTravelTypes.length > 0) {
    payload.preferredTravelTypes = state.preferredTravelTypes;
  }

  if (state.preferredTripStyle) {
    payload.preferredTripStyle = state.preferredTripStyle;
  }

  const minDays = Number.parseInt(state.minDays, 10);
  const maxDays = Number.parseInt(state.maxDays, 10);
  const duration: { minDays?: number; maxDays?: number } = {};
  if (Number.isFinite(minDays) && minDays > 0) duration.minDays = minDays;
  if (Number.isFinite(maxDays) && maxDays > 0) duration.maxDays = maxDays;
  if (duration.minDays !== undefined || duration.maxDays !== undefined) {
    payload.preferredTripDuration = duration;
  }

  if (state.accommodationPreference.length > 0) {
    payload.accommodationPreference = state.accommodationPreference;
  }

  if (state.transportationPreference.length > 0) {
    payload.transportationPreference = state.transportationPreference;
  }

  if (state.travelCompanions) {
    payload.travelCompanions = state.travelCompanions;
  }

  if (state.planningStyle) {
    payload.planningStyle = state.planningStyle;
  }

  return payload;
}

/**
 * One-time post-onboarding sheet for travel tastes.
 * Shown when users/{uid}.travelProfile is missing.
 */
export function TravelProfileSheet({
  open,
  userId,
  onComplete,
}: TravelProfileSheetProps) {
  const { trackEvent } = useAnalytics();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [travelExperience, setTravelExperience] =
    useState<TravelExperience | null>(null);
  const [countriesVisited, setCountriesVisited] = useState("");
  const [birthday, setBirthday] = useState("");
  const [preferredTravelTypes, setPreferredTravelTypes] = useState<
    PreferredTravelType[]
  >([]);
  const [preferredTripStyle, setPreferredTripStyle] =
    useState<PreferredTripStyle | null>(null);
  const [minDays, setMinDays] = useState("");
  const [maxDays, setMaxDays] = useState("");
  const [accommodationPreference, setAccommodationPreference] = useState<
    AccommodationPreference[]
  >([]);
  const [transportationPreference, setTransportationPreference] = useState<
    TransportationPreference[]
  >([]);
  const [travelCompanions, setTravelCompanions] =
    useState<TravelCompanions | null>(null);
  const [planningStyle, setPlanningStyle] = useState<PlanningStyle | null>(
    null
  );

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSaving(false);
    setError(null);
    setTravelExperience(null);
    setCountriesVisited("");
    setBirthday("");
    setPreferredTravelTypes([]);
    setPreferredTripStyle(null);
    setMinDays("");
    setMaxDays("");
    setAccommodationPreference([]);
    setTransportationPreference([]);
    setTravelCompanions(null);
    setPlanningStyle(null);
    trackEvent(AnalyticsEvents.TRAVEL_PROFILE_SHOWN);
  }, [open, trackEvent]);

  const formState = {
    travelExperience,
    countriesVisited,
    birthday,
    preferredTravelTypes,
    preferredTripStyle,
    minDays,
    maxDays,
    accommodationPreference,
    transportationPreference,
    travelCompanions,
    planningStyle,
  };

  const canContinue =
    step === 0
      ? travelExperience !== null
      : step === 1
        ? preferredTravelTypes.length > 0
        : true;

  async function persist(skipped: boolean) {
    setSaving(true);
    setError(null);
    try {
      const payload = skipped
        ? buildPayload(formState)
        : {
            ...buildPayload(formState),
            travelExperience: travelExperience!,
          };

      if (!skipped && !travelExperience) {
        setError("Please choose your travel experience.");
        setSaving(false);
        return;
      }

      await saveTravelProfile(userId, payload);
      trackEvent(
        skipped
          ? AnalyticsEvents.TRAVEL_PROFILE_SKIPPED
          : AnalyticsEvents.TRAVEL_PROFILE_COMPLETED,
        {
          step,
          experience: travelExperience ?? null,
        }
      );
      onComplete();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save your travel profile."
      );
    } finally {
      setSaving(false);
    }
  }

  const meta = STEPS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!saving) void persist(true);
      }}
      title="Your travel style"
      size="lg"
      showClose={false}
      bodyClassName="flex flex-col gap-0 !p-0"
    >
      {/* Soft intro + progress */}
      <div className="border-b border-divider bg-gradient-to-b from-primary-tint/80 to-surface-elevated px-4 pb-4 pt-1">
        <div className="flex items-center gap-2 text-primary">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Compass className="h-4 w-4" aria-hidden />
          </span>
          <p className="text-xs font-semibold uppercase tracking-[0.14em]">
            Quick setup · {step + 1}/{STEPS.length}
          </p>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/15">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <h3 className="mt-4 text-xl font-semibold tracking-tight text-text">
          {meta.title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">
          {meta.subtitle}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {step === 0 ? (
          <div className="space-y-5">
            <div className="space-y-2.5">
              {TRAVEL_EXPERIENCE_OPTIONS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  selected={travelExperience === option.value}
                  label={option.label}
                  description={option.description}
                  icon={EXPERIENCE_ICONS[option.value]}
                  onClick={() => setTravelExperience(option.value)}
                />
              ))}
            </div>

            <div className="rounded-2xl border border-border bg-surface/80 p-3.5">
              <SectionLabel hint="Optional">A bit more about you</SectionLabel>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                    <Globe2 className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                    Countries visited
                  </span>
                  <TextInput
                    type="number"
                    min={0}
                    max={250}
                    inputMode="numeric"
                    placeholder="e.g. 12"
                    value={countriesVisited}
                    onChange={(event) => setCountriesVisited(event.target.value)}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                    <Cake className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                    Birthday
                  </span>
                  <TextInput
                    type="date"
                    value={birthday}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setBirthday(event.target.value)}
                  />
                </label>
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <SectionLabel
              hint={
                preferredTravelTypes.length > 0
                  ? `${preferredTravelTypes.length} selected`
                  : "Tap to select"
              }
            >
              Travel vibes
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              {PREFERRED_TRAVEL_TYPES.map((type) => (
                <SelectChip
                  key={type}
                  selected={preferredTravelTypes.includes(type)}
                  label={PREFERRED_TRAVEL_TYPE_LABELS[type]}
                  icon={TRAVEL_TYPE_ICONS[type]}
                  onClick={() =>
                    setPreferredTravelTypes((prev) => toggleInList(prev, type))
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-6">
            <div>
              <SectionLabel>Trip style</SectionLabel>
              <div className="space-y-2.5">
                {PREFERRED_TRIP_STYLE_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.value}
                    selected={preferredTripStyle === option.value}
                    label={option.label}
                    description={option.description}
                    icon={TRIP_STYLE_ICONS[option.value]}
                    onClick={() => setPreferredTripStyle(option.value)}
                  />
                ))}
              </div>
            </div>

            <div>
              <SectionLabel hint="Optional">Typical trip length</SectionLabel>
              <div className="mb-3 flex flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => {
                  const active =
                    minDays === String(preset.min) &&
                    maxDays === String(preset.max);
                  return (
                    <SelectChip
                      key={preset.label}
                      selected={active}
                      label={preset.label}
                      onClick={() => {
                        setMinDays(String(preset.min));
                        setMaxDays(String(preset.max));
                      }}
                    />
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-text">From (days)</span>
                  <TextInput
                    type="number"
                    min={1}
                    max={365}
                    inputMode="numeric"
                    placeholder="3"
                    value={minDays}
                    onChange={(event) => setMinDays(event.target.value)}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-text">To (days)</span>
                  <TextInput
                    type="number"
                    min={1}
                    max={365}
                    inputMode="numeric"
                    placeholder="10"
                    value={maxDays}
                    onChange={(event) => setMaxDays(event.target.value)}
                  />
                </label>
              </div>
            </div>

            <div>
              <SectionLabel hint="Multi-select">Where you stay</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {ACCOMMODATION_PREFERENCES.map((value) => (
                  <SelectChip
                    key={value}
                    selected={accommodationPreference.includes(value)}
                    label={ACCOMMODATION_PREFERENCE_LABELS[value]}
                    icon={ACCOMMODATION_ICONS[value]}
                    onClick={() =>
                      setAccommodationPreference((prev) =>
                        toggleInList(prev, value)
                      )
                    }
                  />
                ))}
              </div>
            </div>

            <div>
              <SectionLabel hint="Multi-select">How you get around</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {TRANSPORTATION_PREFERENCES.map((value) => (
                  <SelectChip
                    key={value}
                    selected={transportationPreference.includes(value)}
                    label={TRANSPORTATION_PREFERENCE_LABELS[value]}
                    icon={TRANSPORT_ICONS[value]}
                    onClick={() =>
                      setTransportationPreference((prev) =>
                        toggleInList(prev, value)
                      )
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-6">
            <div>
              <SectionLabel>Usually travel with</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {TRAVEL_COMPANION_OPTIONS.map((option) => (
                  <SelectChip
                    key={option.value}
                    selected={travelCompanions === option.value}
                    label={option.label}
                    icon={COMPANION_ICONS[option.value]}
                    onClick={() => setTravelCompanions(option.value)}
                  />
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Planning style</SectionLabel>
              <div className="space-y-2.5">
                {PLANNING_STYLE_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.value}
                    selected={planningStyle === option.value}
                    label={option.label}
                    description={option.description}
                    icon={
                      option.value === "spontaneous"
                        ? Sparkles
                        : option.value === "balanced"
                          ? Compass
                          : MapPinned
                    }
                    onClick={() => setPlanningStyle(option.value)}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            className="rounded-xl border border-error/20 bg-error-background px-3 py-2.5 text-sm text-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-divider bg-surface-elevated px-4 py-3">
        <div className="flex gap-2">
          {step > 0 ? (
            <Button
              variant="secondary"
              disabled={saving}
              icon={ArrowLeft}
              onClick={() => setStep((s) => s - 1)}
              className="shrink-0"
            >
              Back
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button
              disabled={!canContinue || saving}
              onClick={() => setStep((s) => s + 1)}
              className="min-w-0 flex-1"
            >
              Continue
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
            </Button>
          ) : (
            <Button
              loading={saving}
              disabled={!travelExperience || saving}
              onClick={() => void persist(false)}
              className="min-w-0 flex-1"
            >
              Save & continue
            </Button>
          )}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void persist(true)}
          className="mt-2 w-full py-2 text-center text-sm font-medium text-text-muted transition-colors hover:text-text-secondary disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </Sheet>
  );
}
