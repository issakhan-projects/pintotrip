import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFirebaseApp } from "./client";

let storage: FirebaseStorage | undefined;

export function getFirebaseStorage(): FirebaseStorage {
  if (!storage) {
    storage = getStorage(getFirebaseApp());
  }
  return storage;
}

/**
 * Conceptual Storage layout:
 *
 * users/{userId}/
 *   profile/avatar
 *   locations/{locationId}/original
 *   locations/{locationId}/image-2
 *
 * Only store user-uploaded images. Do not permanently store
 * third-party copyrighted images without licensing clearance.
 */
export const StoragePaths = {
  profileAvatar: (userId: string) => `users/${userId}/profile/avatar`,
  locationOriginal: (userId: string, locationId: string) =>
    `users/${userId}/locations/${locationId}/original`,
  locationImage: (userId: string, locationId: string, imageKey: string) =>
    `users/${userId}/locations/${locationId}/${imageKey}`,
  /** Temporary upload before a location document exists (same rules path). */
  locationDraftOriginal: (userId: string, draftId: string) =>
    `users/${userId}/locations/${draftId}/original`,
} as const;
