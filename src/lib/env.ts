/**
 * Public client environment (safe for NEXT_PUBLIC_*).
 * Secrets must NEVER be placed here.
 *
 * IMPORTANT: Next.js only inlines NEXT_PUBLIC_* vars when accessed as
 * static literals (process.env.NEXT_PUBLIC_FOO). Dynamic access like
 * process.env[name] is undefined in the browser bundle.
 *
 * Firebase, Maps, and PostHog are loaded independently so missing
 * analytics/maps keys do not block auth or other features.
 */

function missingEnv(name: string): never {
  throw new Error(
    `Missing required public environment variable: ${name}. See .env.example.`
  );
}

export interface FirebasePublicEnv {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

export interface PublicEnv {
  firebase: FirebasePublicEnv;
  googleMaps: {
    apiKey?: string;
  };
  posthog: {
    key?: string;
    host: string;
  };
}

let cachedFirebase: FirebasePublicEnv | null = null;
let cached: PublicEnv | null = null;

/**
 * Firebase web config only — required for Auth, Firestore, Storage.
 */
export function getFirebasePublicEnv(): FirebasePublicEnv {
  if (cachedFirebase) return cachedFirebase;

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const measurementId = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;

  if (!apiKey) missingEnv("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!authDomain) missingEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!projectId) missingEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!storageBucket) missingEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (!messagingSenderId) missingEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
  if (!appId) missingEnv("NEXT_PUBLIC_FIREBASE_APP_ID");

  cachedFirebase = {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    ...(measurementId ? { measurementId } : {}),
  };

  return cachedFirebase;
}

/**
 * Validates and returns public client configuration.
 * Call from browser/client code only. Does not read server secrets.
 * Maps and PostHog keys are optional until those features are used.
 */
export function getPublicEnv(): PublicEnv {
  if (cached) return cached;

  cached = {
    firebase: getFirebasePublicEnv(),
    googleMaps: {
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || undefined,
    },
    posthog: {
      key: process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined,
      host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    },
  };

  return cached;
}

/**
 * Soft check for build-time / scaffolding — does not throw.
 * True when Firebase (minimum for the app shell) is configured.
 */
export function hasPublicEnvConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  );
}

export function hasPostHogConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

export function hasGoogleMapsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
}
