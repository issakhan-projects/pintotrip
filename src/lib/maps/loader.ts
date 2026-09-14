import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { getGoogleMapsConfig } from "./config";

let configured = false;

/**
 * Configure the Maps JavaScript API once, then load libraries on demand.
 * Do not put private Google API keys here — only the browser Maps key.
 */
export function ensureMapsConfigured(): void {
  if (configured) return;

  const config = getGoogleMapsConfig();
  setOptions({
    key: config.apiKey,
    v: config.version,
    libraries: config.libraries,
    ...(config.mapId ? { mapIds: [config.mapId] } : {}),
  });
  configured = true;
}

export async function loadMapsLibrary(): Promise<google.maps.MapsLibrary> {
  ensureMapsConfigured();
  return importLibrary("maps");
}

export async function loadMarkerLibrary(): Promise<google.maps.MarkerLibrary> {
  ensureMapsConfigured();
  return importLibrary("marker");
}

export async function loadPlacesLibrary(): Promise<google.maps.PlacesLibrary> {
  ensureMapsConfigured();
  return importLibrary("places");
}

export async function loadGeocodingLibrary(): Promise<google.maps.GeocodingLibrary> {
  ensureMapsConfigured();
  return importLibrary("geocoding");
}
