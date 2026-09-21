import type { CityIntelligenceResult } from "@/types/city-intelligence";
import type { SpendMoneyLevel } from "@/types/trip-planner";
import type {
  PreparationItem,
  TripAccommodation,
  TripPlannerDoc,
  TripVisaDetails,
  TripDocumentDetails,
} from "@/types/trip-planner";
import { resolveCountryCode } from "@/lib/countries";
import { countryIdFromParts } from "@/lib/utils";
import {
  isUmrahLeisure,
  UMRAH_PREPARATION_ITEMS,
} from "./umrahPreparation";
import { officialVisaLink, parseHttpUrl } from "./preparationLinks";
import { listTripDestinations } from "./tripDestinations";
import { listTripAccommodations } from "./essentialsHelpers";

const CUSTOM_PREFIX = "custom:";

/** Minimal flight shape for preparation tips (from routes / legacy data). */
type PrepFlight = {
  routeLabel?: string;
  fromCityName?: string;
  toCityName?: string;
  routeAirports?: Array<{ code?: string }>;
  departure?: { code?: string };
  arrival?: { code?: string };
  departureAirport?: string;
  arrivalAirport?: string;
  departureAt?: string;
  arrivalAt?: string;
  airline?: string;
  flightNumber?: string;
  bookingLink?: string;
};

const SYSTEM_FIXED_IDS = new Set([
  "visa",
  "passport",
  "passport-validity",
  "travel-documents",
  "travel-insurance",
  "flight",
  "accommodation",
  "money",
  "offline-maps",
  "pack-weather",
]);

const LEGACY_TITLE_TO_ID: Record<string, string> = {
  "check passport validity": "passport-validity",
  "check passport": "passport",
  "confirm domestic travel id": "travel-documents",
  "check visa / entry requirements": "visa",
  "book accommodation": "accommodation",
  "confirm transport": "flight",
  "confirm flights": "flight",
  "book your flight": "flight",
  "get travel insurance": "travel-insurance",
  "prepare local currency / payment": "money",
  //"download offline maps": "offline-maps",
  "pack for the weather": "pack-weather",
};

type DraftItem = Omit<PreparationItem, "order"> & { derived?: boolean };

export type LocalDocSignals = {
  hasPassport: boolean;
  /** Client-only; never persist expiry dates. */
  passportValidForTrip: boolean;
  hasId: boolean;
};

export type PreparationBuildInput = {
  destinations: Array<{
    cityName: string;
    countryName: string;
    countryId?: string;
  }>;
  fromCountry?: string;
  fromCountryId?: string;
  citizenship?: string;
  leisureType?: string;
  spendMoney?: SpendMoneyLevel;
  startDate?: Date;
  cityIntelligenceResults?: CityIntelligenceResult[] | null;
  flights?: PrepFlight[];
  accommodation?: TripAccommodation[];
  documents?: TripDocumentDetails | null;
  visa?: TripVisaDetails | null;
  localDocs?: LocalDocSignals;
};

type CountryGroup = {
  countryId: string;
  countryName: string;
  cities: string[];
};

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function countryKey(countryName: string, countryId?: string): string {
  const code =
    (countryId && countryId.length === 2 ? countryId : "") ||
    resolveCountryCode(countryId) ||
    resolveCountryCode(countryName);
  return countryIdFromParts(countryName, code || undefined);
}

function uniqueCountries(
  destinations: PreparationBuildInput["destinations"]
): CountryGroup[] {
  const groups: CountryGroup[] = [];
  const index = new Map<string, number>();

  for (const dest of destinations) {
    const city = dest.cityName.trim();
    const countryName = dest.countryName.trim() || city;
    if (!countryName) continue;
    const id = countryKey(countryName, dest.countryId);
    let i = index.get(id);
    if (i === undefined) {
      i = groups.length;
      index.set(id, i);
      groups.push({ countryId: id, countryName, cities: [] });
    }
    if (city && !groups[i]!.cities.includes(city)) {
      groups[i]!.cities.push(city);
    }
  }

  return groups;
}

function cityList(destinations: PreparationBuildInput["destinations"]): string {
  const names = destinations
    .map((d) => d.cityName.trim())
    .filter(Boolean);
  return [...new Set(names)].join(", ");
}

function sameCountryAsHome(
  country: CountryGroup,
  fromCountry?: string,
  fromCountryId?: string
): boolean {
  if (!fromCountry && !fromCountryId) return false;
  const fromKey = countryKey(fromCountry || "", fromCountryId);
  return fromKey === country.countryId;
}

function beforeDeparture(startDate?: Date): string | undefined {
  if (!startDate) return undefined;
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(startDate);
  return `Complete before departure (${label}).`;
}

function joinSentences(...parts: Array<string | undefined | null>): string | undefined {
  const text = parts
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join(" ");
  return text || undefined;
}

function withItemLink(
  item: DraftItem,
  link?: { url: string; label: string }
): DraftItem {
  if (!link) return item;
  return { ...item, link: link.url, linkLabel: link.label };
}

function visaLinkForCountry(
  country: CountryGroup,
  saved?: TripVisaDetails | null,
  _intel?: CityIntelligenceResult | null
): { url: string; label: string } | undefined {
  const savedLink = parseHttpUrl(saved?.applicationLink);
  if (savedLink) {
    return { url: savedLink, label: "Visa application" };
  }
  return officialVisaLink(country.countryId, country.countryName);
}

function spendMoneyDescription(
  spendMoney: SpendMoneyLevel | undefined,
  paymentTip?: string
): string {
  const local = paymentTip?.trim();
  switch (spendMoney) {
    case "low":
      return joinSentences(
        "Emphasize cash and working local payment methods — ATMs, small vendors, and cards that actually work at your destinations.",
        local
      )!;
    case "high":
      return joinSentences(
        "Keep your usual cards, a backup payment method, and emergency funds in a stable currency.",
        local
      )!;
    default:
      return (
        local ||
        "Have a mix of cards and some cash for transport, tips, and small shops."
      );
  }
}

export function spendMoneyCurrencyTip(
  spendMoney: SpendMoneyLevel | undefined,
  paymentTip?: string
): string {
  const local = paymentTip?.trim();
  const spend =
    spendMoney === "low"
      ? "Confirm cash availability and which local payment methods work."
      : spendMoney === "high"
        ? "Keep a backup payment method and emergency funds in addition to your usual cards."
        : spendMoney === "medium"
          ? "Have a mix of cards and some cash for transport, tips, and small shops."
          : undefined;
  if (spend && local) return `${spend} ${local}`;
  return (
    spend ||
    local ||
    "It's a good idea to have some cash for small purchases, transport and tips."
  );
}

function formatFlight(flight: PrepFlight): string {
  const route =
    flight.routeLabel?.trim() ||
    [flight.fromCityName, flight.toCityName].filter(Boolean).join(" → ");
  const codes =
    flight.routeAirports && flight.routeAirports.length > 0
      ? flight.routeAirports.map((a) => a.code).filter(Boolean).join(" → ")
      : [
          flight.departure?.code || flight.departureAirport,
          flight.arrival?.code || flight.arrivalAirport,
        ]
          .filter(Boolean)
          .join(" → ");
  const when = flight.departureAt?.trim() || flight.arrivalAt?.trim() || "";
  return [route, codes, when].filter(Boolean).join(" · ");
}

function buildVisaItem(
  country: CountryGroup,
  input: PreparationBuildInput,
  isPrimaryIntelCountry: boolean
): DraftItem {
  const deadline = beforeDeparture(input.startDate);
  const saved = isPrimaryIntelCountry ? input.visa : null;
  const intelList = input.cityIntelligenceResults ?? [];
  const intel =
    intelList.find(
      (entry) =>
        entry.city &&
        countryKey(entry.city.country, entry.city.countryId) ===
          country.countryId
    ) ?? (isPrimaryIntelCountry ? intelList[0] : null);
  const visa = intel?.visa;
  const required = visa?.required;
  const link = visaLinkForCountry(country, saved, intel);

  if (!isPrimaryIntelCountry && !saved) {
    return withItemLink(
      {
        id: `visa:${country.countryId}`,
        title: `Check visa / entry requirements for ${country.countryName}`,
        description: joinSentences(
          `Verify official entry rules for ${country.countryName} before you travel.`,
          "Do not rely on unofficial sources.",
          deadline
        ),
        category: "documents",
        completed: false,
      },
      link
    );
  }

  if (saved?.status === "not_needed" || required === false) {
    return withItemLink(
      {
        id: `visa:${country.countryId}`,
        title: "Visa not required",
        description: joinSentences(
          `No visa needed for ${country.countryName}.`,
          visa?.description && visa.description !== "Visa not required"
            ? visa.description
            : undefined
        ),
        category: "documents",
        completed: true,
        derived: true,
      },
      link
    );
  }

  const type = saved?.type?.trim() || visa?.type?.trim() || undefined;
  const cost =
    visa?.cost?.amount != null
      ? `Approx. cost: ${visa.cost.amount}${
          visa.cost.currency ? ` ${visa.cost.currency}` : ""
        }`
      : undefined;
  const uncertain =
    required === "unknown" ||
    required == null ||
    visa?.verificationRequired === true;

  const title =
    required === true ||
    saved?.status === "not_started" ||
    saved?.status === "applied" ||
    saved?.status === "approved"
      ? `Visa for ${country.countryName}`
      : `Check visa / entry requirements for ${country.countryName}`;

  const summary = visa?.description || undefined;

  return withItemLink(
    {
      id: `visa:${country.countryId}`,
      title,
      description: joinSentences(
        summary,
        type ? `Type: ${type}.` : undefined,
        cost,
        uncertain
          ? "Verification with an official source is required — do not rely on this checklist alone."
          : undefined,
        deadline
      ),
      category: "documents",
      completed:
        saved?.status === "applied" || saved?.status === "approved",
      derived: saved?.status === "applied" || saved?.status === "approved",
    },
    link
  );
}

function buildSystemItems(input: PreparationBuildInput): DraftItem[] {
  const destinations =
    input.destinations.filter(
      (d) => d.cityName.trim() || d.countryName.trim()
    ).length > 0
      ? input.destinations
      : [];
  const countries = uniqueCountries(destinations);
  const cities = cityList(destinations);
  const deadline = beforeDeparture(input.startDate);
  const docs = input.documents;
  const local = input.localDocs;
  const intelList = input.cityIntelligenceResults ?? [];
  const intel = intelList[0];
  const paymentTip = intel?.details?.practicalInfo?.payment;
  const items: DraftItem[] = [];

  const intelCountryId = intel?.city
    ? countryKey(intel.city.country, intel.city.countryId)
    : countries[0]?.countryId;
  const allDomestic =
    countries.length > 0 &&
    countries.every((c) =>
      sameCountryAsHome(c, input.fromCountry, input.fromCountryId)
    );

  if (!allDomestic) {
    if (countries.length === 0) {
      items.push({
        id: "visa",
        title: "Check visa / entry requirements",
        description: joinSentences(
          "Verify entry rules with official sources.",
          deadline
        ),
        category: "documents",
        completed: false,
      });
    } else {
      for (const country of countries) {
        if (sameCountryAsHome(country, input.fromCountry, input.fromCountryId)) {
          continue;
        }
        const isPrimary =
          country.countryId === (intelCountryId ?? countries[0]?.countryId);
        items.push(buildVisaItem(country, input, isPrimary));
      }
    }

    items.push({
      id: "passport",
      title: "Check passport",
      description: joinSentences(
        cities
          ? `Confirm your passport is ready for ${cities}.`
          : "Confirm your passport is ready for this trip.",
        deadline
      ),
      category: "documents",
      completed: Boolean(docs?.passportReady || local?.hasPassport),
    });

    items.push({
      id: "passport-validity",
      title: "Check passport validity",
      description: joinSentences(
        "Many destinations need 6+ months remaining validity.",
        deadline
      ),
      category: "documents",
      completed: Boolean(
        docs?.passportReady ||
          (local?.hasPassport && local.passportValidForTrip)
      ),
    });
  }

  items.push({
    id: "travel-documents",
    title: "Required travel documents",
    description: joinSentences(
      "ID and any extra travel documents for this trip.",
      deadline
    ),
    category: "documents",
    completed: Boolean(docs?.idReady || local?.hasId),
  });

  items.push({
    id: "travel-insurance",
    title: "Get travel insurance",
    description: joinSentences(
      "Cover medical care and trip disruption before you go.",
      deadline
    ),
    category: "health",
    completed: Boolean(docs?.insuranceReady),
  });

  const flights = (input.flights ?? []).filter(
    (f) =>
      f.routeLabel ||
      f.fromCityName ||
      f.toCityName ||
      f.departure?.code ||
      f.arrival?.code ||
      f.airline ||
      f.flightNumber ||
      f.departureAirport ||
      f.arrivalAirport ||
      f.bookingLink ||
      f.departureAt
  );

  if (flights.length > 0) {
    const details = flights.map(formatFlight).filter(Boolean).join("; ");
    const booking = flights
      .map((f) => parseHttpUrl(f.bookingLink))
      .find(Boolean);
    items.push({
      id: "flight",
      title: flights.length === 1 ? "Flight booked" : "Flights booked",
      description: joinSentences(details || "Flight details saved."),
      category: "transport",
      completed: true,
      derived: true,
      ...(booking
        ? { link: booking, linkLabel: "Open booking" }
        : {}),
    });
  } else {
    items.push({
      id: "flight",
      title: allDomestic ? "Confirm transport" : "Book your flight",
      description: joinSentences(
        allDomestic
          ? "Arrange how you will travel between home and your destinations."
          : cities
            ? `Book flights for ${cities}.`
            : "Book your flights.",
        deadline
      ),
      category: "transport",
      completed: false,
    });
  }

  const stays = (input.accommodation ?? []).filter(
    (s) => s.name || s.link || s.address
  );
  if (stays.length > 0) {
    const names = stays
      .map((s) => s.name?.trim())
      .filter((n): n is string => Boolean(n));
    const booking = stays.map((s) => parseHttpUrl(s.link)).find(Boolean);
    items.push({
      id: "accommodation",
      title: "Accommodation booked",
      description: joinSentences(
        names.length ? names.join("; ") : "Stay details saved."
      ),
      category: "booking",
      completed: true,
      derived: true,
      ...(booking
        ? { link: booking, linkLabel: "Open booking" }
        : {}),
    });
  } else {
    items.push({
      id: "accommodation",
      title: "Book accommodation",
      description: joinSentences(
        cities
          ? `Reserve a place to stay in ${cities}.`
          : "Reserve a place to stay.",
        deadline
      ),
      category: "booking",
      completed: false,
    });
  }

  if (!allDomestic) {
    items.push({
      id: "money",
      title: "Prepare local currency / payment",
      description: spendMoneyDescription(input.spendMoney, paymentTip),
      category: "money",
      completed: false,
    });
  }

  items.push({
    id: "offline-maps",
    title: "Download offline maps",
    description: cities
      ? `Save offline maps for ${cities}.`
      : "Save offline maps for your destinations.",
    category: "other",
    completed: false,
  });

  items.push({
    id: "pack-weather",
    title: "Pack for the weather",
    description: joinSentences(
      intel?.details?.climate?.description,
      cities
        ? `Check climate notes for ${cities} before you pack.`
        : "Check climate notes in trip details before you pack."
    ),
    category: "packing",
    completed: false,
  });

  if (isUmrahLeisure(input.leisureType)) {
    for (const umrah of UMRAH_PREPARATION_ITEMS) {
      if (items.some((item) => item.id === umrah.id)) continue;
      items.push({
        id: umrah.id,
        title: umrah.title,
        description: joinSentences(umrah.description, deadline),
        category: umrah.category,
        completed: false,
      });
    }
  }

  return items;
}

function resolveExisting(
  existing: PreparationItem[],
  generatedId: string,
  generatedTitle: string
): PreparationItem | undefined {
  const byId = existing.find((item) => item.id === generatedId);
  if (byId) return byId;

  const legacyId = LEGACY_TITLE_TO_ID[normalizeTitle(generatedTitle)];
  if (legacyId && (legacyId === generatedId || generatedId.startsWith(`${legacyId}:`))) {
    const byLegacy = existing.find(
      (item) => LEGACY_TITLE_TO_ID[normalizeTitle(item.title)] === legacyId
    );
    if (byLegacy) return byLegacy;
  }

  return existing.find(
    (item) => normalizeTitle(item.title) === normalizeTitle(generatedTitle)
  );
}

/**
 * Merge generated system items with user-completed state and custom items.
 * Custom items (ids prefixed with `custom:` or leftover user rows) are kept.
 */
export function mergePreparationItems(
  existing: PreparationItem[],
  generated: DraftItem[]
): PreparationItem[] {
  const used = new Set<string>();
  const next: PreparationItem[] = generated.map((item, order) => {
    const prev = resolveExisting(existing, item.id, item.title);
    if (prev) used.add(prev.id);
    // `derived` means the system asserts "done" (booked flight, visa approved,
    // etc.). Incomplete system rows must not be derived, or a sync right after
    // a user check would force completed back to false.
    const completed = item.derived
      ? true
      : Boolean(item.completed || prev?.completed);
    const merged: PreparationItem = {
      id: item.id,
      title: item.title,
      completed,
      category: item.category,
      order,
    };
    if (item.description) merged.description = item.description;
    if (item.link) merged.link = item.link;
    if (item.linkLabel) merged.linkLabel = item.linkLabel;
    return merged;
  });

  const generatedIds = new Set(generated.map((item) => item.id));
  for (const item of existing) {
    if (used.has(item.id)) continue;
    if (generatedIds.has(item.id)) continue;
    // Drop superseded system rows (e.g. visa/passport after a domestic trip).
    if (SYSTEM_FIXED_IDS.has(item.id) || item.id.startsWith("visa:")) continue;
    if (LEGACY_TITLE_TO_ID[normalizeTitle(item.title)]) continue;
    next.push({
      ...item,
      order: next.length,
    });
  }

  return next;
}

export function preparationItemsEqual(
  a: PreparationItem[],
  b: PreparationItem[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.id !== right.id ||
      left.title !== right.title ||
      left.description !== right.description ||
      left.completed !== right.completed ||
      left.category !== right.category ||
      left.order !== right.order ||
      left.link !== right.link ||
      left.linkLabel !== right.linkLabel
    ) {
      return false;
    }
  }
  return true;
}

export function isCustomPreparationItem(item: PreparationItem): boolean {
  if (item.id.startsWith(CUSTOM_PREFIX)) return true;
  if (item.id.startsWith("visa:") || item.id.startsWith("umrah-")) return false;
  return !SYSTEM_FIXED_IDS.has(item.id);
}

export function newCustomPreparationId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return `${CUSTOM_PREFIX}${uuid}`;
}

export function buildTripPreparationItems(
  input: PreparationBuildInput
): PreparationItem[] {
  return mergePreparationItems([], buildSystemItems(input));
}

export function syncTripPreparationItems(
  existing: PreparationItem[],
  input: PreparationBuildInput
): PreparationItem[] {
  return mergePreparationItems(existing, buildSystemItems(input));
}

export function preparationInputFromTrip(
  trip: TripPlannerDoc,
  localDocs?: LocalDocSignals
): PreparationBuildInput {
  const destinations = listTripDestinations(trip);

  const stays = listTripAccommodations(trip);

  return {
    destinations: destinations.map((d) => ({
      cityName: d.cityName,
      countryName: d.countryName,
      countryId: d.countryId,
    })),
    fromCountry: trip.from.countryName,
    fromCountryId: trip.from.countryId,
    leisureType: trip.leisureType,
    spendMoney: trip.spendMoney,
    startDate: trip.startDate?.toDate?.(),
    cityIntelligenceResults: trip.cityIntelligence.results,
    accommodation: stays,
    documents: trip.preparation.documents,
    visa: trip.preparation.visa,
    localDocs,
  };
}

/**
 * Seed "Before you go" checklist from trip context.
 * Pure client-side — no Cloud Function.
 */
export function buildDefaultPreparationItems(input: {
  destinationCity?: string;
  destinationCountry?: string;
  destinations?: PreparationBuildInput["destinations"];
  fromCountry?: string;
  fromCountryId?: string;
  citizenship?: string;
  leisureType?: string;
  spendMoney?: SpendMoneyLevel;
  startDate?: Date;
  visaLikelyRequired?: boolean;
}): PreparationItem[] {
  const destinations =
    input.destinations && input.destinations.length > 0
      ? input.destinations
      : input.destinationCity || input.destinationCountry
        ? [
            {
              cityName: input.destinationCity ?? "",
              countryName: input.destinationCountry ?? "",
            },
          ]
        : [];

  return buildTripPreparationItems({
    destinations,
    fromCountry: input.fromCountry,
    fromCountryId: input.fromCountryId,
    citizenship: input.citizenship,
    leisureType: input.leisureType,
    spendMoney: input.spendMoney,
    startDate: input.startDate,
  });
}
