import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getFirebaseConfig } from "./config";

let app: FirebaseApp | undefined;

/**
 * Singleton Firebase app instance for the browser client.
 * Never initialize Firebase more than once.
 */
export function getFirebaseApp(): FirebaseApp {
  if (app) return app;

  app = getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
  return app;
}
