import { resolveCountryCode } from "@/lib/countries";

/** Real http(s) URL only — never invent or accept relative / javascript: values. */
export function parseHttpUrl(
  value: string | undefined | null
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Curated official visa / e-visa sites keyed by ISO alpha-2 lowercase.
 * Only real government or official operator URLs — never invent.
 * Add eSIM / Booking.com / Aviasales helpers here later.
 */
const OFFICIAL_VISA_LINKS: Record<string, { url: string; label: string }> = {
  sa: { url: "https://visa.visitsaudi.com/", label: "Visit Saudi visa" },
  tr: { url: "https://www.evisa.gov.tr/en/", label: "Türkiye e-Visa" },
  ae: {
    url: "https://u.ae/en/information-and-services/visa-and-emirates-id",
    label: "UAE visa information",
  },
  qa: { url: "https://www.evisa.gov.qa/", label: "Qatar e-Visa" },
  om: { url: "https://evisa.rop.gov.om/", label: "Oman e-Visa" },
  jo: { url: "https://www.visitjordan.gov.jo/", label: "Jordan visa" },
  eg: { url: "https://visa2egypt.gov.eg/", label: "Egypt e-Visa" },
  uz: { url: "https://e-visa.gov.uz/", label: "Uzbekistan e-Visa" },
  kg: { url: "https://www.evisa.e-gov.kg/", label: "Kyrgyzstan e-Visa" },
  us: {
    url: "https://travel.state.gov/content/travel/en/us-visas.html",
    label: "U.S. visa information",
  },
  gb: {
    url: "https://www.gov.uk/browse/visas-immigration",
    label: "UK visa information",
  },
  jp: {
    url: "https://www.mofa.go.jp/j_info/visit/visa/index.html",
    label: "Japan visa information",
  },
  kr: { url: "https://www.visa.go.kr/", label: "Korea visa" },
  in: { url: "https://indianvisaonline.gov.in/", label: "India visa" },
  id: { url: "https://molina.imigrasi.go.id/", label: "Indonesia e-VOA" },
  th: { url: "https://www.thaievisa.go.th/", label: "Thailand e-Visa" },
  vn: { url: "https://evisa.gov.vn/", label: "Vietnam e-Visa" },
  my: { url: "https://malaysiavisa.imi.gov.my/", label: "Malaysia visa" },
  sg: {
    url: "https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa",
    label: "Singapore visa",
  },
  cn: { url: "https://cova.mfa.gov.cn/", label: "China visa" },
};

function countryCodeKey(
  countryId?: string,
  countryName?: string
): string | null {
  const fromId =
    countryId && countryId.trim().length === 2
      ? countryId.trim().toLowerCase()
      : "";
  const fromName = resolveCountryCode(countryName)?.toLowerCase() ?? "";
  const code = fromId || fromName;
  return code || null;
}

/** Official visa application page for a destination country, if we have one. */
export function officialVisaLink(
  countryId?: string,
  countryName?: string
): { url: string; label: string } | undefined {
  const code = countryCodeKey(countryId, countryName);
  if (!code) return undefined;
  return OFFICIAL_VISA_LINKS[code];
}
