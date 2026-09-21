import {
  PLACE_PHOTOS_TTL_MS,
  cachedRequest,
  normalizeQuery,
} from "@/lib/maps/requestCache";

export type PexelsPhoto = {
  url: string;
  photographer?: string | null;
  photographerUrl?: string | null;
  pexelsUrl?: string | null;
};

export type PexelsCityPhoto = PexelsPhoto;

/**
 * Fetch a landscape photo from Pexels (via /api/pexels/photo).
 * Returns null when unconfigured, rate-limited, or no match.
 */
export async function fetchPexelsPhoto(input: {
  query: string;
  page?: number;
}): Promise<PexelsPhoto | null> {
  const query = input.query.trim();
  if (!query) return null;

  const page = Math.min(80, Math.max(1, input.page ?? 1));
  const key = `pexels:photo:${normalizeQuery(query)}:p${page}`;

  try {
    return await cachedRequest(key, PLACE_PHOTOS_TTL_MS, async () => {
      const params = new URLSearchParams({
        query,
        page: String(page),
      });
      const res = await fetch(`/api/pexels/photo?${params.toString()}`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        url?: string | null;
        photographer?: string | null;
        photographerUrl?: string | null;
        pexelsUrl?: string | null;
      };
      const url = data.url?.trim();
      if (!url) return null;
      return {
        url,
        photographer: data.photographer ?? null,
        photographerUrl: data.photographerUrl ?? null,
        pexelsUrl: data.pexelsUrl ?? null,
      };
    });
  } catch {
    return null;
  }
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
