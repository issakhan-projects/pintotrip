import {
  PLACE_PHOTOS_TTL_MS,
  cachedRequest,
  normalizeQuery,
} from "@/lib/maps/requestCache";

export type PexelsPhoto = {
  url: string;
  /** Pexels photo id when available — stable for dedupe across queries. */
  id?: number | null;
  photographer?: string | null;
  photographerUrl?: string | null;
  pexelsUrl?: string | null;
};

export type PexelsCityPhoto = PexelsPhoto;

type PexelsApiPhoto = {
  id?: number | null;
  url?: string | null;
  photographer?: string | null;
  photographerUrl?: string | null;
  pexelsUrl?: string | null;
};

/**
 * Fetch landscape photo(s) from Pexels (via /api/pexels/photo).
 * Returns [] when unconfigured, rate-limited, or no match.
 */
export async function fetchPexelsPhotos(input: {
  query: string;
  page?: number;
  perPage?: number;
}): Promise<PexelsPhoto[]> {
  const query = input.query.trim();
  if (!query) return [];

  const page = Math.min(80, Math.max(1, input.page ?? 1));
  const perPage = Math.min(15, Math.max(1, input.perPage ?? 1));
  const key = `pexels:photos:${normalizeQuery(query)}:p${page}:n${perPage}`;

  try {
    return await cachedRequest(key, PLACE_PHOTOS_TTL_MS, async () => {
      const params = new URLSearchParams({
        query,
        page: String(page),
        per_page: String(perPage),
      });
      const res = await fetch(`/api/pexels/photo?${params.toString()}`);
      if (!res.ok) return [];
      const data = (await res.json()) as {
        url?: string | null;
        photographer?: string | null;
        photographerUrl?: string | null;
        pexelsUrl?: string | null;
        photos?: PexelsApiPhoto[];
      };

      if (Array.isArray(data.photos) && data.photos.length > 0) {
        return data.photos
          .map((photo) => {
            const url = photo.url?.trim();
            if (!url) return null;
            return {
              url,
              id: photo.id ?? null,
              photographer: photo.photographer ?? null,
              photographerUrl: photo.photographerUrl ?? null,
              pexelsUrl: photo.pexelsUrl ?? null,
            } satisfies PexelsPhoto;
          })
          .filter((p): p is PexelsPhoto => p != null);
      }

      const url = data.url?.trim();
      if (!url) return [];
      return [
        {
          url,
          photographer: data.photographer ?? null,
          photographerUrl: data.photographerUrl ?? null,
          pexelsUrl: data.pexelsUrl ?? null,
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Fetch a single landscape photo from Pexels (via /api/pexels/photo).
 * Returns null when unconfigured, rate-limited, or no match.
 */
export async function fetchPexelsPhoto(input: {
  query: string;
  page?: number;
}): Promise<PexelsPhoto | null> {
  const photos = await fetchPexelsPhotos({
    query: input.query,
    page: input.page,
    perPage: 1,
  });
  return photos[0] ?? null;
}

/**
 * City/country hero image (City Intelligence and similar).
 */
export async function fetchPexelsCityPhoto(input: {
  cityName: string;
  countryName?: string;
}): Promise<PexelsPhoto | null> {
  const city = input.cityName.trim();
  if (!city) return null;
  const country = input.countryName?.trim() || "";
  return fetchPexelsPhoto({
    query: [city, country].filter(Boolean).join(" "),
  });
}
