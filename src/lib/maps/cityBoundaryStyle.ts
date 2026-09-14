import type { CityHighlightStatus } from "./cityStatus";

export interface CityBoundaryStyle {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWeight: number;
}

const STYLES: Record<CityHighlightStatus, CityBoundaryStyle> = {
  visited: {
    fillColor: "#16A34A",
    fillOpacity: 0.35,
    strokeColor: "#16A34A",
    strokeOpacity: 0.85,
    strokeWeight: 2,
  },
  planned: {
    fillColor: "#2563EB",
    fillOpacity: 0.3,
    strokeColor: "#2563EB",
    strokeOpacity: 0.8,
    strokeWeight: 2,
  },
};

export function getCityBoundaryStyle(
  status: CityHighlightStatus
): CityBoundaryStyle {
  return STYLES[status];
}
