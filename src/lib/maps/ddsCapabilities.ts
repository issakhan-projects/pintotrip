/**
 * Google Maps Data-Driven Styling (DDS) boundary prerequisites.
 *
 * Required in Google Cloud Console:
 * 1. A JavaScript Map ID
 * 2. Vector map type (not Raster)
 * 3. Map Style with needed boundary feature layers enabled
 *    (COUNTRY, LOCALITY, ADMINISTRATIVE_AREA_LEVEL_1, and/or _2)
 * 4. Map ID linked to that style; API key in the same project
 *
 * Note: Kazakhstan (KZ) and Turkey (TR) have Admin Area 1 only —
 * no Admin Area 2 and no Locality polygons.
 * UAE (AE) and Morocco (MA) have Country only — city highlights fall back to COUNTRY.
 * see https://developers.google.com/maps/documentation/javascript/dds-boundaries/coverage
 *
 * DEMO_MAP_ID supports Advanced Markers but NOT DDS Feature Layers.
 */

import { devLog } from "@/lib/devLog";

export const DEMO_MAP_ID = "DEMO_MAP_ID";

export type DdsFeatureType =
  | "COUNTRY"
  | "LOCALITY"
  | "ADMINISTRATIVE_AREA_LEVEL_1"
  | "ADMINISTRATIVE_AREA_LEVEL_2";

export interface DdsCapabilityReport {
  mapId: string | undefined;
  usingDemoMapId: boolean;
  isDataDrivenStylingAvailable: boolean;
  countryLayerAvailable: boolean;
  localityLayerAvailable: boolean;
  admin1LayerAvailable: boolean;
  admin2LayerAvailable: boolean;
  countryLayer: google.maps.FeatureLayer | null;
  localityLayer: google.maps.FeatureLayer | null;
  admin1Layer: google.maps.FeatureLayer | null;
  admin2Layer: google.maps.FeatureLayer | null;
  ok: boolean;
}

function logError(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    devLog.error(`[PinToTrip DDS] ${message}`, detail);
  } else {
    devLog.error(`[PinToTrip DDS] ${message}`);
  }
}

/** Wait until map capabilities settle (DDS flags often arrive async). */
export function waitForMapCapabilities(
  map: google.maps.Map,
  timeoutMs = 4_000
): Promise<google.maps.MapCapabilities> {
  const immediate = map.getMapCapabilities?.() ?? {};
  if (immediate.isDataDrivenStylingAvailable === true) {
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      listener?.remove();
      resolve(map.getMapCapabilities?.() ?? {});
    };

    const listener = map.addListener("mapcapabilities_changed", finish);
    window.setTimeout(finish, timeoutMs);
  });
}

function tryGetLayer(
  map: google.maps.Map,
  featureType: DdsFeatureType,
  silent: boolean
): { layer: google.maps.FeatureLayer | null; available: boolean } {
  try {
    const layer = map.getFeatureLayer(featureType);
    const available = Boolean(layer?.isAvailable);
    if (!silent && layer && !available) {
      logError(
        `${featureType} feature layer is unavailable (isAvailable === false). Enable it in Cloud Console → Map Styles → Feature layers.`
      );
    }
    return { layer: layer ?? null, available };
  } catch (err) {
    if (!silent) {
      logError(`Failed to get ${featureType} feature layer.`, err);
    }
    return { layer: null, available: false };
  }
}

export interface VerifyDdsOptions {
  /** When true, skip console output (used for quiet re-checks). */
  silent?: boolean;
}

/**
 * Verify Map ID / vector / DDS / feature layers.
 * Logs console errors for each missing prerequisite unless `silent`.
 */
export async function verifyDdsPrerequisites(
  map: google.maps.Map,
  mapId: string | undefined,
  options?: VerifyDdsOptions
): Promise<DdsCapabilityReport> {
  const silent = Boolean(options?.silent);
  const usingDemoMapId = !mapId || mapId === DEMO_MAP_ID;

  if (!silent) {
    if (!mapId || usingDemoMapId) {
      logError(
        "Map ID is missing/empty (using DEMO_MAP_ID). Set NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID in .env.local to a Cloud Console JavaScript VECTOR Map ID with Feature Layers enabled, then restart the dev server."
      );
    }
  }

  if (usingDemoMapId) {
    return {
      mapId,
      usingDemoMapId: true,
      isDataDrivenStylingAvailable: false,
      countryLayerAvailable: false,
      localityLayerAvailable: false,
      admin1LayerAvailable: false,
      admin2LayerAvailable: false,
      countryLayer: null,
      localityLayer: null,
      admin1Layer: null,
      admin2Layer: null,
      ok: false,
    };
  }

  const capabilities = await waitForMapCapabilities(map);
  const isDataDrivenStylingAvailable = Boolean(
    capabilities.isDataDrivenStylingAvailable
  );

  if (!silent && !isDataDrivenStylingAvailable) {
    logError(
      "Data-Driven Styling unavailable (getMapCapabilities().isDataDrivenStylingAvailable !== true). Ensure the Map ID uses a VECTOR map style with at least one boundary Feature Layer enabled.",
      capabilities
    );
  }

  const country = tryGetLayer(map, "COUNTRY", silent);
  const locality = tryGetLayer(map, "LOCALITY", silent);
  const admin1 = tryGetLayer(map, "ADMINISTRATIVE_AREA_LEVEL_1", silent);
  const admin2 = tryGetLayer(map, "ADMINISTRATIVE_AREA_LEVEL_2", silent);

  const ok =
    isDataDrivenStylingAvailable &&
    (country.available ||
      locality.available ||
      admin1.available ||
      admin2.available);

  if (!silent && ok) {
    devLog.info("[PinToTrip DDS] Prerequisites OK — feature layers:", {
      COUNTRY: country.available,
      LOCALITY: locality.available,
      ADMINISTRATIVE_AREA_LEVEL_1: admin1.available,
      ADMINISTRATIVE_AREA_LEVEL_2: admin2.available,
    });
  } else if (!silent && isDataDrivenStylingAvailable && !ok) {
    logError(
      "DDS is on, but no supported boundary layers are available. Enable COUNTRY, LOCALITY, ADMINISTRATIVE_AREA_LEVEL_1, and/or ADMINISTRATIVE_AREA_LEVEL_2 in Map Styles → Feature layers."
    );
  }

  return {
    mapId,
    usingDemoMapId,
    isDataDrivenStylingAvailable,
    countryLayerAvailable: country.available,
    localityLayerAvailable: locality.available,
    admin1LayerAvailable: admin1.available,
    admin2LayerAvailable: admin2.available,
    countryLayer: country.layer,
    localityLayer: locality.layer,
    admin1Layer: admin1.layer,
    admin2Layer: admin2.layer,
    ok,
  };
}
