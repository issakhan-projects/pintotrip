import {
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  type DocumentReference,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirestoreDb, FirestorePaths } from "@/lib/firebase/firestore";
import { getDocCacheFirst } from "@/lib/firebase/cache-read";
import {
  recordCacheHit,
  recordListenerAttach,
  recordListenerDetach,
} from "@/lib/firebase/debug";
import {
  bindRealtimeAwareSubscription,
  setRealtimeSyncFromPlan,
} from "@/lib/firebase/realtime-sync";
import {
  approxNowTimestamp,
  patchUserProfileInCache,
  setUserProfileInCache,
  userProfileInFlight,
  userProfileKey,
  userProfileStore,
} from "@/lib/firebase/data-cache";
import { saveOfflineProfileSnapshot } from "@/lib/planner/offline-store";
import type { DetectedUserLocation } from "@/lib/maps/detectLocation";
import type {
  UserProfile,
  UserProfileCreateInput,
  UserProfileUpdateInput,
} from "@/types/user";
import type {
  TravelProfile,
  TravelProfileInput,
} from "@/types/travel-profile";
import { SIGNUP_AI_CREDITS } from "@/types/credits";

function userRef(userId: string): DocumentReference {
  return doc(getFirestoreDb(), FirestorePaths.users, userId);
}

/** Device UI language (primary subtag), e.g. "en" from "en-US". */
export function detectDeviceLanguage(): string {
  if (typeof navigator === "undefined") return "en";
  const raw = navigator.languages?.[0] || navigator.language || "en";
  const primary = raw.trim().split(/[-_]/)[0]?.toLowerCase();
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : "en";
}

function profileUpdatedAtMillis(profile: UserProfile | null): number {
  const ts = profile?.updatedAt;
  if (ts && typeof ts.toMillis === "function") return ts.toMillis();
  return 0;
}

function applyProfileToCache(
  userId: string,
  profile: UserProfile | null
): void {
  const key = userProfileKey(userId);
  const prev = userProfileStore.get(key);
  // Soft IndexedDB reads can finish after a hard server read — never regress
  // server-owned fields like aiCreditsBalance with an older snapshot.
  if (
    profile &&
    prev &&
    profileUpdatedAtMillis(prev) > profileUpdatedAtMillis(profile)
  ) {
    return;
  }
  setUserProfileInCache(userId, profile);
  if (profile) {
    saveOfflineProfileSnapshot(userId, profile);
  }
  if (profile?.subscription?.plan) {
    setRealtimeSyncFromPlan(profile.subscription.plan);
  }
}

/** Soft memory older than this revalidates aiCreditsBalance / plan from server. */
const PROFILE_REVALIDATE_MS = 8_000;

function queryProfileFromServer(userId: string): Promise<UserProfile | null> {
  const key = userProfileKey(userId);
  return userProfileInFlight.run(`${key}:hard`, async () => {
    try {
      const snap = await getDocCacheFirst(userRef(userId), {
        forceServer: true,
      });
      if (!snap.exists()) {
        applyProfileToCache(userId, null);
        return null;
      }
      const profile = snap.data() as UserProfile;
      applyProfileToCache(userId, profile);
      return profile;
    } catch (err) {
      const mem = userProfileStore.get(key);
      if (mem) return mem;
      throw err;
    }
  });
}

function revalidateProfileIfStale(userId: string): void {
  const entry = userProfileStore.getEntry(userProfileKey(userId));
  if (!entry) return;
  if (Date.now() - entry.updatedAt < PROFILE_REVALIDATE_MS) return;
  void queryProfileFromServer(userId);
}

export async function getUserProfile(
  userId: string,
  options?: { hard?: boolean }
): Promise<UserProfile | null> {
  const key = userProfileKey(userId);
  const hard = options?.hard === true;

  if (hard) {
    return queryProfileFromServer(userId);
  }

  if (userProfileStore.has(key)) {
    recordCacheHit();
    revalidateProfileIfStale(userId);
    return userProfileStore.get(key) ?? null;
  }

  return userProfileInFlight.run(`${key}:soft`, async () => {
    if (userProfileStore.has(key)) {
      recordCacheHit();
      revalidateProfileIfStale(userId);
      return userProfileStore.get(key) ?? null;
    }

    // Credits are server-owned — never trust IndexedDB alone on a cold start.
    return queryProfileFromServer(userId);
  });
}

/**
 * Live-or-session subscription to users/{userId}.
 * Paid + foreground → onSnapshot; free / paused → one-shot session load.
 * Detach on pause keeps memory — does not re-fetch.
 */
export function subscribeUserProfile(
  userId: string,
  onNext: (profile: UserProfile | null) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const key = userProfileKey(userId);

  // Push current memory immediately if present.
  if (userProfileStore.has(key)) {
    onNext(userProfileStore.get(key) ?? null);
  }

  const unsubStore = userProfileStore.subscribe(key, (value) => {
    // Only emit defined store updates after initial; undefined means cleared.
    if (value !== undefined) {
      onNext(value);
    }
  });

  const unbind = bindRealtimeAwareSubscription({
    attachLive: () => {
      recordListenerAttach();
      const unsub = onSnapshot(
        userRef(userId),
        (snap) => {
          const profile = snap.exists()
            ? (snap.data() as UserProfile)
            : null;
          applyProfileToCache(userId, profile);
        },
        (error) => {
          onError?.(error);
        }
      );
      return () => {
        recordListenerDetach();
        unsub();
      };
    },
    attachSession: () => {
      // Hard read: soft path used to paint stale IndexedDB aiCreditsBalance
      // after logout/login (e.g. 770 instead of the real 670).
      void getUserProfile(userId, { hard: true }).catch((error) => {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    },
  });

  return () => {
    unbind();
    unsubStore();
  };
}

export async function createUserProfile(
  userId: string,
  input: UserProfileCreateInput
): Promise<void> {
  const payload: Record<string, unknown> = {
    name: input.name,
    lastname: input.lastname,
    email: input.email,
    country: input.country,
    city: input.city,
    aiCreditsBalance: input.aiCreditsBalance ?? SIGNUP_AI_CREDITS,
    preferences: {
      emailSubscription: input.preferences?.emailSubscription ?? true,
      language: input.preferences?.language ?? detectDeviceLanguage(),
      timezone:
        input.preferences?.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      temperatureUnit: input.preferences?.temperatureUnit ?? "celsius",
      distanceUnit: input.preferences?.distanceUnit ?? "km",
      timeFormat: input.preferences?.timeFormat ?? "24h",
    },
    subscription: {
      plan: input.subscription?.plan ?? "free",
      status: input.subscription?.status ?? "active",
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.lat !== undefined) payload.lat = input.lat;
  if (input.lon !== undefined) payload.lon = input.lon;
  if (input.currency !== undefined) payload.currency = input.currency;
  if (input.photoUrl) payload.photoUrl = input.photoUrl;
  if (input.citizenship !== undefined) payload.citizenship = input.citizenship;

  await setDoc(userRef(userId), payload);

  // Patch local cache without a follow-up getDoc.
  const now = approxNowTimestamp();
  const local: UserProfile = {
    name: input.name,
    lastname: input.lastname,
    email: input.email,
    country: input.country,
    city: input.city,
    lat: input.lat,
    lon: input.lon,
    currency: input.currency,
    photoUrl: input.photoUrl,
    citizenship: input.citizenship,
    aiCreditsBalance: input.aiCreditsBalance ?? SIGNUP_AI_CREDITS,
    preferences: {
      emailSubscription: input.preferences?.emailSubscription ?? true,
      language: input.preferences?.language ?? detectDeviceLanguage(),
      timezone:
        input.preferences?.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      temperatureUnit: input.preferences?.temperatureUnit ?? "celsius",
      distanceUnit: input.preferences?.distanceUnit ?? "km",
      timeFormat: input.preferences?.timeFormat ?? "24h",
    },
    subscription: {
      plan: input.subscription?.plan ?? "free",
      status: input.subscription?.status ?? "active",
    },
    createdAt: now,
    updatedAt: now,
  };
  applyProfileToCache(userId, local);
}

function splitDisplayName(displayName: string | null | undefined): {
  name: string;
  lastname: string;
} {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { name: "Traveler", lastname: "" };
  if (parts.length === 1) return { name: parts[0], lastname: "" };
  return { name: parts[0], lastname: parts.slice(1).join(" ") };
}

function hasStoredLocation(profile: UserProfile): boolean {
  return (
    typeof profile.lat === "number" &&
    typeof profile.lon === "number" &&
    Boolean(profile.city) &&
    Boolean(profile.country)
  );
}

/**
 * Create users/{uid} if missing. Optionally attach a pre-detected location
 * (must be started during the click gesture so the browser prompts).
 * Device language is saved on create; filled once if missing on existing profiles.
 */
export async function ensureUserProfile(params: {
  userId: string;
  email: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  location?: DetectedUserLocation | null;
}): Promise<UserProfile> {
  const location = params.location ?? null;

  let existing: UserProfile | null = null;
  try {
    // Hard on login/ensure — soft IndexedDB can resurrect an old credit balance.
    existing = await getUserProfile(params.userId, { hard: true });
  } catch {
    // Read may fail before rules settle; still attempt create below.
  }

  if (existing) {
    const patch: UserProfileUpdateInput = {};

    if (location && !hasStoredLocation(existing)) {
      patch.country = location.country || existing.country;
      patch.city = location.city || existing.city;
      patch.lat = location.lat;
      patch.lon = location.lon;
    }

    if (!existing.preferences?.language?.trim()) {
      patch.preferences = {
        emailSubscription: existing.preferences?.emailSubscription ?? true,
        language: detectDeviceLanguage(),
        timezone:
          existing.preferences?.timezone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        temperatureUnit: existing.preferences?.temperatureUnit ?? "celsius",
        distanceUnit: existing.preferences?.distanceUnit ?? "km",
        timeFormat: existing.preferences?.timeFormat ?? "24h",
      };
    }

    if (Object.keys(patch).length > 0) {
      await updateUserProfile(params.userId, patch);
      return { ...existing, ...patch } as UserProfile;
    }
    return existing;
  }

  const { name, lastname } = splitDisplayName(params.displayName);

  await createUserProfile(params.userId, {
    name,
    lastname,
    email: params.email ?? "",
    country: location?.country ?? "",
    city: location?.city ?? "",
    lat: location?.lat,
    lon: location?.lon,
    photoUrl: params.photoUrl ?? undefined,
    preferences: {
      language: detectDeviceLanguage(),
    },
  });

  const created = await getUserProfile(params.userId);
  if (!created) {
    throw new Error("Failed to create user profile.");
  }
  return created;
}

/** Resolve language for AI callables: profile preference, else device. */
export async function resolveUserLanguage(userId: string): Promise<string> {
  try {
    const profile = await getUserProfile(userId);
    const saved = profile?.preferences?.language?.trim();
    if (saved) return saved;
  } catch {
    // fall through to device language
  }
  return detectDeviceLanguage();
}

export async function updateUserProfile(
  userId: string,
  input: UserProfileUpdateInput
): Promise<void> {
  await updateDoc(userRef(userId), {
    ...input,
    updatedAt: serverTimestamp(),
  });
  const next = patchUserProfileInCache(userId, input as Partial<UserProfile>);
  if (next) saveOfflineProfileSnapshot(userId, next);
  if (input.subscription?.plan) {
    setRealtimeSyncFromPlan(input.subscription.plan);
  }
}

/**
 * Save (or replace) users/{userId}.travelProfile after onboarding or edits.
 */
export async function saveTravelProfile(
  userId: string,
  input: TravelProfileInput
): Promise<void> {
  const travelProfile: TravelProfile = {
    updatedAt: Timestamp.now(),
  };

  if (input.birthday !== undefined) travelProfile.birthday = input.birthday;
  if (input.travelExperience !== undefined) {
    travelProfile.travelExperience = input.travelExperience;
  }
  if (input.countriesVisited !== undefined) {
    travelProfile.countriesVisited = input.countriesVisited;
  }
  if (input.preferredTravelTypes !== undefined) {
    travelProfile.preferredTravelTypes = input.preferredTravelTypes;
  }
  if (input.preferredTripStyle !== undefined) {
    travelProfile.preferredTripStyle = input.preferredTripStyle;
  }
  if (input.preferredTripDuration !== undefined) {
    travelProfile.preferredTripDuration = input.preferredTripDuration;
  }
  if (input.accommodationPreference !== undefined) {
    travelProfile.accommodationPreference = input.accommodationPreference;
  }
  if (input.transportationPreference !== undefined) {
    travelProfile.transportationPreference = input.transportationPreference;
  }
  if (input.travelCompanions !== undefined) {
    travelProfile.travelCompanions = input.travelCompanions;
  }
  if (input.planningStyle !== undefined) {
    travelProfile.planningStyle = input.planningStyle;
  }

  await updateUserProfile(userId, { travelProfile });
}

export function subscribeUserProfileCache(
  userId: string,
  listener: (profile: UserProfile | null | undefined) => void
): () => void {
  return userProfileStore.subscribe(userProfileKey(userId), listener);
}
