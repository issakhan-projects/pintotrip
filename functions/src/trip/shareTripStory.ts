/**
 * shareTripStory — generate a 9:16 Instagram Story image summarizing a completed trip.
 *
 * Uses gpt-image-2.5-flare (quality=low) via the shared OpenAI client.
 * Stats and photo URLs come only from the trip + saved locations — never invented.
 */

import { randomUUID } from "crypto";
import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { toFile } from "openai";
import { requireAuth, assertNonEmptyString } from "../shared/auth";
import { DEFAULT_FUNCTIONS_REGION, openaiApiKey } from "../shared/config";
import { createOpenAIClient } from "../shared/openai";
import { recordAIUsage } from "../shared/aiUsage";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";
import {
  getRequiredCredits,
  type InsufficientAICreditsError,
} from "../shared/credits";
import { adminDb, adminStorage, initAdmin } from "../shared/admin";

const STORY_IMAGE_MODEL = "gpt-image-2.5-flare";
/** Exact 9:16; both edges divisible by 16 (gpt-image-2.5 size rules). */
const STORY_IMAGE_SIZE = "1152x2048";
const STORY_IMAGE_QUALITY = "low" as const;
const MAX_REFERENCE_PHOTOS = 4;
const OPERATION = "shareTripStory" as const;

type TripStop = {
  cityName?: string;
  countryName?: string;
  stopType?: string;
  photos?: string[];
};

type TripDoc = {
  name?: string;
  status?: string;
  startDate?: FirebaseFirestore.Timestamp;
  endDate?: FirebaseFirestore.Timestamp;
  photoUrl?: string;
  storyImageUrl?: string;
  destinations?: TripStop[];
  destination?: TripStop;
  savedPlaceIds?: string[];
  itinerary?: {
    days?: Array<{
      places?: Array<{
        locationId?: string;
        status?: string;
        type?: string;
        imageUrl?: string;
      }>;
    }>;
  };
};

type LocationDoc = {
  status?: string;
  images?: Array<{ url?: string }>;
};

export type ShareTripStoryRequest = {
  tripId: string;
  /** When true, regenerate even if storyImageUrl already exists. */
  forceRegenerate?: boolean;
};

export type ShareTripStoryStats = {
  destinationLabel: string;
  cityNames: string[];
  cityCount: number;
  dateLabel: string;
  dayCount: number;
  placesTotal: number;
  placesVisited: number;
  photoCount: number;
};

export type ShareTripStorySuccess = {
  success: true;
  imageUrl: string;
  /** PNG bytes for reliable client download/share (avoids Storage CORS/hangs). */
  imageBase64: string;
  cached: boolean;
  model: string;
  creditsCharged: number;
  remainingCredits: number;
  stats: ShareTripStoryStats;
};

export type ShareTripStoryResponse =
  | ShareTripStorySuccess
  | InsufficientAICreditsError;

function parseRequest(data: unknown): ShareTripStoryRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }
  const body = data as Record<string, unknown>;
  assertNonEmptyString(body.tripId, "tripId");
  return {
    tripId: body.tripId.trim(),
    forceRegenerate: body.forceRegenerate === true,
  };
}

function toDate(value: unknown): Date | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const d = (value as FirebaseFirestore.Timestamp).toDate();
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function dayCount(start: Date, end: Date): number {
  const s = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const e = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.floor((e - s) / 86_400_000) + 1);
}

function formatDateRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endFmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${fmt.format(start)} – ${endFmt.format(end)}`;
}

function listDestinations(trip: TripDoc): TripStop[] {
  if (Array.isArray(trip.destinations) && trip.destinations.length > 0) {
    return trip.destinations;
  }
  if (trip.destination?.cityName) return [trip.destination];
  return [];
}

function collectPhotoUrls(
  trip: TripDoc,
  locationsById: Map<string, LocationDoc>
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (url?: string) => {
    const t = url?.trim();
    if (!t || !/^https?:\/\//i.test(t) || seen.has(t)) return;
    seen.add(t);
    urls.push(t);
  };

  push(trip.photoUrl);
  for (const dest of listDestinations(trip)) {
    for (const photo of dest.photos ?? []) push(photo);
  }
  for (const day of trip.itinerary?.days ?? []) {
    for (const slot of day.places ?? []) {
      push(slot.imageUrl);
    }
  }
  for (const id of trip.savedPlaceIds ?? []) {
    const loc = locationsById.get(id);
    push(loc?.images?.[0]?.url);
  }

  return urls.slice(0, MAX_REFERENCE_PHOTOS);
}

function computeStats(
  trip: TripDoc,
  locationsById: Map<string, LocationDoc>
): ShareTripStoryStats {
  const destinations = listDestinations(trip).filter(
    (d) => d.stopType !== "home" && Boolean(d.cityName?.trim())
  );
  const cityNames = destinations
    .map((d) => d.cityName!.trim())
    .filter(Boolean);
  const uniqueCities = [...new Set(cityNames)];

  const start = toDate(trip.startDate);
  const end = toDate(trip.endDate);
  if (!start || !end) {
    throw new HttpsError(
      "failed-precondition",
      "Trip is missing startDate or endDate."
    );
  }

  const itinerarySlots = (trip.itinerary?.days ?? [])
    .flatMap((d) => d.places ?? [])
    .filter((slot) => {
      if (slot.type === "gap" || slot.type === "route") return false;
      if (slot.status === "cancelled") return false;
      const loc = slot.locationId
        ? locationsById.get(slot.locationId)
        : undefined;
      return loc?.status !== "cancelled";
    });

  let placesTotal = 0;
  let placesVisited = 0;
  if (itinerarySlots.length > 0) {
    const placeIds = new Set<string>();
    const visitedIds = new Set<string>();
    for (const slot of itinerarySlots) {
      const id = slot.locationId?.trim();
      if (!id) continue;
      placeIds.add(id);
      const loc = locationsById.get(id);
      if (slot.status === "visited" || loc?.status === "visited") {
        visitedIds.add(id);
      }
    }
    placesTotal = placeIds.size;
    placesVisited = visitedIds.size;
  } else {
    const saved = (trip.savedPlaceIds ?? []).filter((id) => {
      const loc = locationsById.get(id);
      return !loc || loc.status !== "cancelled";
    });
    placesTotal = saved.length;
    placesVisited = saved.filter(
      (id) => locationsById.get(id)?.status === "visited"
    ).length;
  }

  const destinationLabel =
    uniqueCities.join(" · ") ||
    trip.name?.trim() ||
    destinations[0]?.countryName?.trim() ||
    "Trip";

  const photos = collectPhotoUrls(trip, locationsById);

  return {
    destinationLabel,
    cityNames: uniqueCities,
    cityCount: uniqueCities.length,
    dateLabel: formatDateRange(start, end),
    dayCount: dayCount(start, end),
    placesTotal,
    placesVisited,
    photoCount: photos.length,
  };
}

function buildPrompt(stats: ShareTripStoryStats): string {
  const citiesLine =
    stats.cityNames.length > 0
      ? stats.cityNames.join(", ")
      : stats.destinationLabel;

  return [
    "Create a single vertical Instagram Story travel summary card (9:16).",
    "Beautiful cinematic travel-themed composition with elegant typography.",
    "Brand: PinToTrip — include subtle PinToTrip wordmark branding (not a fake logo mark).",
    "",
    "Use ONLY these exact trip facts — do not invent cities, dates, or counts:",
    `- Destination / cities: ${citiesLine}`,
    `- Dates: ${stats.dateLabel}`,
    `- Days: ${stats.dayCount}`,
    `- Cities: ${stats.cityCount}`,
    `- Places visited: ${stats.placesVisited}${stats.placesTotal > 0 ? ` of ${stats.placesTotal}` : ""}`,
    "",
    stats.photoCount > 0
      ? "Incorporate the provided reference trip photos tastefully into the collage/layout (do not invent extra photo scenes)."
      : "No trip photos were provided — use an abstract travel atmosphere for this destination without inventing specific landmarks not implied by the city names.",
    "",
    "Layout ideas: bold city title, date line, compact stats row (days / cities / places), photo collage if photos exist, PinToTrip at the bottom.",
    "High-end editorial travel poster feel. No QR codes. No fake UI chrome. No watermarks other than PinToTrip branding.",
  ].join("\n");
}

async function loadLocations(
  uid: string,
  savedPlaceIds: string[]
): Promise<Map<string, LocationDoc>> {
  const map = new Map<string, LocationDoc>();
  const ids = [...new Set(savedPlaceIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return map;

  const db = adminDb();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const refs = chunk.map((id) => db.doc(`users/${uid}/locations/${id}`));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      map.set(snap.id, snap.data() as LocationDoc);
    }
  }
  return map;
}

async function fetchReferenceFiles(urls: string[]) {
  const files = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i]!;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > 45 * 1024 * 1024) continue;
      const ext = contentType.includes("png")
        ? "png"
        : contentType.includes("webp")
          ? "webp"
          : "jpg";
      files.push(
        await toFile(buf, `trip-photo-${i + 1}.${ext}`, { type: contentType })
      );
    } catch (err) {
      logger.warn("shareTripStory: skip photo fetch", {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return files;
}

function storyStoragePath(uid: string, tripId: string): string {
  return `users/${uid}/tripPlanner/${tripId}/story.png`;
}

async function uploadStoryImage(
  uid: string,
  tripId: string,
  pngBytes: Buffer
): Promise<string> {
  const bucket = adminStorage().bucket();
  const path = storyStoragePath(uid, tripId);
  const file = bucket.file(path);
  const token = randomUUID();
  await file.save(pngBytes, {
    contentType: "image/png",
    resumable: false,
    metadata: {
      cacheControl: "public,max-age=3600",
      metadata: {
        firebaseStorageDownloadTokens: token,
        generatedBy: "shareTripStory",
        model: STORY_IMAGE_MODEL,
      },
    },
  });

  return (
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
    `${encodeURIComponent(path)}?alt=media&token=${token}`
  );
}

async function readStoryImageBase64(
  uid: string,
  tripId: string
): Promise<string | null> {
  try {
    const file = adminStorage().bucket().file(storyStoragePath(uid, tripId));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    if (!buf?.length) return null;
    return buf.toString("base64");
  } catch (err) {
    logger.warn("shareTripStory: read cached story bytes failed", {
      uid,
      tripId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function estimateImageCost(usage?: {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
} | null): number {
  if (!usage) return 0.02;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  // Rough observability estimate for image tokens.
  const cost = (input / 1_000_000) * 5 + (output / 1_000_000) * 40;
  return Math.round(Math.max(cost, 0.005) * 1_000_000) / 1_000_000;
}

function mapOpenAIError(err: unknown): HttpsError {
  const message =
    err instanceof Error ? err.message : "Trip story image generation failed.";
  if (/OPENAI_API_KEY/i.test(message)) {
    return new HttpsError(
      "failed-precondition",
      "OPENAI_API_KEY is not configured for Cloud Functions."
    );
  }
  return new HttpsError("internal", message);
}

/**
 * shareTripStory
 *
 * 1. Auth + load trip
 * 2. Return cached storyImageUrl when present (unless forceRegenerate)
 * 3. Assert AI credits
 * 4. Generate 9:16 story with gpt-image-2.5-flare (quality=low)
 * 5. Upload to Storage, persist storyImageUrl, deduct credits
 */
export const shareTripStory = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey],
    invoker: "public",
    cors: true,
    timeoutSeconds: 180,
    memory: "1GiB",
  },
  async (request): Promise<ShareTripStoryResponse> => {
    initAdmin();
    const uid = requireAuth(request);
    const input = parseRequest(request.data);

    const tripRef = adminDb().doc(`users/${uid}/tripPlanner/${input.tripId}`);
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) {
      throw new HttpsError("not-found", "Trip not found.");
    }
    const trip = tripSnap.data() as TripDoc;
    if (trip.status === "cancelled") {
      throw new HttpsError(
        "failed-precondition",
        "Cancelled trips cannot be shared."
      );
    }

    const end = toDate(trip.endDate);
    const isCompleted =
      trip.status === "completed" ||
      (end != null && end.getTime() < Date.now());
    if (!isCompleted) {
      throw new HttpsError(
        "failed-precondition",
        "Share trip is available after the trip is completed."
      );
    }

    if (trip.storyImageUrl?.trim() && !input.forceRegenerate) {
      const locationsById = await loadLocations(uid, trip.savedPlaceIds ?? []);
      const stats = computeStats(trip, locationsById);
      const cachedBase64 = await readStoryImageBase64(uid, input.tripId);
      if (!cachedBase64) {
        // Stored URL exists but file missing — fall through to regenerate.
      } else {
        return {
          success: true,
          imageUrl: trip.storyImageUrl.trim(),
          imageBase64: cachedBase64,
          cached: true,
          model: STORY_IMAGE_MODEL,
          creditsCharged: 0,
          remainingCredits: 0,
          stats,
        };
      }
    }

    const creditCheck = await assertSufficientCredits(uid, OPERATION);
    if (!creditCheck.ok) {
      return creditCheck.response;
    }

    const locationsById = await loadLocations(uid, trip.savedPlaceIds ?? []);
    const stats = computeStats(trip, locationsById);
    const photoUrls = collectPhotoUrls(trip, locationsById);
    const prompt = buildPrompt(stats);

    logger.info("shareTripStory generate", {
      uid,
      tripId: input.tripId,
      cityCount: stats.cityCount,
      dayCount: stats.dayCount,
      placesVisited: stats.placesVisited,
      photoCount: photoUrls.length,
      forceRegenerate: Boolean(input.forceRegenerate),
    });

    let imageB64: string | undefined;
    let usage: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    } | null = null;

    try {
      const client = createOpenAIClient();
      const files = await fetchReferenceFiles(photoUrls);

      if (files.length > 0) {
        const edited = await client.images.edit({
          model: STORY_IMAGE_MODEL,
          image: files,
          prompt,
          quality: STORY_IMAGE_QUALITY,
          size: STORY_IMAGE_SIZE,
          output_format: "png",
          background: "opaque",
        });
        imageB64 = edited.data?.[0]?.b64_json;
        usage = edited.usage ?? null;
      } else {
        const generated = await client.images.generate({
          model: STORY_IMAGE_MODEL,
          prompt,
          quality: STORY_IMAGE_QUALITY,
          size: STORY_IMAGE_SIZE,
          output_format: "png",
          background: "opaque",
          n: 1,
        });
        imageB64 = generated.data?.[0]?.b64_json;
        usage = generated.usage ?? null;
      }
    } catch (err) {
      logger.error("shareTripStory OpenAI failed", {
        uid,
        tripId: input.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw mapOpenAIError(err);
    }

    if (!imageB64) {
      throw new HttpsError(
        "internal",
        "Image model returned an empty story image."
      );
    }

    const pngBytes = Buffer.from(imageB64, "base64");
    let imageUrl: string;
    try {
      imageUrl = await uploadStoryImage(uid, input.tripId, pngBytes);
    } catch (err) {
      logger.error("shareTripStory upload failed", {
        uid,
        tripId: input.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError(
        "internal",
        "Could not store the generated story image."
      );
    }

    await tripRef.set(
      {
        storyImageUrl: imageUrl,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const remainingCredits = await deductCredits(uid, OPERATION);
    const cost = estimateImageCost(usage);
    await recordAIUsage({
      operation: OPERATION,
      cost,
      userId: uid,
    });

    return {
      success: true,
      imageUrl,
      imageBase64: imageB64,
      cached: false,
      model: STORY_IMAGE_MODEL,
      creditsCharged: getRequiredCredits(OPERATION),
      remainingCredits,
      stats,
    };
  }
);
