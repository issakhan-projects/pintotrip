/**
 * Firestore trigger: users/{userId}/tripPlanner/{tripId} created
 * → Discover airports (+ train stations when multi-city) on destinations[]
 * → Discover international airports only on from (origin)
 * → Prefer cityTransportCache; Places Text Search only on cache miss
 * → write transport onto destinations[] and from.
 *
 * Enrichment is best-effort: never fails trip creation.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  DEFAULT_FUNCTIONS_REGION,
  googlePrivateApiKey,
  openaiApiKey,
} from "../shared/config";
import { initAdmin, adminDb } from "../shared/admin";
import {
  discoverDestinationTransport,
  discoverTransportForDestinations,
  mergeTransportPreferExisting,
  type TransportDestinationInput,
  type TripDestinationTransport,
} from "../shared/transportDiscovery";

type DestinationRecord = TransportDestinationInput & {
  countryId?: string;
  countryName?: string;
  photos?: string[];
  [key: string]: unknown;
};

/** Prefer destinations[]; fall back to legacy singular destination. */
function asDestinationRecords(
  data: FirebaseFirestore.DocumentData
): DestinationRecord[] {
  const destinations = data.destinations;
  if (Array.isArray(destinations) && destinations.length > 0) {
    return destinations.filter(
      (row): row is DestinationRecord =>
        Boolean(row) && typeof row === "object"
    );
  }

  const legacy = data.destination;
  if (legacy && typeof legacy === "object") {
    return [legacy as DestinationRecord];
  }

  return [];
}

/** Origin city from trip.from — needs cityName for IATA enrichment. */
function asFromRecord(
  data: FirebaseFirestore.DocumentData
): DestinationRecord | null {
  const from = data.from;
  if (!from || typeof from !== "object") return null;
  const row = from as Record<string, unknown>;
  const cityName =
    typeof row.cityName === "string" ? row.cityName.trim() : "";
  if (!cityName) return null;
  return from as DestinationRecord;
}

function destinationKey(dest: DestinationRecord): string {
  const cityId =
    typeof dest.cityId === "string" ? dest.cityId.trim().toLowerCase() : "";
  if (cityId) return `id:${cityId}`;
  const cityName =
    typeof dest.cityName === "string" ? dest.cityName.trim().toLowerCase() : "";
  return `name:${cityName}`;
}

function buildTransportByCity(
  destinations: DestinationRecord[],
  transports: Array<TripDestinationTransport | undefined>
): Map<string, TripDestinationTransport | undefined> {
  const map = new Map<string, TripDestinationTransport | undefined>();
  destinations.forEach((dest, index) => {
    map.set(destinationKey(dest), transports[index]);
  });
  return map;
}

function attachTransport(
  destinations: DestinationRecord[],
  transportByCity: Map<string, TripDestinationTransport | undefined>
): DestinationRecord[] {
  return destinations.map((dest) => {
    const next = mergeTransportPreferExisting(
      dest.transport,
      transportByCity.get(destinationKey(dest))
    );
    if (!next) {
      const { transport: _removed, ...rest } = dest;
      return rest as DestinationRecord;
    }
    return { ...dest, transport: next };
  });
}

function attachFromTransport(
  from: DestinationRecord,
  discovered: TripDestinationTransport | undefined
): DestinationRecord {
  const next = mergeTransportPreferExisting(from.transport, discovered);
  if (!next) {
    const { transport: _removed, ...rest } = from;
    return rest as DestinationRecord;
  }
  // Origin never stores train stations.
  const { trainStations: _stations, ...airportsOnly } = next;
  return { ...from, transport: airportsOnly };
}

/**
 * onTripPlannerCreated
 * Async transport enrichment after tripPlanner document create.
 */
export const onTripPlannerCreated = onDocumentCreated(
  {
    document: "users/{userId}/tripPlanner/{tripId}",
    region: DEFAULT_FUNCTIONS_REGION,
    secrets: [googlePrivateApiKey, openaiApiKey],
    memory: "512MiB",
    timeoutSeconds: 180,
  },
  async (event) => {
    initAdmin();

    const userId = event.params.userId as string;
    const tripId = event.params.tripId as string;
    const snap = event.data;
    if (!snap) {
      logger.warn("onTripPlannerCreated: missing snapshot", { userId, tripId });
      return;
    }

    const data = snap.data();
    const list = asDestinationRecords(data);
    const fromRecord = asFromRecord(data);

    if (list.length === 0 && !fromRecord) {
      logger.info("onTripPlannerCreated: nothing to enrich", {
        userId,
        tripId,
      });
      return;
    }

    logger.info("onTripPlannerCreated: discovering transport", {
      userId,
      tripId,
      cityCount: list.length,
      includeTrainStations: list.length > 1,
      enrichFrom: Boolean(fromRecord),
    });

    let transports: Array<TripDestinationTransport | undefined> = [];
    if (list.length > 0) {
      try {
        transports = await discoverTransportForDestinations(list);
      } catch (err) {
        logger.error(
          "onTripPlannerCreated: destination discovery failed; continuing",
          {
            userId,
            tripId,
            error: err instanceof Error ? err.message : String(err),
          }
        );
        transports = list.map((d) => d.transport);
      }
    }

    let fromTransport: TripDestinationTransport | undefined;
    if (fromRecord) {
      try {
        // Origin: international airports only (no train stations).
        fromTransport = await discoverDestinationTransport(fromRecord, {
          includeTrainStations: false,
        });
      } catch (err) {
        logger.error("onTripPlannerCreated: from airport discovery failed", {
          userId,
          tripId,
          cityName: fromRecord.cityName,
          error: err instanceof Error ? err.message : String(err),
        });
        fromTransport = fromRecord.transport;
      }
    }

    const transportByCity = buildTransportByCity(list, transports);
    const enrichedDestinations =
      list.length > 0 ? attachTransport(list, transportByCity) : [];
    const enrichedFrom = fromRecord
      ? attachFromTransport(fromRecord, fromTransport)
      : null;

    const anyDestTransport = enrichedDestinations.some((d) =>
      Boolean(d.transport)
    );
    const anyFromTransport = Boolean(enrichedFrom?.transport);
    if (!anyDestTransport && !anyFromTransport) {
      logger.info("onTripPlannerCreated: no transport data to write", {
        userId,
        tripId,
      });
      return;
    }

    const tripRef = adminDb().doc(`users/${userId}/tripPlanner/${tripId}`);

    try {
      await adminDb().runTransaction(async (tx) => {
        const latest = await tx.get(tripRef);
        if (!latest.exists) return;

        const latestData = latest.data() || {};
        const update: Record<string, unknown> = {
          updatedAt: FieldValue.serverTimestamp(),
          // Drop legacy singular field once destinations[] is the source of truth.
          destination: FieldValue.delete(),
        };

        if (list.length > 0) {
          const current = asDestinationRecords(latestData);
          update.destinations = attachTransport(current, transportByCity);
        }

        const latestFrom = asFromRecord(latestData);
        if (latestFrom) {
          update.from = attachFromTransport(latestFrom, fromTransport);
        }

        tx.update(tripRef, update);
      });

      logger.info("onTripPlannerCreated: transport saved", {
        userId,
        tripId,
        citiesWithTransport: enrichedDestinations.filter((d) =>
          Boolean(d.transport)
        ).length,
        fromHasTransport: anyFromTransport,
      });
    } catch (err) {
      logger.error("onTripPlannerCreated: Firestore update failed; continuing", {
        userId,
        tripId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
