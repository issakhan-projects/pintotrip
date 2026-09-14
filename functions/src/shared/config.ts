import { defineSecret } from "firebase-functions/params";

/**
 * Server-only secrets via Google Cloud Secret Manager /
 * Firebase Functions secrets. NEVER expose via NEXT_PUBLIC_*.
 */
export const openaiApiKey = defineSecret("OPENAI_API_KEY");

/** Resend API key for transactional email (welcome, etc.). */
export const resendApiKey = defineSecret("RESEND_API_KEY");

/** OpenWeatherMap — trip day forecasts (getTripWeather). Never expose to the browser. */
export const openWeatherMapApiKey = defineSecret("OPENWEATHERMAP_API_KEY");

/** Optional private Google/server keys for future Places/Geocoding verification. */
// Temporarily disabled — re-enable when wiring Places / Geocoding verification.
// export const googlePrivateApiKey = defineSecret("GOOGLE_PRIVATE_API_KEY");

export const DEFAULT_FUNCTIONS_REGION = "us-central1";
