import { getPublicEnv } from "@/lib/env";

export interface GoogleMapsClientConfig {
  apiKey: string;
  /** Maps JS API version */
  version?: string;
  libraries?: Array<"maps" | "marker" | "places" | "geocoding" | "geometry">;
  mapId?: string;
}

export function getGoogleMapsConfig(): GoogleMapsClientConfig {
  const { googleMaps } = getPublicEnv();
  if (!googleMaps.apiKey) {
    throw new Error(
      "Missing required public environment variable: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. See .env.example."
    );
  }
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() || undefined;
  return {
    apiKey: googleMaps.apiKey,
    version: process.env.NEXT_PUBLIC_GOOGLE_MAPS_VERSION ?? "weekly",
    libraries: ["maps", "marker", "geocoding", "places"],
    mapId,
  };
}
