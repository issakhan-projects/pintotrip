import { resolveCountryCode } from "@/lib/countries";
import { devLog } from "@/lib/devLog";
import type { DdsFeatureType } from "./ddsCapabilities";

/**
 * Countries with Google DDS LOCALITY polygon coverage (allowlist).
 * @see https://developers.google.com/maps/documentation/javascript/dds-boundaries/coverage
 */
const LOCALITY_COUNTRIES = new Set([
  "au",
  "be",
  "bg",
  "cz",
  "de",
  "ee",
  "fr",
  "gb",
  "hu",
  "in",
  "jp",
  "lu",
  "mt",
  "nz",
  "si",
  "sk",
  "th",
  "us",
]);

/**
 * Countries with no Admin1 / Admin2 / Locality DDS — use COUNTRY instead.
 * @see https://developers.google.com/maps/documentation/javascript/dds-boundaries/coverage
 */
const NO_ADMIN1_COUNTRIES = new Set([
  "ae",
  "il",
  "kr",
  "pk",
  "sg",
  "ma", // Morocco — Marrakech cannot use Admin1 Feature Layers
  "cy",
  "mc",
  "mo",
  "gu",
  "aw",
  "cw",
  "ai",
  "bl",
  "mf",
  "sx",
  "va",
  "ps",
  "ss",
]);

const NO_ADMIN2_COUNTRIES = new Set([
  "kz",
  "tr",
  "kg",
  "uz",
  "tj",
  "tm",
  "ru",
  "ua",
  "cn",
  "ca",
  "pk",
  "kr",
  "il",
  "ae",
  "ma",
]);

/**
 * Map slug / localized country names → ISO alpha-2.
 * PinToTrip often stores slugifyId(localizedName) instead of "ma".
 */
const COUNTRY_NAME_ALIASES: Array<{ pattern: RegExp; code: string }> = [
  {
    pattern: /\b(uae|oae|emirates|оаэ|эмират|united-arab-emirates)\b/u,
    code: "ae",
  },
  {
    pattern: /\b(morocco|maroc|марокко|marokko)\b/u,
    code: "ma",
  },
  {
    pattern: /\b(israel|израиль)\b/u,
    code: "il",
  },
  {
    pattern: /\b(korea| assжная-корея|южная корея|south-korea)\b/u,
    code: "kr",
  },
  {
    pattern: /\b(pakistan|пакистан)\b/u,
    code: "pk",
  },
  {
    pattern: /\b(singapore|сингапур)\b/u,
    code: "sg",
  },
  {
    pattern: /\b(turkey|türkiye|turkiye|турция)\b/u,
    code: "tr",
  },
  {
    pattern: /\b(kazakhstan|казахстан)\b/u,
    code: "kz",
  },
];

export function normalizeCountryCode(
  countryId?: string,
  countryName?: string
): string {
  const id = countryId?.trim().toLowerCase() ?? "";
  if (/^[a-z]{2}$/.test(id)) return id;

  const haystack = `${id} ${countryName ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  for (const { pattern, code } of COUNTRY_NAME_ALIASES) {
    if (pattern.test(haystack)) return code;
  }

  const fromName = resolveCountryCode(countryName || countryId || "");
  const code = fromName.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(code)) return code;
  return "";
}

export function countryHasLocalityCoverage(
  countryId?: string,
  countryName?: string
): boolean {
  const code = normalizeCountryCode(countryId, countryName);
  return Boolean(code && LOCALITY_COUNTRIES.has(code));
}

export function countryHasAdmin1Coverage(
  countryId?: string,
  countryName?: string
): boolean {
  const code = normalizeCountryCode(countryId, countryName);
  if (!code) return true; // unknown → try Admin1
  return !NO_ADMIN1_COUNTRIES.has(code);
}

/**
 * Preferred DDS layer for a city.
 * City/region first; COUNTRY when Google has no city polygons (e.g. MA, AE).
 */
export function preferredFeatureTypeForCountry(options: {
  countryId?: string;
  countryName?: string;
  countryAvailable: boolean;
  localityAvailable: boolean;
  admin1Available: boolean;
  admin2Available: boolean;
}): DdsFeatureType | null {
  const hasLocality = countryHasLocalityCoverage(
    options.countryId,
    options.countryName
  );
  const hasAdmin1 = countryHasAdmin1Coverage(
    options.countryId,
    options.countryName
  );
  const code = normalizeCountryCode(options.countryId, options.countryName);
  const hasAdmin2 = !(code && NO_ADMIN2_COUNTRIES.has(code));

  if (hasLocality && options.localityAvailable) {
    return "LOCALITY";
  }
  if (hasAdmin1 && options.admin1Available) {
    return "ADMINISTRATIVE_AREA_LEVEL_1";
  }
  if (hasAdmin2 && options.admin2Available) {
    return "ADMINISTRATIVE_AREA_LEVEL_2";
  }
  if (options.countryAvailable) {
    return "COUNTRY";
  }
  return null;
}

/**
 * Pick a DDS feature type that can actually paint for this country.
 */
export function resolveUsableFeatureType(options: {
  preferred: DdsFeatureType;
  countryId?: string;
  countryName?: string;
  countryAvailable: boolean;
  localityAvailable: boolean;
  admin1Available: boolean;
  admin2Available: boolean;
  cityName?: string;
}): DdsFeatureType | null {
  const country = normalizeCountryCode(options.countryId, options.countryName);
  const hasLocality = countryHasLocalityCoverage(
    options.countryId,
    options.countryName
  );
  const hasAdmin1 = countryHasAdmin1Coverage(
    options.countryId,
    options.countryName
  );
  const countryBlocksAdmin2 = Boolean(
    country && NO_ADMIN2_COUNTRIES.has(country)
  );

  const tryOrder: DdsFeatureType[] = [];
  const pushUnique = (t: DdsFeatureType) => {
    if (!tryOrder.includes(t)) tryOrder.push(t);
  };

  pushUnique(options.preferred);
  if (options.preferred === "COUNTRY") {
    // already preferred
  } else if (options.preferred === "ADMINISTRATIVE_AREA_LEVEL_2") {
    pushUnique("ADMINISTRATIVE_AREA_LEVEL_1");
    pushUnique("LOCALITY");
    pushUnique("COUNTRY");
  } else if (options.preferred === "LOCALITY") {
    pushUnique("ADMINISTRATIVE_AREA_LEVEL_1");
    pushUnique("ADMINISTRATIVE_AREA_LEVEL_2");
    pushUnique("COUNTRY");
  } else {
    pushUnique("LOCALITY");
    pushUnique("ADMINISTRATIVE_AREA_LEVEL_2");
    pushUnique("COUNTRY");
  }

  for (const type of tryOrder) {
    if (type === "COUNTRY") {
      if (!options.countryAvailable) continue;
      if (type !== options.preferred) {
        devLog.warn(
          `[PinToTrip DDS] "${options.cityName ?? "city"}" has no city/region DDS coverage in ${(country || "?").toUpperCase()} — highlighting COUNTRY instead.`
        );
      }
      return type;
    }
    if (type === "ADMINISTRATIVE_AREA_LEVEL_2") {
      if (countryBlocksAdmin2) continue;
      if (!options.admin2Available) continue;
      return type;
    }
    if (type === "ADMINISTRATIVE_AREA_LEVEL_1") {
      if (!hasAdmin1) continue;
      if (!options.admin1Available) continue;
      return type;
    }
    if (type === "LOCALITY") {
      if (country && !hasLocality) continue;
      if (!options.localityAvailable) continue;
      return type;
    }
  }

  return null;
}
