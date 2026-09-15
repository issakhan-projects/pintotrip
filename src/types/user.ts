import type { Timestamp } from "firebase/firestore";
import type { TravelProfile } from "@/types/travel-profile";

export type SubscriptionPlan = "free" | "plus" | "pro";

/**
 * Subscription lifecycle from Paddle webhooks (source of truth).
 * `inactive` is legacy — treat as no paid access.
 */
export type SubscriptionStatus =
  | "active"
  | "inactive"
  | "canceled"
  | "past_due"
  | "paused";

export type TemperatureUnit = "celsius" | "fahrenheit";
export type DistanceUnit = "km" | "mi";
export type TimeFormat = "24h" | "12h";

export interface UserPreferences {
  emailSubscription: boolean;
  /** BCP 47 language from the user's device (e.g. "en", "ru", "uz"). */
  language: string;
  timezone: string;
  /** Display temperature as °C or °F. Defaults to celsius when unset. */
  temperatureUnit?: TemperatureUnit;
  /** Display distances as km or mi. Defaults to km when unset. */
  distanceUnit?: DistanceUnit;
  /** Clock display: 24-hour or 12-hour. Defaults to 24h when unset. */
  timeFormat?: TimeFormat;
}

/**
 * Mirrored from Paddle via Cloud Function `paddleWebhook`.
 * Clients must never treat checkout success alone as Plus/Pro access.
 */
export interface UserSubscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  paddleCustomerId?: string;
  paddleSubscriptionId?: string;
  /** Which Paddle account owns this subscription (sandbox vs live). */
  paddleEnvironment?: "sandbox" | "production";
  productId?: string;
  priceId?: string;
  currentPeriodEnd?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * Firestore document: users/{userId}
 */
export interface UserProfile {
  name: string;
  lastname: string;
  email: string;

  /** Current / home base location (not the same as passport citizenship). */
  country: string;
  city: string;

  /**
   * Passport / nationality country.
   * Asked once when opening city intelligence if empty.
   * Used only to personalize travel recommendations (e.g. visa).
   * Never inferred from browser locale or GPS.
   */
  citizenship?: string;

  lat?: number;
  lon?: number;

  currency?: string;
  photoUrl?: string;

  aiCreditsBalance: number;

  /**
   * True after the user submitted an in-app review (and received the credit reward).
   * Set only by Cloud Functions.
   */
  hasLeftReview?: boolean;

  /**
   * Travel tastes & behavior. Collected once after first login / onboarding.
   * Presence of this object means the onboarding sheet has been completed or skipped.
   */
  travelProfile?: TravelProfile;

  preferences: UserPreferences;
  subscription: UserSubscription;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type UserProfileCreateInput = Omit<
  UserProfile,
  "createdAt" | "updatedAt" | "aiCreditsBalance" | "preferences" | "subscription"
> & {
  aiCreditsBalance?: number;
  preferences?: Partial<UserPreferences>;
  subscription?: Partial<UserSubscription>;
};

export type UserProfileUpdateInput = Partial<
  Omit<UserProfile, "createdAt" | "email">
>;
