/** Shared airline catalog for route flight details (select + cards). */

export type AirlineOption = {
  value: string;
  label: string;
  description: string;
  iconUrl: string;
};

export function airlineLogoUrl(iataCode: string): string {
  return `https://www.gstatic.com/flights/airline_logos/70px/${iataCode}.png`;
}

function airlineOption(name: string, iataCode: string): AirlineOption {
  return {
    value: name,
    label: name,
    description: iataCode,
    iconUrl: airlineLogoUrl(iataCode),
  };
}

export const AIRLINE_OPTIONS: AirlineOption[] = [
  airlineOption("Air Astana", "KC"),
  airlineOption("FlyArystan", "FS"),
  airlineOption("SCAT Airlines", "DV"),
  airlineOption("Turkish Airlines", "TK"),
  airlineOption("Pegasus Airlines", "PC"),
  airlineOption("AJet", "VF"),
  airlineOption("Qatar Airways", "QR"),
  airlineOption("Emirates", "EK"),
  airlineOption("Etihad Airways", "EY"),
  airlineOption("Saudia", "SV"),
  airlineOption("flynas", "XY"),
  airlineOption("flydubai", "FZ"),
  airlineOption("Air Arabia", "G9"),
  airlineOption("Wizz Air", "W6"),
  airlineOption("Lufthansa", "LH"),
  airlineOption("British Airways", "BA"),
  airlineOption("Air France", "AF"),
  airlineOption("KLM", "KL"),
  airlineOption("SWISS", "LX"),
  airlineOption("Austrian Airlines", "OS"),
  airlineOption("LOT Polish Airlines", "LO"),
  airlineOption("Singapore Airlines", "SQ"),
  airlineOption("Korean Air", "KE"),
  airlineOption("Asiana Airlines", "OZ"),
  airlineOption("Japan Airlines", "JL"),
  airlineOption("ANA", "NH"),
  airlineOption("Cathay Pacific", "CX"),
  airlineOption("China Southern", "CZ"),
  airlineOption("China Eastern", "MU"),
  airlineOption("Air China", "CA"),
  airlineOption("United Airlines", "UA"),
  airlineOption("Delta Air Lines", "DL"),
  airlineOption("American Airlines", "AA"),
  airlineOption("Alaska Airlines", "AS"),
  airlineOption("Air Canada", "AC"),
  airlineOption("Iberia", "IB"),
  airlineOption("ITA Airways", "AZ"),
  airlineOption("Finnair", "AY"),
  airlineOption("TAP Air Portugal", "TP"),
  airlineOption("Brussels Airlines", "SN"),
  airlineOption("Oman Air", "WY"),
  airlineOption("Kuwait Airways", "KU"),
  airlineOption("Gulf Air", "GF"),
  airlineOption("Royal Jordanian", "RJ"),
  airlineOption("EgyptAir", "MS"),
  airlineOption("Ethiopian Airlines", "ET"),
  airlineOption("Uzbekistan Airways", "HY"),
  airlineOption("Azerbaijan Airlines", "J2"),
  airlineOption("Georgian Airways", "A9"),
  airlineOption("Belavia", "B2"),
  airlineOption("China Airlines", "CI"),
];

const BY_NAME = new Map(
  AIRLINE_OPTIONS.map((option) => [option.value.toLowerCase(), option])
);

export function findAirlineOption(name: string): AirlineOption | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return BY_NAME.get(trimmed.toLowerCase()) ?? null;
}

export function airlineIconUrlForName(name: string): string | null {
  return findAirlineOption(name)?.iconUrl ?? null;
}
