/**
 * Temporary Wikimedia Commons photo lookup (PlacePreviewSheet).
 * Prefer this over Pexels until stock-photo sourcing is finalized.
 *
 * Search queries are always English — Commons indexing is English-heavy, and
 * localized place titles (AR/RU/…) rarely match file descriptions.
 */

import { isAsciiId, slugifyId } from "@/lib/utils";
import {
  resolveEnglishPlaceIds,
  resolveEnglishPlaceIdsFromAddress,
} from "@/lib/maps/detectLocation";
import {
  geocodeByAddress,
  geocodeByLocation,
  hasUsableMapCoords,
} from "@/lib/maps/geocode";
import {
  PLACE_PHOTOS_TTL_MS,
  cachedRequest,
  normalizeQuery,
} from "@/lib/maps/requestCache";

export type WikimediaPhoto = {
  url: string;
  /** Commons page / file title when available. */
  title?: string | null;
  pageId?: number | null;
  artist?: string | null;
  license?: string | null;
  commonsUrl?: string | null;
};

type CommonsImageInfo = {
  url?: string;
  thumburl?: string;
  mime?: string;
  extmetadata?: {
    Artist?: { value?: string };
    LicenseShortName?: { value?: string };
  };
};

type CommonsPage = {
  pageid?: number;
  title?: string;
  imageinfo?: CommonsImageInfo[];
};

type CommonsSearchResponse = {
  query?: {
    pages?: Record<string, CommonsPage>;
  };
};

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Latin / ASCII-friendly enough to search Commons (not AR/Cyrillic/CJK, …). */
function isEnglishSearchable(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isAsciiId(slugifyId(trimmed));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function buildPhotoQuery(parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => p?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

export function wikimediaPhotoUrlExcludeId(url: string): string {
  return `wikimedia:url:${normalizeQuery(url)}`;
}

function photoIsExcluded(
  photo: WikimediaPhoto,
  exclude?: ReadonlySet<string>
): boolean {
  if (!exclude || exclude.size === 0) return false;
  if (exclude.has(wikimediaPhotoUrlExcludeId(photo.url))) return true;
  if (photo.pageId != null && exclude.has(`wikimedia:id:${photo.pageId}`)) {
    return true;
  }
  return false;
}

const POI_TYPES = new Set([
  "point_of_interest",
  "establishment",
  "premise",
  "tourist_attraction",
  "natural_feature",
  "park",
  "museum",
  "place_of_worship",
]);

function englishTitleFromGeocode(
  results: google.maps.GeocoderResult[]
): string | null {
  for (const result of results) {
    const isPoi = result.types?.some((t) => POI_TYPES.has(t));
    if (!isPoi) continue;
    const fromComponent = result.address_components?.[0]?.long_name?.trim();
    if (fromComponent && isEnglishSearchable(fromComponent)) {
      return fromComponent;
    }
    const beforeComma = result.formatted_address?.split(",")[0]?.trim();
    if (beforeComma && isEnglishSearchable(beforeComma)) {
      return beforeComma;
    }
  }

  const first = results[0]?.formatted_address?.split(",")[0]?.trim();
  if (first && isEnglishSearchable(first)) return first;
  return null;
}

/**
 * Force English query terms for Commons search regardless of UI locale.
 */
async function resolveEnglishSearchTerms(input: {
  title: string;
  cityName: string;
  countryName?: string;
  lat?: number;
  lon?: number;
}): Promise<{ title: string; cityName: string; countryName: string }> {
  let title = input.title.trim();
  let cityName = input.cityName.trim();
  let countryName = input.countryName?.trim() ?? "";

  const lat = input.lat;
  const lon = input.lon;
  const hasCoords = hasUsableMapCoords(lat, lon);

  if (hasCoords) {
    const ids = await resolveEnglishPlaceIds(lat!, lon!);
    if (ids) {
      cityName = ids.cityNameEn || cityName;
      countryName = ids.countryNameEn || countryName;
    }
  } else if (
    !isEnglishSearchable(cityName) ||
    (countryName && !isEnglishSearchable(countryName))
  ) {
    try {
      const fromAddress = await resolveEnglishPlaceIdsFromAddress(
        buildPhotoQuery([cityName, countryName])
      );
      if (fromAddress) {
        cityName = fromAddress.cityNameEn || cityName;
        countryName = fromAddress.countryNameEn || countryName;
      }
    } catch {
      /* keep originals; filtered below */
    }
  }

  if (!isEnglishSearchable(title)) {
    const address = buildPhotoQuery([title, cityName, countryName]);
    try {
      const results = await geocodeByAddress(address, { language: "en" });
      const enTitle = englishTitleFromGeocode(results);
      if (enTitle) {
        title = enTitle;
      } else if (hasCoords) {
        const near = await geocodeByLocation(lat!, lon!, { language: "en" });
        title = englishTitleFromGeocode(near) || cityName || title;
      } else {
        title = cityName || title;
      }
    } catch {
      if (hasCoords) {
        try {
          const near = await geocodeByLocation(lat!, lon!, { language: "en" });
          title = englishTitleFromGeocode(near) || cityName || title;
        } catch {
          title = cityName || title;
        }
      } else {
        title = cityName || title;
      }
    }
  }

  // Drop leftover non-English parts so we never send them to Commons.
  if (!isEnglishSearchable(cityName)) cityName = "";
  if (!isEnglishSearchable(countryName)) countryName = "";
  if (!isEnglishSearchable(title)) title = cityName;

  return { title, cityName, countryName };
}

/**
 * Search Wikimedia Commons for landscape-friendly bitmap photos.
 * Query must already be English (callers use resolveEnglishSearchTerms).
 * Returns [] when the API fails or nothing matches.
 */
export async function fetchWikimediaPhotos(input: {
  query: string;
  limit?: number;
}): Promise<WikimediaPhoto[]> {
  const query = input.query.trim();
  if (!query) return [];

  const limit = Math.min(20, Math.max(1, input.limit ?? 10));
  const key = `wikimedia:photos:${normalizeQuery(query)}:n${limit}`;

  try {
    return await cachedRequest(key, PLACE_PHOTOS_TTL_MS, async () => {
      // filetype:bitmap skips SVG diagrams / maps that dominate many place queries.
      // uselang=en keeps extmetadata labels English when present.
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        origin: "*",
        uselang: "en",
        generator: "search",
        gsrnamespace: "6",
        gsrsearch: `${query} filetype:bitmap`,
        gsrlimit: String(limit),
        prop: "imageinfo",
        iiprop: "url|mime|size|extmetadata",
        iiurlwidth: "1280",
      });

      const res = await fetch(
        `https://commons.wikimedia.org/w/api.php?${params.toString()}`
      );
      if (!res.ok) return [];

      const data = (await res.json()) as CommonsSearchResponse;
      const pages = data.query?.pages;
      if (!pages) return [];

      return Object.values(pages).flatMap((page): WikimediaPhoto[] => {
        const info = page.imageinfo?.[0];
        if (!info) return [];
        const mime = info.mime?.toLowerCase().trim() ?? "";
        if (mime && !ALLOWED_MIME.has(mime)) return [];

        const url = (info.thumburl || info.url)?.trim();
        if (!url) return [];

        const title = page.title?.trim() || null;
        const artistRaw = info.extmetadata?.Artist?.value;
        const licenseRaw = info.extmetadata?.LicenseShortName?.value;

        return [
          {
            url,
            title,
            pageId: page.pageid ?? null,
            artist: artistRaw ? stripHtml(artistRaw) : null,
            license: licenseRaw ? stripHtml(licenseRaw) : null,
            commonsUrl: title
              ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(
                  title.replace(/ /g, "_")
                )}`
              : null,
          },
        ];
      });
    });
  } catch {
    return [];
  }
}

export async function fetchWikimediaPhoto(input: {
  query: string;
}): Promise<WikimediaPhoto | null> {
  const photos = await fetchWikimediaPhotos({
    query: input.query,
    limit: 1,
  });
  return photos[0] ?? null;
}

/**
 * City/country hero image (trip covers, destination chips).
 * Resolves English search terms so Commons matches reliably.
 */
export async function fetchWikimediaCityPhoto(input: {
  cityName: string;
  countryName?: string;
  lat?: number;
  lon?: number;
}): Promise<WikimediaPhoto | null> {
  const english = await resolveEnglishSearchTerms({
    title: input.cityName,
    cityName: input.cityName,
    countryName: input.countryName,
    lat: input.lat,
    lon: input.lon,
  });
  const city = english.cityName || english.title;
  if (!city) return null;
  const query = buildPhotoQuery([city, english.countryName]);
  if (!query) return null;
  return fetchWikimediaPhoto({ query });
}

/**
 * Resolve a Commons photo for a named place (title-first, then city context).
 * Always searches with English terms — ignores UI / profile language.
 * Skips URLs already on the place when `excludePlaceIds` is provided.
 */
export async function fetchSuggestedWikimediaPlacePhoto(input: {
  title: string;
  cityName: string;
  countryName?: string;
  lat?: number;
  lon?: number;
  excludePlaceIds?: ReadonlySet<string>;
}): Promise<{ photoUrl: string; placeId: string } | null> {
  const english = await resolveEnglishSearchTerms({
    title: input.title,
    cityName: input.cityName,
    countryName: input.countryName,
    lat: input.lat,
    lon: input.lon,
  });

  const title = english.title;
  const cityName = english.cityName;
  if (!title && !cityName) return null;

  const queries = [
    title,
    buildPhotoQuery([title, cityName]),
    buildPhotoQuery([title, cityName, english.countryName]),
    // City-only fallback when the landmark name still fails on Commons.
    buildPhotoQuery([cityName, english.countryName]),
  ].filter((q, i, arr) => q.length > 0 && arr.indexOf(q) === i);

  const exclude = input.excludePlaceIds;

  for (const query of queries) {
    const photos = await fetchWikimediaPhotos({ query, limit: 10 });
    for (const photo of photos) {
      if (!photo.url) continue;
      if (photoIsExcluded(photo, exclude)) continue;
      const placeId =
        photo.pageId != null
          ? `wikimedia:id:${photo.pageId}`
          : wikimediaPhotoUrlExcludeId(photo.url);
      return { photoUrl: photo.url, placeId };
    }
  }

  return null;
}
