import {
  initializeApp,
  getApps,
  getApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

let app: App | undefined;
let db: Firestore | undefined;
let storage: Storage | undefined;

/**
 * Initialize Admin SDK once for privileged server-side access.
 * Safe to call repeatedly; required before any Admin Firestore/Storage use.
 */
export function initAdmin(): App {
  if (!app) {
    app = getApps().length === 0 ? initializeApp() : getApp();
  }
  return app;
}

export function adminDb(): Firestore {
  if (!db) {
    db = getFirestore(initAdmin());
  }
  return db;
}

export function adminStorage(): Storage {
  if (!storage) {
    storage = getStorage(initAdmin());
  }
  return storage;
}

// Ensure default app exists as soon as this module loads (Gen2 cold starts).
initAdmin();
