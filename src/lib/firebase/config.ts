import type { FirebaseOptions } from "firebase/app";
import { getFirebasePublicEnv, hasPublicEnvConfigured } from "@/lib/env";

/**
 * Firebase web app configuration (public client values only).
 */
export function getFirebaseConfig(): FirebaseOptions {
  const firebase = getFirebasePublicEnv();

  return {
    apiKey: firebase.apiKey,
    authDomain: firebase.authDomain,
    projectId: firebase.projectId,
    storageBucket: firebase.storageBucket,
    messagingSenderId: firebase.messagingSenderId,
    appId: firebase.appId,
    ...(firebase.measurementId
      ? { measurementId: firebase.measurementId }
      : {}),
  };
}

export { hasPublicEnvConfigured };
