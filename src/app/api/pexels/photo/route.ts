import { NextResponse } from "next/server";

export const runtime = "nodejs";

type PexelsPhoto = {
  url?: string;
  photographer?: string;
  photographer_url?: string;
  src?: {
    large?: string;
    landscape?: string;
    medium?: string;
    original?: string;
  };
};

type PexelsSearchResponse = {
  photos?: PexelsPhoto[];
};

/**
 * Resolve a city/place hero image via Pexels search.
 * Keeps PEXELS_API_KEY server-side — never expose via NEXT_PUBLIC_*.
 */
export async function GET(request: Request) {
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Pexels is not configured." },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();
  if (!query || query.length > 200) {
    return NextResponse.json(
      { error: "Missing or invalid query." },
      { status: 400 }
    );
  }

  const pageRaw = searchParams.get("page");
  const page = Math.min(
    80,
    Math.max(1, Number.parseInt(pageRaw || "1", 10) || 1)
  );

  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("per_page", "1");
  url.searchParams.set("page", String(page));

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Authorization: apiKey },
      next: { revalidate: 60 * 60 * 24 },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach Pexels." },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Pexels search failed." },
      { status: upstream.status === 429 ? 429 : 502 }
    );
  }

  const data = (await upstream.json()) as PexelsSearchResponse;
  const photo = data.photos?.[0];
  const imageUrl =
    photo?.src?.large ||
    photo?.src?.landscape ||
    photo?.src?.medium ||
    photo?.src?.original ||
    null;

  if (!imageUrl) {
    return NextResponse.json({ url: null });
  }

  return NextResponse.json({
    url: imageUrl,
    photographer: photo?.photographer ?? null,
    photographerUrl: photo?.photographer_url ?? null,
    pexelsUrl: photo?.url ?? null,
  });
}
