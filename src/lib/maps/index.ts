export { getGoogleMapsConfig } from "./config";
export {
  ensureMapsConfigured,
  loadMapsLibrary,
  loadMarkerLibrary,
  loadPlacesLibrary,
  loadGeocodingLibrary,
} from "./loader";
export {
  googleMapsProvider,
  resolveMapsMapId,
  DEMO_MAP_ID,
  centerMapOnCoords,
  type MapProvider,
  type MapMarkerInput,
  type MapMarkerHandle,
  type MapInstance,
  type MarkerRecord,
  type CreateMapOptions,
} from "./provider";
export {
  detectUserLocation,
  getBrowserCoords,
  getBrowserCityCoords,
  reverseGeocode,
  resolveEnglishPlaceIds,
  resolveEnglishPlaceIdsFromAddress,
  englishPlaceIdsFromNames,
  type DetectedUserLocation,
  type EnglishPlaceIds,
} from "./detectLocation";
export { resolveTimezoneFromCoords } from "./timezone";
export {
  geocodeByLocation,
  geocodeByAddress,
  geocodeByPlaceId,
  resolveCoordsFromGooglePlaceId,
  peekGeocodeByLocation,
  peekGeocodeByAddress,
  hasUsableMapCoords,
} from "./geocode";
export {
  cachedRequest,
  clearMapsRequestCache,
  normalizeQuery,
  roundCoord,
  GEOCODE_TTL_MS,
  PLACES_SEARCH_TTL_MS,
  PLACE_PHOTOS_TTL_MS,
} from "./requestCache";
export {
  getCityStatuses,
  type CityHighlightStatus,
  type CityStatusEntry,
  type CityStatusLocation,
} from "./cityStatus";
export {
  resolveCityGooglePlaceId,
  getCityBoundary,
  cityPlaceIdQueryFromStatus,
  looksLikeGooglePlaceId,
  clearCityPlaceIdCache,
  type CityPlaceIdQuery,
} from "./cityPlaceId";
export { withCityGooglePlaceId } from "./attachCityPlaceId";
export { DEMO_SELECTED_CITIES } from "./demoCities";
export {
  resolveUsableFeatureType,
  preferredFeatureTypeForCountry,
  countryHasAdmin1Coverage,
  countryHasLocalityCoverage,
  normalizeCountryCode,
} from "./ddsCoverage";
export {
  getCityBoundaryStyle,
  type CityBoundaryStyle,
} from "./cityBoundaryStyle";
export {
  verifyDdsPrerequisites,
  waitForMapCapabilities,
  type DdsCapabilityReport,
} from "./ddsCapabilities";
export {
  CityStatusOverlayController,
  type CityPlaceIdBackfill,
} from "./cityStatusOverlays";
