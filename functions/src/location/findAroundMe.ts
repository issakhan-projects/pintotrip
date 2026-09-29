/**
 * findAroundMe — Nearby Search + GPT enrichment → locations-shaped places.
 *
 * 1. Auth + validate type / coords
 * 2. Assert 50 AI credits BEFORE Places / OpenAI
 * 3. Google Places nearby/text search (max 10)
 * 4. GPT fills description / why / category / price / links (locations shape)
 * 5. Persist coords to placesLocation cache (same as planTrip enrich)
 * 6. Deduct credits + record aiUsage on success
 */

import { onCall, HttpsError } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { requireAuth } from "../shared/auth";
import {
  DEFAULT_FUNCTIONS_REGION,
  googlePrivateApiKey,
  openaiApiKey,
} from "../shared/config";
import { createOpenAIAroundMeEnricher } from "../shared/openai";
import { recordAIUsage } from "../shared/aiUsage";
import {
  assertSufficientCredits,
  deductCredits,
} from "../shared/creditService";
import type { InsufficientAICreditsError } from "../shared/credits";
import { initAdmin } from "../shared/admin";
import { resolveEnglishPlaceIdsFromCoords } from "../shared/resolveEnglishPlaceIds";
import {
  resolvePlaceDocId,
  resolvePlacesLocationIds,
  setPlaceLocation,
} from "../shared/placesLocation";
import {
  isAroundMeRadiusKm,
  isAroundMeTypeId,
  DEFAULT_AROUND_ME_RADIUS_KM,
  type AroundMeTypeId,
} from "./aroundMeTypes";
import {
  nearbySearchAroundMe,
  type NearbyPlaceHit,
} from "./nearbySearch";
import {
  extractAroundMeJsonObject,
  parseAroundMePlaces,
  placesFromHits,
} from "./parseAroundMeResponse";
import type {
  AroundMePlaceResult,
  FindAroundMeRequest,
  FindAroundMeSuccess,
} from "./aroundMeResultTypes";

export type FindAroundMeResponse =
  | FindAroundMeSuccess
  | InsufficientAICreditsError;

function parseRequest(data: unknown): FindAroundMeRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body is required.");
  }
  const body = data as Record<string, unknown>;
  const lat = typeof body.lat === "number" ? body.lat : NaN;
  const lon = typeof body.lon === "number" ? body.lon : NaN;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Valid lat and lon are required."
    );
  }

  const typeIdRaw =
    typeof body.typeId === "string" ? body.typeId.trim() : "";
  if (!isAroundMeTypeId(typeIdRaw)) {
    throw new HttpsError(
      "invalid-argument",
      "typeId must be a valid Around Me type."
    );
  }

  const language =
    typeof body.language === "string" && body.language.trim()
      ? body.language.trim()
      : undefined;

  const radiusRaw =
    typeof body.radiusKm === "number"
      ? body.radiusKm
      : typeof body.radiusKm === "string"
        ? Number(body.radiusKm)
        : DEFAULT_AROUND_ME_RADIUS_KM;
  if (!isAroundMeRadiusKm(radiusRaw)) {
    throw new HttpsError(
      "invalid-argument",
      "radiusKm must be one of 5, 10, 20, or 30."
    );
  }

  const cityId =
    typeof body.cityId === "string" && body.cityId.trim()
      ? body.cityId.trim().toLowerCase()
      : undefined;
  const countryId =
    typeof body.countryId === "string" && body.countryId.trim()
      ? body.countryId.trim().toLowerCase()
      : undefined;
  const cityName =
    typeof body.cityName === "string" && body.cityName.trim()
      ? body.cityName.trim()
      : undefined;
  const countryName =
    typeof body.countryName === "string" && body.countryName.trim()
      ? body.countryName.trim()
      : undefined;

  return {
    lat,
    lon,
    typeId: typeIdRaw as AroundMeTypeId,
    radiusKm: radiusRaw,
    language,
    ...(cityId ? { cityId } : {}),
    ...(countryId ? { countryId } : {}),
    ...(cityName ? { cityName } : {}),
    ...(countryName ? { countryName } : {}),
  };
}

function mapOpenAIError(err: unknown): HttpsError {
  const message =
    err instanceof Error ? err.message : "Around Me search failed.";

  if (/OPENAI_API_KEY/i.test(message)) {
    return new HttpsError(
      "failed-precondition",
      "OPENAI_API_KEY is not configured for Cloud Functions."
    );
  }
  if (/GOOGLE_PRIVATE_API_KEY/i.test(message)) {
    return new HttpsError(
      "failed-precondition",
      "GOOGLE_PRIVATE_API_KEY is not configured for Cloud Functions."
    );
  }
  if (
    /Invalid|missing|not an object|empty|valid JSON|Expected|JSON/i.test(
      message
    )
  ) {
    return new HttpsError(
      "internal",
      "The Around Me model returned an invalid response. Please try again."
    );
  }
  return new HttpsError("internal", message);
}

/**
 * Upsert Around Me places into placesLocation/{countryId}/locations/{cityId}/places/{placeDocId}.
 * Soft-fails per place — same pattern as planTrip enrichPlaceCoordinates.
 */
async function cacheAroundMePlaces(
  places: AroundMePlaceResult[],
  hitsByGoogleId: Map<string, NearbyPlaceHit>
): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;

  await Promise.all(
    places.map(async (place) => {
      const ids = resolvePlacesLocationIds({
        cityName: place.city.name,
        countryName: place.country.name,
        cityId: place.city.id,
        countryId: place.country.id,
      });
      if (!ids) {
        skipped += 1;
        return;
      }

      const placeDocId = resolvePlaceDocId({
        placeSlug: place.id,
        placeId: place.googlePlaceId,
        title: place.title,
      });
      if (!placeDocId) {
        skipped += 1;
        return;
      }

      const hit = hitsByGoogleId.get(place.googlePlaceId);
      // Nearby Search used languageCode=en — title is English when available.
      const titleEn = hit?.title?.trim() || undefined;

      try {
        await setPlaceLocation({
          ids,
          placeDocId,
          input: {
            title: place.title,
            placeSlug: place.id,
            cityName: place.city.name,
            countryName: place.country.name,
            cityId: place.city.id || ids.locationId,
            countryId: place.country.id || ids.countryId,
          },
          place: {
            id: place.id,
            title: place.title.trim(),
            location: { lat: place.lat, lon: place.lon },
            ...(place.googlePlaceId
              ? { placeId: place.googlePlaceId }
              : {}),
            ...(titleEn ? { titleEn, displayName: titleEn } : {}),
            ...(hit?.address ? { address: hit.address } : {}),
          },
        });
        saved += 1;
      } catch (err) {
        skipped += 1;
        logger.warn("findAroundMe placesLocation save failed", {
          placeId: place.googlePlaceId,
          placeDocId,
          countryId: ids.countryId,
          locationId: ids.locationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  return { saved, skipped };
}

export const findAroundMe = onCall(
  {
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [openaiApiKey, googlePrivateApiKey],
    invoker: "public",
    cors: true,
    timeoutSeconds: 180,
    memory: "512MiB",
  },
  async (request): Promise<FindAroundMeResponse> => {
    initAdmin();
    const uid = requireAuth(request);
    const input = parseRequest(request.data);
    const language = input.language?.trim() || "en";
    const started = Date.now();

    const creditCheck = await assertSufficientCredits(uid, "findAroundMe");
    if (!creditCheck.ok) {
      return creditCheck.response;
    }

    try {
      // Prefer client-resolved English/ASCII ids (Maps JS geocoder), then
      // server Geocoding API. Country alone is enough to proceed.
      const englishIds = await resolveEnglishPlaceIdsFromCoords(
        input.lat,
        input.lon
      );

      const countryIdHint =
        input.countryId && /^[a-z]{2}$/.test(input.countryId)
          ? input.countryId
          : "";
      const cityIdHint =
        input.cityId &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.cityId) &&
        input.cityId !== "unknown"
          ? input.cityId
          : "";

      const fallback = {
        cityId:
          cityIdHint ||
          englishIds?.cityId ||
          "nearby",
        cityName:
          input.cityName?.trim() ||
          englishIds?.cityNameEn ||
          "Nearby",
        countryId:
          countryIdHint ||
          englishIds?.countryId ||
          "",
        countryName:
          input.countryName?.trim() ||
          englishIds?.countryNameEn ||
          "Unknown",
      };

      if (!/^[a-z]{2}$/.test(fallback.countryId) || fallback.countryId === "xx") {
        throw new HttpsError(
          "failed-precondition",
          "Could not determine your country from this location. Pick a spot on land or try current location again."
        );
      }

      logger.info("findAroundMe location context", {
        uid,
        lat: input.lat,
        lon: input.lon,
        radiusKm: input.radiusKm,
        cityId: fallback.cityId,
        countryId: fallback.countryId,
        cityName: fallback.cityName,
        countryName: fallback.countryName,
      });

      const hits = await nearbySearchAroundMe({
        lat: input.lat,
        lon: input.lon,
        typeId: input.typeId,
        radiusKm: input.radiusKm,
        cityName: fallback.cityName,
        countryName: fallback.countryName,
      });

      if (hits.length === 0) {
        throw new HttpsError(
          "not-found",
          "No places found nearby for that type. Try another type or move closer to a city center."
        );
      }

      const enricher = createOpenAIAroundMeEnricher();
      let parsed: AroundMePlaceResult[] = [];
      let metrics = { model: "findAroundMe", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, cost: 0 };

      try {
        const enriched = await enricher.enrich({
          language,
          typeId: input.typeId,
          cityNameEn: fallback.cityName,
          countryNameEn: fallback.countryName,
          countryId: fallback.countryId,
          cityId: fallback.cityId,
          userLat: input.lat,
          userLon: input.lon,
          placesJson: JSON.stringify(
            hits.map((h) => ({
              googlePlaceId: h.googlePlaceId,
              title: h.title,
              lat: h.lat,
              lon: h.lon,
              address: h.address ?? null,
              types: h.types ?? [],
              googleMapsUri: h.googleMapsUri ?? null,
              rating: h.rating ?? null,
              userRatingCount: h.userRatingCount ?? null,
              distanceM: h.distanceM ?? null,
            }))
          ),
        });
        metrics = enriched.metrics;

        try {
          parsed = parseAroundMePlaces(
            extractAroundMeJsonObject(enriched.text),
            hits,
            fallback
          );
        } catch (parseErr) {
          logger.warn("findAroundMe GPT JSON parse failed — using Places hits", {
            uid,
            error:
              parseErr instanceof Error ? parseErr.message : String(parseErr),
            textTail: enriched.text.slice(-400),
          });
        }
      } catch (enrichErr) {
        logger.warn("findAroundMe GPT enrich failed — using Places hits", {
          uid,
          error:
            enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
        });
      }

      if (parsed.length === 0) {
        parsed = placesFromHits(hits, fallback);
      }

      if (parsed.length === 0) {
        throw new HttpsError(
          "failed-precondition",
          "Could not resolve city/country for nearby places. Check location permission and try again."
        );
      }

      const hitsByGoogleId = new Map(
        hits.map((h) => [h.googlePlaceId, h] as const)
      );
      const cacheResult = await cacheAroundMePlaces(parsed, hitsByGoogleId);

      await deductCredits(uid, "findAroundMe");
      await recordAIUsage({
        userId: uid,
        operation: "findAroundMe",
        cost: metrics.cost,
      });

      logger.info("findAroundMe completed", {
        uid,
        typeId: input.typeId,
        radiusKm: input.radiusKm,
        hitCount: hits.length,
        placeCount: parsed.length,
        placesLocationSaved: cacheResult.saved,
        placesLocationSkipped: cacheResult.skipped,
        durationMs: Date.now() - started,
        model: metrics.model,
      });

      return {
        success: true,
        typeId: input.typeId,
        radiusKm: input.radiusKm,
        places: parsed,
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("findAroundMe failed", {
        uid,
        typeId: input.typeId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw mapOpenAIError(err);
    }
  }
);
