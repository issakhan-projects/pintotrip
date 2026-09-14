import type { PreparationItem } from "@/types/trip-planner";

function id(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Seed "Before you go" checklist from trip context.
 * Pure client-side — no Cloud Function.
 */
export function buildDefaultPreparationItems(input: {
  destinationCity: string;
  destinationCountry: string;
  fromCountry?: string;
  citizenship?: string;
  visaLikelyRequired?: boolean;
}): PreparationItem[] {
  const sameCountry =
    Boolean(input.fromCountry) &&
    input.fromCountry!.toLowerCase() ===
      input.destinationCountry.toLowerCase();

  const items: Array<Omit<PreparationItem, "id" | "order" | "completed">> = [
    {
      title: "Check passport validity",
      description: "Many destinations need 6+ months remaining validity.",
      category: "documents",
    },
    {
      title: sameCountry
        ? "Confirm domestic travel ID"
        : "Check visa / entry requirements",
      description: input.visaLikelyRequired
        ? "Visa may be required — verify with official sources."
        : `Entry rules for ${input.destinationCountry} as ${input.citizenship || "your"} passport holder.`,
      category: "documents",
    },
    {
      title: "Book accommodation",
      description: `Reserve a place to stay in ${input.destinationCity}.`,
      category: "booking",
    },
    {
      title: sameCountry ? "Confirm transport" : "Confirm flights",
      category: "transport",
    },
    {
      title: "Get travel insurance",
      category: "health",
    },
    {
      title: "Prepare local currency / payment",
      description: "Cash, cards, and any travel-friendly payment apps.",
      category: "money",
    },
    {
      title: "Download offline maps",
      category: "other",
    },
    {
      title: "Pack for the weather",
      description: "Check climate notes in trip details before you pack.",
      category: "packing",
    },
  ];

  return items.map((item, index) => ({
    ...item,
    id: id(),
    completed: false,
    order: index,
  }));
}
