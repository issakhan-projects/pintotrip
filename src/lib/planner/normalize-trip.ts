import type {
  TripDestination,
  TripItinerary,
  TripPlanner,
  TripPlannerDoc,
  TripPreparation,
  TripCityIntelligence,
} from "@/types/trip-planner";

type RawTrip = TripPlanner & { destination?: TripDestination; id?: string };

/**
 * Coalesce legacy fields and fill required arrays so UI never iterates
 * missing `itinerary.days` / `savedPlaceIds` / preparation items.
 */
export function normalizeTripDoc(
  id: string,
  raw: RawTrip
): TripPlannerDoc {
  const destinations =
    raw.destinations && raw.destinations.length > 0
      ? raw.destinations
      : raw.destination
        ? [
            {
              cityName: raw.destination.cityName,
              countryName: raw.destination.countryName,
              cityId: raw.destination.cityId,
              countryId: raw.destination.countryId,
              lat: raw.destination.lat,
              lon: raw.destination.lon,
              photos: raw.destination.photos,
              transport: raw.destination.transport,
            },
          ]
        : [];

  const { destination: _legacy, id: _id, ...rest } = raw;

  const itineraryRaw = rest.itinerary as TripItinerary | undefined;
  const itinerary: TripItinerary = {
    status: itineraryRaw?.status ?? "empty",
    days: Array.isArray(itineraryRaw?.days) ? itineraryRaw.days : [],
  };

  const preparationRaw = rest.preparation as TripPreparation | undefined;
  const preparation: TripPreparation = {
    ...(preparationRaw ?? {}),
    items: Array.isArray(preparationRaw?.items) ? preparationRaw.items : [],
  };

  const intelRaw = rest.cityIntelligence as TripCityIntelligence | undefined;
  const cityIntelligence: TripCityIntelligence = {
    status: intelRaw?.status ?? "pending",
    ...(intelRaw ?? {}),
    results: Array.isArray(intelRaw?.results)
      ? intelRaw.results.filter((r) => Boolean(r?.city?.cityId))
      : intelRaw?.results,
  };

  return {
    ...rest,
    id,
    destinations,
    savedPlaceIds: Array.isArray(rest.savedPlaceIds) ? rest.savedPlaceIds : [],
    itinerary,
    preparation,
    cityIntelligence,
  } as TripPlannerDoc;
}
