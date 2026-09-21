import { defineSecret, defineString } from "firebase-functions/params";

/**
 * Server-only secrets via Google Cloud Secret Manager /
 * Firebase Functions secrets. NEVER expose via NEXT_PUBLIC_*.
 */
export const openaiApiKey = defineSecret("OPENAI_API_KEY");

/** Resend API key for transactional email (welcome, etc.). */
export const resendApiKey = defineSecret("RESEND_API_KEY");

/** OpenWeatherMap — trip day forecasts (getTripWeather). Never expose to the browser. */
export const openWeatherMapApiKey = defineSecret("OPENWEATHERMAP_API_KEY");

/**
 * Private Google Maps Platform key for server-side Places / Geocoding.
 * Restrict by IP / API in Cloud Console — never use NEXT_PUBLIC_*.
 */
export const googlePrivateApiKey = defineSecret("GOOGLE_PRIVATE_API_KEY");

/** Paddle Billing API keys — keep both; pick by webhook signature / stored env. */
export const paddleApiKeySandbox = defineSecret("PADDLE_API_KEY_SANDBOX");
export const paddleApiKeyLive = defineSecret("PADDLE_API_KEY_LIVE");

/** Notification destination secrets (one per Paddle account / destination). */
export const paddleWebhookSecretSandbox = defineSecret(
  "PADDLE_NOTIFICATION_WEBHOOK_SECRET_SANDBOX"
);
export const paddleWebhookSecretLive = defineSecret(
  "PADDLE_NOTIFICATION_WEBHOOK_SECRET_LIVE"
);

/** Catalog price IDs — sandbox + live mapped into the same plan resolver. */
export const paddlePricePlusMonthSandbox = defineString(
  "PADDLE_PRICE_PLUS_MONTH_SANDBOX",
  { default: "" }
);
export const paddlePricePlusYearSandbox = defineString(
  "PADDLE_PRICE_PLUS_YEAR_SANDBOX",
  { default: "" }
);
export const paddlePriceProMonthSandbox = defineString(
  "PADDLE_PRICE_PRO_MONTH_SANDBOX",
  { default: "" }
);
export const paddlePriceProYearSandbox = defineString(
  "PADDLE_PRICE_PRO_YEAR_SANDBOX",
  { default: "" }
);

export const paddlePricePlusMonthLive = defineString(
  "PADDLE_PRICE_PLUS_MONTH_LIVE",
  { default: "" }
);
export const paddlePricePlusYearLive = defineString(
  "PADDLE_PRICE_PLUS_YEAR_LIVE",
  { default: "" }
);
export const paddlePriceProMonthLive = defineString(
  "PADDLE_PRICE_PRO_MONTH_LIVE",
  { default: "" }
);
export const paddlePriceProYearLive = defineString(
  "PADDLE_PRICE_PRO_YEAR_LIVE",
  { default: "" }
);

/** Optional product IDs (fallback mapping when price ID is unknown). */
export const paddleProductPlus = defineString("PADDLE_PRODUCT_PLUS", {
  default: "",
});
export const paddleProductPro = defineString("PADDLE_PRODUCT_PRO", {
  default: "",
});

export const DEFAULT_FUNCTIONS_REGION = "us-central1";

/** All Paddle secrets that webhook + portal functions may need. */
export const paddleSecrets = [
  paddleApiKeySandbox,
  paddleApiKeyLive,
  paddleWebhookSecretSandbox,
  paddleWebhookSecretLive,
] as const;
