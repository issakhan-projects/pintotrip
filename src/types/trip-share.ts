export type ShareTripStoryRequest = {
  tripId: string;
  /** When true, regenerate even if a story image already exists. */
  forceRegenerate?: boolean;
};

export type ShareTripStoryStats = {
  destinationLabel: string;
  cityNames: string[];
  cityCount: number;
  dateLabel: string;
  dayCount: number;
  placesTotal: number;
  placesVisited: number;
  photoCount: number;
};

export type ShareTripStorySuccess = {
  success: true;
  imageUrl: string;
  /** PNG base64 for download/share without Storage SDK/CORS. */
  imageBase64: string;
  cached: boolean;
  model: string;
  creditsCharged: number;
  remainingCredits: number;
  stats: ShareTripStoryStats;
};
