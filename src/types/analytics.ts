/**
 * Product analytics event names.
 * Track via the analytics service — never call PostHog directly from components.
 */
export const AnalyticsEvents = {
  SIGNUP_STARTED: "signup_started",
  SIGNUP_COMPLETED: "signup_completed",
  GOOGLE_SIGNUP: "google_signup",
  LOGIN: "login",
  ADD_PLACE_STARTED: "add_place_started",
  IMAGE_UPLOADED: "image_uploaded",
  LINK_SUBMITTED: "link_submitted",
  LOCATION_ANALYSIS_STARTED: "location_analysis_started",
  LOCATION_ANALYSIS_COMPLETED: "location_analysis_completed",
  LOCATION_SAVED: "location_saved",
  LOCATION_REJECTED: "location_rejected",
  PLACE_VIEWED: "place_viewed",
  STATUS_CHANGED: "status_changed",
  PLACE_VISITED: "place_visited",
  CITY_OPENED: "city_opened",
  CITY_INTELLIGENCE_VIEWED: "city_intelligence_viewed",
  MAP_OPENED: "map_opened",
  LIST_OPENED: "list_opened",
  SEARCH_USED: "search_used",
  PROFILE_OPENED: "profile_opened",
  PROFILE_STATISTICS_CLICKED: "profile_statistics_clicked",
  AI_CREDITS_VIEWED: "ai_credits_viewed",
  UPGRADE_CLICKED: "upgrade_clicked",
  TRAVEL_PREFERENCES_OPENED: "travel_preferences_opened",
  TRAVEL_PROFILE_SHOWN: "travel_profile_shown",
  TRAVEL_PROFILE_COMPLETED: "travel_profile_completed",
  TRAVEL_PROFILE_SKIPPED: "travel_profile_skipped",
  ACCOUNT_OPENED: "account_opened",
  SUBSCRIPTION_OPENED: "subscription_opened",
  SETTINGS_OPENED: "settings_opened",
  LOGOUT_COMPLETED: "logout_completed",
  PRICING_PAGE_VIEWED: "pricing_page_viewed",
  PRICING_PLAN_CLICKED: "pricing_plan_clicked",
  REVIEW_PROMPT_SHOWN: "review_prompt_shown",
  REVIEW_PROMPT_DISMISSED: "review_prompt_dismissed",
  REVIEW_SUBMITTED: "review_submitted",
  INVITE_OPENED: "invite_opened",
  INVITE_CREATED: "invite_created",
  INVITE_COPIED: "invite_copied",
  INVITE_SHARED: "invite_shared",
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null | undefined
>;
