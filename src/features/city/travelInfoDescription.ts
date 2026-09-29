import {
  CITY_INTELLIGENCE_DISCLAIMER,
  type CityIntelligenceDetails,
  type CityIntelligenceResult,
} from "@/types/city-intelligence";

/**
 * Plain-text travel summary for saving onto a location description.
 * Shared by City Intelligence save + place preview fill.
 */
export function buildTravelInfoDescription(
  place: { cityName: string; countryName: string },
  data: CityIntelligenceResult | null
): string {
  const lines: string[] = [
    `Travel info — ${place.cityName}, ${place.countryName}.`,
  ];

  if (!data) {
    lines.push("Travel info was not available when this was saved.");
    return lines.join("\n");
  }

  const details = data.details;
  const currency =
    data.exchangeRate?.to || details?.dailyBudget?.currency || "";
  if (currency) lines.push(`Currency: ${currency}`);

  if (data.exchangeRate) {
    lines.push(
      `Exchange: 1 ${data.exchangeRate.from} ≈ ${data.exchangeRate.rate} ${data.exchangeRate.to}`
    );
  }

  const bestTime =
    data.bestTimeToVisit?.summary ||
    data.bestTimeToVisit?.months?.join(", ");
  if (bestTime) lines.push(`Best time: ${bestTime}`);

  const visa = data.visa?.description;
  if (visa) lines.push(`Visa: ${visa}`);

  const budget = formatBudgetLine(data, details);
  if (budget) lines.push(`Daily budget: ${budget}`);

  if (details?.climate?.description) {
    lines.push(`Climate: ${details.climate.description}`);
  }

  if (details?.practicalInfo?.transport) {
    lines.push(`Transport: ${details.practicalInfo.transport}`);
  }
  if (data.safeRate?.summary) {
    lines.push(`Safety: ${data.safeRate.summary}`);
  }

  lines.push(CITY_INTELLIGENCE_DISCLAIMER);
  return lines.join("\n");
}

function formatBudgetLine(
  data: CityIntelligenceResult,
  details?: CityIntelligenceDetails
): string {
  const midUser = details?.dailyBudget?.midRange?.userCurrency;
  const midLocal = details?.dailyBudget?.midRange?.local;
  const localCode =
    details?.dailyBudget?.currency?.trim().toUpperCase() ||
    data.exchangeRate?.to?.trim().toUpperCase() ||
    "";
  const userCode = data.exchangeRate?.from?.trim().toUpperCase() || "";

  if (midUser != null && Number.isFinite(midUser) && userCode) {
    return `~${Math.round(midUser)} ${userCode} / day`;
  }
  if (midLocal != null && Number.isFinite(midLocal) && localCode) {
    return `~${Math.round(midLocal)} ${localCode} / day`;
  }
  return details?.dailyBudget?.description ?? "";
}
