import { getCityBoundaryStyle } from "./cityBoundaryStyle";
import {
  cityPlaceIdQueryFromStatus,
  resolveCityGooglePlaceId,
} from "./cityPlaceId";
import {
  getCityStatuses,
  type CityHighlightStatus,
  type CityStatusEntry,
  type CityStatusLocation,
} from "./cityStatus";
import { DEMO_SELECTED_CITIES } from "./demoCities";
import {
  verifyDdsPrerequisites,
  type DdsCapabilityReport,
  type DdsFeatureType,
} from "./ddsCapabilities";
import {
  normalizeCountryCode,
  preferredFeatureTypeForCountry,
  resolveUsableFeatureType,
} from "./ddsCoverage";
import { devLog } from "@/lib/devLog";

export type CityPlaceIdBackfill = {
  locationIds: string[];
  googlePlaceId: string;
};

type PlaceStyleEntry = {
  status: CityHighlightStatus;
  featureType: DdsFeatureType;
};

type CountryHighlightAcc = {
  key: string;
  countryId: string;
  countryName: string;
  status: CityHighlightStatus;
  lat?: number;
  lon?: number;
  cityNames: string[];
};

/**
 * Styles boundaries from location city statuses.
 * Prefers city/region Feature Layers; when unavailable (e.g. UAE/Dubai),
 * highlights the COUNTRY layer instead.
 * Does not create, modify, or interact with location pins.
 */
export class CityStatusOverlayController {
  private map: google.maps.Map;
  private mapId: string | undefined;
  private report: DdsCapabilityReport | null = null;
  private loggedFailure = false;
  private generation = 0;
  /** Google Place ID → style target */
  private placeStyles = new Map<string, PlaceStyleEntry>();
  private capabilitiesListener: { remove: () => void } | null = null;
  private onPlaceIdResolved?: (batch: CityPlaceIdBackfill[]) => void;

  constructor(
    map: google.maps.Map,
    mapId?: string,
    options?: {
      onPlaceIdResolved?: (batch: CityPlaceIdBackfill[]) => void;
    }
  ) {
    this.map = map;
    this.mapId = mapId;
    this.onPlaceIdResolved = options?.onPlaceIdResolved;

    this.capabilitiesListener = map.addListener(
      "mapcapabilities_changed",
      () => {
        void this.refreshCapabilitiesQuietly();
      }
    );
  }

  setPlaceIdResolvedHandler(
    handler: ((batch: CityPlaceIdBackfill[]) => void) | undefined
  ): void {
    this.onPlaceIdResolved = handler;
  }

  async sync(locations: CityStatusLocation[]): Promise<void> {
    const generation = ++this.generation;

    await this.ensureCapabilities();
    if (generation !== this.generation) return;

    if (!this.report?.ok) {
      this.clearLayerStyles();
      return;
    }

    const statuses = getCityStatuses(locations);
    const nextStyles = new Map<string, PlaceStyleEntry>();
    const backfill: CityPlaceIdBackfill[] = [];
    const countryHighlights = new Map<string, CountryHighlightAcc>();

    const layerOpts = {
      countryAvailable: this.report.countryLayerAvailable,
      localityAvailable: this.report.localityLayerAvailable,
      admin1Available: this.report.admin1LayerAvailable,
      admin2Available: this.report.admin2LayerAvailable,
    };

    const queueCountry = (entry: CityStatusEntry) => {
      const code =
        normalizeCountryCode(entry.countryId, entry.countryName) ||
        entry.countryId ||
        entry.countryName;
      if (!code) return;

      const existing = countryHighlights.get(code);
      if (!existing) {
        countryHighlights.set(code, {
          key: `country:${code}`,
          countryId: entry.countryId,
          countryName: entry.countryName,
          status: entry.status,
          lat: entry.lat,
          lon: entry.lon,
          cityNames: [entry.cityName],
        });
        return;
      }

      existing.cityNames.push(entry.cityName);
      if (entry.status === "visited") existing.status = "visited";
      if (existing.lat == null && entry.lat != null) {
        existing.lat = entry.lat;
        existing.lon = entry.lon;
      }
    };

    await Promise.all(
      statuses.map(async (entry) => {
        const preferred = preferredFeatureTypeForCountry({
          countryId: entry.countryId,
          countryName: entry.countryName,
          ...layerOpts,
        });

        if (!preferred || preferred === "COUNTRY") {
          queueCountry(entry);
          return;
        }

        const featureType = resolveUsableFeatureType({
          preferred,
          countryId: entry.countryId,
          countryName: entry.countryName,
          cityName: entry.cityName,
          ...layerOpts,
        });

        if (!featureType || featureType === "COUNTRY") {
          queueCountry(entry);
          return;
        }

        const placeId = await resolveCityGooglePlaceId({
          ...cityPlaceIdQueryFromStatus(entry),
          featureType,
        });
        if (generation !== this.generation) return;

        if (!placeId) {
          queueCountry(entry);
          return;
        }

        nextStyles.set(placeId, { status: entry.status, featureType });
        // devLog.info(
        //   `[PinToTrip DDS] City highlight: ${entry.cityName} → ${placeId} (${entry.status}, ${featureType})`
        // );

        if (
          entry.locationIdsMissingPlaceId.length > 0 &&
          entry.googlePlaceId !== placeId &&
          featureType === "LOCALITY"
        ) {
          backfill.push({
            locationIds: entry.locationIdsMissingPlaceId,
            googlePlaceId: placeId,
          });
        }
      })
    );

    if (generation !== this.generation) return;

    // Country-level DDS when city/region polygons are unavailable.
    await Promise.all(
      [...countryHighlights.values()].map(async (country) => {
        if (!this.report!.countryLayerAvailable) {
          devLog.error(
            `[PinToTrip DDS] Cannot highlight "${country.countryName}" — COUNTRY feature layer is not enabled on this Map Style. Enable Country in Cloud Console → Map Styles → Feature layers.`,
            { cities: country.cityNames }
          );
          return;
        }

        const placeId = await resolveCityGooglePlaceId({
          key: country.key,
          cityName: country.countryName,
          countryName: country.countryName,
          countryId: country.countryId,
          lat: country.lat,
          lon: country.lon,
          featureType: "COUNTRY",
        });
        if (generation !== this.generation) return;
        if (!placeId) {
          devLog.error(
            `[PinToTrip DDS] Country Place ID missing for "${country.countryName}".`,
            { cities: country.cityNames }
          );
          return;
        }

        const prev = nextStyles.get(placeId);
        const status =
          prev?.status === "visited" || country.status === "visited"
            ? "visited"
            : country.status;

        nextStyles.set(placeId, { status, featureType: "COUNTRY" });
        devLog.info(
          `[PinToTrip DDS] Country highlight: ${country.countryName} → ${placeId} (${status}, COUNTRY)`,
          { cities: country.cityNames }
        );
      })
    );

    if (generation !== this.generation) return;

    if (DEMO_SELECTED_CITIES.length > 0) {
      await Promise.all(
        DEMO_SELECTED_CITIES.map(async (city) => {
          const featureType = resolveUsableFeatureType({
            preferred: city.featureType,
            countryId: city.countryId,
            countryName: city.countryName,
            cityName: city.cityName,
            ...layerOpts,
          });
          if (!featureType) return;

          const placeId = await resolveCityGooglePlaceId({
            key: city.key,
            cityName: city.cityName,
            countryName: city.countryName,
            countryId: city.countryId,
            lat: city.lat,
            lon: city.lon,
            featureType,
          });
          if (generation !== this.generation) return;
          if (!placeId) return;

          nextStyles.set(placeId, { status: city.status, featureType });
        })
      );
    }

    if (generation !== this.generation) return;

    this.placeStyles = nextStyles;
    this.applyLayerStyles();

    if (backfill.length > 0) {
      this.onPlaceIdResolved?.(backfill);
    }
  }

  clear(): void {
    this.generation += 1;
    this.placeStyles.clear();
    this.clearLayerStyles();
    this.capabilitiesListener?.remove();
    this.capabilitiesListener = null;
  }

  private async ensureCapabilities(): Promise<void> {
    if (this.report?.ok) return;

    this.report = await verifyDdsPrerequisites(this.map, this.mapId, {
      silent: this.loggedFailure,
    });

    if (!this.report.ok) {
      this.loggedFailure = true;
    } else if (this.loggedFailure) {
      devLog.info(
        "[PinToTrip DDS] Capabilities became available — applying city boundary styles."
      );
    }
  }

  private async refreshCapabilitiesQuietly(): Promise<void> {
    if (this.report?.ok) return;
    const previousOk = this.report?.ok;
    this.report = await verifyDdsPrerequisites(this.map, this.mapId, {
      silent: true,
    });
    if (!previousOk && this.report.ok && this.placeStyles.size > 0) {
      this.applyLayerStyles();
    }
  }

  private applyLayerStyles(): void {
    const styles = this.placeStyles;

    const makeStyleFn =
      (layerType: DdsFeatureType) =>
      (
        options: google.maps.FeatureStyleFunctionOptions
      ): google.maps.FeatureStyleOptions | null => {
        const feature = options.feature as google.maps.PlaceFeature;
        const entry = styles.get(feature.placeId);
        if (!entry || entry.featureType !== layerType) return null;

        const style = getCityBoundaryStyle(entry.status);
        return {
          fillColor: style.fillColor,
          fillOpacity: style.fillOpacity,
          strokeColor: style.strokeColor,
          strokeOpacity: style.strokeOpacity,
          strokeWeight: style.strokeWeight,
        };
      };

    if (this.report?.countryLayer?.isAvailable) {
      this.report.countryLayer.style = makeStyleFn("COUNTRY");
    }
    if (this.report?.localityLayer?.isAvailable) {
      this.report.localityLayer.style = makeStyleFn("LOCALITY");
    }
    if (this.report?.admin1Layer?.isAvailable) {
      this.report.admin1Layer.style = makeStyleFn(
        "ADMINISTRATIVE_AREA_LEVEL_1"
      );
    }
    if (this.report?.admin2Layer?.isAvailable) {
      this.report.admin2Layer.style = makeStyleFn(
        "ADMINISTRATIVE_AREA_LEVEL_2"
      );
    }
  }

  private clearLayerStyles(): void {
    for (const layer of [
      this.report?.countryLayer,
      this.report?.localityLayer,
      this.report?.admin1Layer,
      this.report?.admin2Layer,
    ]) {
      if (!layer) continue;
      try {
        layer.style = null;
      } catch {
        // Layer may be unavailable.
      }
    }
  }
}
