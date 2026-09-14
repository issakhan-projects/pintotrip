import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  type UploadMetadata,
} from "firebase/storage";
import { getFirebaseStorage, StoragePaths } from "@/lib/firebase/storage";

/** OpenAI high-detail vision tiles around this size — larger uploads waste tokens. */
const AI_IMAGE_MAX_EDGE = 2048;
const AI_IMAGE_JPEG_QUALITY = 0.85;

/**
 * Downscale oversized photos for findPlace without harming recognition quality.
 * Phones often shoot 4000px+; OpenAI already tiles ~2048-class inputs.
 */
async function prepareImageForAI(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const maxEdge = Math.max(width, height);
    if (maxEdge <= AI_IMAGE_MAX_EDGE) {
      bitmap.close();
      return file;
    }

    const scale = AI_IMAGE_MAX_EDGE / maxEdge;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", AI_IMAGE_JPEG_QUALITY);
    });
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function uploadProfileAvatar(
  userId: string,
  file: Blob,
  metadata?: UploadMetadata
): Promise<string> {
  const storageRef = ref(
    getFirebaseStorage(),
    StoragePaths.profileAvatar(userId)
  );
  await uploadBytes(storageRef, file, metadata);
  return getDownloadURL(storageRef);
}

export async function uploadLocationOriginalImage(
  userId: string,
  locationId: string,
  file: Blob,
  metadata?: UploadMetadata
): Promise<string> {
  const storageRef = ref(
    getFirebaseStorage(),
    StoragePaths.locationOriginal(userId, locationId)
  );
  await uploadBytes(storageRef, file, metadata);
  return getDownloadURL(storageRef);
}

/** Upload an image for AI analysis before the location doc is created. */
export async function uploadLocationDraftImage(
  userId: string,
  draftId: string,
  file: Blob,
  metadata?: UploadMetadata
): Promise<string> {
  const prepared = await prepareImageForAI(file);
  const storageRef = ref(
    getFirebaseStorage(),
    StoragePaths.locationDraftOriginal(userId, draftId)
  );
  const contentType =
    prepared.type && prepared.type.startsWith("image/")
      ? prepared.type
      : "image/jpeg";

  await uploadBytes(storageRef, prepared, {
    contentType,
    ...metadata,
  });
  return getDownloadURL(storageRef);
}

export async function uploadLocationImage(
  userId: string,
  locationId: string,
  imageKey: string,
  file: Blob,
  metadata?: UploadMetadata
): Promise<string> {
  const storageRef = ref(
    getFirebaseStorage(),
    StoragePaths.locationImage(userId, locationId, imageKey)
  );
  await uploadBytes(storageRef, file, metadata);
  return getDownloadURL(storageRef);
}

export async function deleteStorageObject(path: string): Promise<void> {
  await deleteObject(ref(getFirebaseStorage(), path));
}
