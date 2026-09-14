import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
  memoryLocalCache,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseApp } from "./client";
import { installFirestoreDebugGlobals } from "./debug";

let db: Firestore | undefined;
let persistenceMode: "multi-tab" | "single-tab" | "memory" | "default" =
  "default";

function buildPersistentCache(): ReturnType<typeof persistentLocalCache> | ReturnType<typeof memoryLocalCache> {
  try {
    persistenceMode = "multi-tab";
    return persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    });
  } catch {
    try {
      persistenceMode = "single-tab";
      return persistentLocalCache({
        tabManager: persistentSingleTabManager(undefined),
      });
    } catch {
      persistenceMode = "memory";
      return memoryLocalCache();
    }
  }
}

function tryInitializeWithPersistence(): Firestore {
  const app = getFirebaseApp();

  try {
    return initializeFirestore(app, {
      localCache: buildPersistentCache(),
    });
  } catch {
    // Already initialized (HMR / race) or persistence unsupported.
    try {
      persistenceMode = "single-tab";
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentSingleTabManager(undefined),
        }),
      });
    } catch {
      try {
        persistenceMode = "memory";
        return initializeFirestore(app, {
          localCache: memoryLocalCache(),
        });
      } catch {
        persistenceMode = "default";
        return getFirestore(app);
      }
    }
  }
}

export function getFirestoreDb(): Firestore {
  if (!db) {
    if (typeof window === "undefined") {
      // SSR / Node: memory / default (no IndexedDB).
      db = getFirestore(getFirebaseApp());
      persistenceMode = "default";
    } else {
      db = tryInitializeWithPersistence();
      installFirestoreDebugGlobals();
    }
  }
  return db;
}

export function getFirestorePersistenceMode(): typeof persistenceMode {
  return persistenceMode;
}

/** Collection / path helpers — keep paths consistent across the app. */
export const FirestorePaths = {
  users: "users",
  user: (userId: string) => `users/${userId}`,
  locations: (userId: string) => `users/${userId}/locations`,
  location: (userId: string, locationId: string) =>
    `users/${userId}/locations/${locationId}`,
  favoriteCities: (userId: string) => `users/${userId}/favoriteCities`,
  favoriteCity: (userId: string, cityId: string) =>
    `users/${userId}/favoriteCities/${cityId}`,
  /** Global AI cost aggregate: aiUsage/{yyyy-MM} */
  aiUsage: "aiUsage",
  aiUsageMonth: (yearMonth: string) => `aiUsage/${yearMonth}`,
  /** In-app reviews: reviews/{userId} — written by Cloud Functions only */
  reviews: "reviews",
  review: (userId: string) => `reviews/${userId}`,
  /** Referral invites: referrals/{referralId} — Admin write only */
  referrals: "referrals",
  referral: (referralId: string) => `referrals/${referralId}`,
  /** Inbox: users/{userId}/notifications/{notificationId} */
  notifications: (userId: string) => `users/${userId}/notifications`,
  notification: (userId: string, notificationId: string) =>
    `users/${userId}/notifications/${notificationId}`,
  /** Per-user trips: users/{userId}/tripPlanner/{tripId} */
  tripPlanner: (userId: string) => `users/${userId}/tripPlanner`,
  trip: (userId: string, tripId: string) =>
    `users/${userId}/tripPlanner/${tripId}`,
  /** Global promo codes: promoCodes/{CODE} */
  promoCodes: "promoCodes",
  promoCode: (code: string) => `promoCodes/${code}`,
  /** Billing ledger: transactions/{paddleTransactionId} — Admin write */
  transactions: "transactions",
  transaction: (transactionId: string) => `transactions/${transactionId}`,
  /**
   * Global Travel Intelligence (Admin write / signed-in read).
   * Nested as travelIntelligence/{bucket}/items/{id} for valid Firestore paths.
   */
  travelIntelligencePlaces: "travelIntelligence/places/items",
  travelIntelligencePlace: (placeId: string) =>
    `travelIntelligence/places/items/${placeId}`,
  travelIntelligenceCities: "travelIntelligence/cities/items",
  travelIntelligenceCity: (cityId: string) =>
    `travelIntelligence/cities/items/${cityId}`,
  travelIntelligenceCountries: "travelIntelligence/countries/items",
  travelIntelligenceCountry: (countryId: string) =>
    `travelIntelligence/countries/items/${countryId}`,
  travelIntelligenceDaily: "travelIntelligence/daily/items",
  travelIntelligenceDailyDay: (date: string) =>
    `travelIntelligence/daily/items/${date}`,
} as const;
