import type { Metadata } from "next";
import { JournalListView } from "@/features/journal";

export const metadata: Metadata = {
  title: "Travel Journal",
  description:
    "Destination stories, itineraries, and travel notes from PinToTrip — a magazine for places worth pinning.",
  openGraph: {
    title: "Travel Journal — PinToTrip",
    description:
      "Destination stories, itineraries, and travel notes from PinToTrip.",
  },
};

export default function JournalIndexPage() {
  return <JournalListView />;
}
