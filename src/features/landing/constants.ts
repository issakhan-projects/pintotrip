import type { LocationStatus } from "@/types/location";

/** High-quality travel photography (Unsplash). */
export const LANDING_IMAGES = {
  heroPetra:
    "https://images.unsplash.com/photo-1691783639104-806ca12a9a8f?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  petra:
    "https://images.unsplash.com/photo-1691783639104-806ca12a9a8f?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  tokyo:
    "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1600&q=80",
  tokyoStreet:
    "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=1200&q=80",
  tokyoFuji:
    "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=80",
  tokyoNight:
    "https://images.unsplash.com/photo-1513407030348-c983a97b98d8?auto=format&fit=crop&w=800&q=80",
  tokyoTemple:
    "https://images.unsplash.com/photo-1526481280693-3bfa7568e0f3?auto=format&fit=crop&w=800&q=80",
  tokyoFood:
    "https://images.unsplash.com/photo-1553621042-f6e147245754?auto=format&fit=crop&w=800&q=80",
  finalCta:
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2000&q=80",
  mapVisual: "/everyPlaceToVisit2.png",
  santorini:
    "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?auto=format&fit=crop&w=2000&q=80",
  athens:
    "https://images.unsplash.com/photo-1555993539-1732b0258235?auto=format&fit=crop&w=400&q=80",
  santoriniTown:
    "https://images.unsplash.com/photo-1613395877344-13d4a8e0d49e?auto=format&fit=crop&w=400&q=80",
  crete:
    "https://images.unsplash.com/photo-1601581875309-fafbf2d3ed3a?auto=format&fit=crop&w=400&q=80",
  oia:
    "https://images.unsplash.com/photo-1613395877344-13d4a8e0d49e?auto=format&fit=crop&w=200&q=80",
  fira:
    "https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=200&q=80",
  kamari:
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=200&q=80",
    plaka: "https://images.unsplash.com/photo-1536198899635-446f211a8485?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
} as const;

export const DEMO_PLACE = {
  name: "Ad Deir — The Monastery",
  city: "Petra",
  country: "Jordan",
  lat: 30.3381,
  lon: 35.4419,
} as const;

export interface LandingMapPin {
  id: string;
  title: string;
  lat: number;
  lon: number;
  status: LocationStatus;
}

export const WORLD_MAP_PINS: LandingMapPin[] = [
  { id: "paris", title: "Paris", lat: 48.8566, lon: 2.3522, status: "visited" },
  { id: "tokyo", title: "Tokyo", lat: 35.6762, lon: 139.6503, status: "planned" },
  { id: "dubai", title: "Dubai", lat: 25.2048, lon: 55.2708, status: "visited" },
  { id: "petra", title: "Petra", lat: 30.3285, lon: 35.4444, status: "planned" },
  { id: "bali", title: "Bali", lat: -8.4095, lon: 115.1889, status: "planned" },
  {
    id: "casablanca",
    title: "Casablanca",
    lat: 33.5731,
    lon: -7.5898,
    status: "visited",
  },
  {
    id: "iceland",
    title: "Iceland",
    lat: 64.1466,
    lon: -21.9426,
    status: "planned",
  },
];

export const TOKYO_PREVIEW = {
  city: "Tokyo",
  country: "Japan",
  bestTime: "March — May, October — November",
  budget: "$80 — $250",
  currency: "JPY (¥)",
  visa: "Check requirements",
  attractions: ["Shibuya", "Senso-ji", "Tokyo Skytree"],
  tips: ["Transport", "Apps", "Safety", "and more"],
  image: LANDING_IMAGES.tokyoFuji,
  gallery: [
    LANDING_IMAGES.tokyoStreet,
    LANDING_IMAGES.tokyoNight,
    LANDING_IMAGES.tokyoTemple,
    LANDING_IMAGES.tokyoFood,
  ],
} as const;

export const HERO_FEATURES = [
  "Find places from photos",
  "Save to your personal map",
  "Get travel info before you go",
] as const;
