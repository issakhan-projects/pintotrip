import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  type UploadMetadata,
} from "firebase/storage";
import { getFirebaseStorage, StoragePaths } from "@/lib/firebase/storage";
import {
  ImageUploadError,
  STORAGE_IMAGE_MAX_BYTES,
  prepareClientImage,
  storageImageCompressOptions,
  type CompressImageOptions,
} from "@/lib/images";

const AVATAR_COMPRESS = storageImageCompressOptions({
  maxSides: [512, 384],
  qualities: [0.82, 0.68, 0.52, 0.4],
});

const TRIP_COVER_COMPRESS = storageImageCompressOptions({
  maxSides: [1920, 1600, 1280, 1024, 800, 640],
  qualities: [0.82, 0.7, 0.55, 0.42, 0.32],
});

const LOCATION_STORAGE_COMPRESS = storageImageCompressOptions();

async function toUploadBlob(
  file: Blob,
  options: CompressImageOptions
): Promise<{ blob: Blob; contentType: string }> {
  if (file instanceof File) {
    const prepared = await prepareClientImage(file, options);
    return { blob: prepared.blob, contentType: "image/jpeg" };
  }

  // Generic Blob — wrap as File for the same HEIC + compress pipeline.
  const asFile = new File([file], "upload.jpg", {
    type: file.type?.startsWith("image/") ? file.type : "image/jpeg",
  });
  const prepared = await prepareClientImage(asFile, options);
  return { blob: prepared.blob, contentType: "image/jpeg" };
}

async function uploadImageBytes(
  path: string,
  file: Blob,
  options: CompressImageOptions,
  metadata?: UploadMetadata
): Promise<string> {
  // Always re-apply the 300 KB JPEG cap — never trust a pre-sized blob alone.
  const capped = storageImageCompressOptions(options);
  const { blob } = await toUploadBlob(file, capped);
  if (blob.size <= 0 || blob.size > STORAGE_IMAGE_MAX_BYTES) {
    throw new ImageUploadError("too_large", "Photo too large (max 300 KB).");
  }
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, blob, {
    ...metadata,
    contentType: "image/jpeg",
  });
  return getDownloadURL(storageRef);
}

export async function uploadProfileAvatar(
  userId: string,
  file: Blob,
  metadata?: UploadMetadata
): Promise<string> {
  return uploadImageBytes(
    StoragePaths.profileAvatar(userId),
    file,
    AVATAR_COMPRESS,
    metadata
  );
}

export async function uploadTripCover(
  userId: string,
  tripId: string,
  file: Blob,
  metadata?: UploadMetadata
): Promise<string> {
  return uploadImageBytes(
    StoragePaths.tripCover(userId, tripId),
    file,
    TRIP_COVER_COMPRESS,
    metadata
  );
}

export async function uploadLocationOriginalImage(
  userId: string,
  locationId: string,
  file: Blob,
  metadata?: UploadMetadata
): Promise<string> {
  return uploadImageBytes(
    StoragePaths.locationOriginal(userId, locationId),
    file,
    LOCATION_STORAGE_COMPRESS,
    metadata
  );
}

/** Upload an image for AI analysis before the location doc is created. */
export async function uploadLocationDraftImage(
  userId: string,
  draftId: string,
  file: Blob,
  metadata?: UploadMetadata
): Promise<string> {
  return uploadImageBytes(
    StoragePaths.locationDraftOriginal(userId, draftId),
    file,
    LOCATION_STORAGE_COMPRESS,
    metadata
  );
}

export async function uploadLocationImage(
  userId: string,
  locationId: string,
  imageKey: string,
  file: Blob,
  metadata?: UploadMetadata
): Promise<string> {
  return uploadImageBytes(
    StoragePaths.locationImage(userId, locationId, imageKey),
    file,
    LOCATION_STORAGE_COMPRESS,
    metadata
  );
}

const ROUTE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

function isPdfFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

/**
 * Upload a ticket/boarding-pass attachment for a trip route (image or PDF).
 * Images are JPEG-compressed to ≤ 300 KB; PDFs keep the 10 MB cap.
 */
export async function uploadRouteAttachment(
  userId: string,
  tripId: string,
  routeId: string,
  fileId: string,
  file: File,
  metadata?: UploadMetadata
): Promise<{ url: string; storagePath: string; contentType: string }> {
  if (file.size > ROUTE_ATTACHMENT_MAX_BYTES) {
    throw new Error("File is too large (max 10 MB).");
  }

  const storagePath = StoragePaths.tripRouteAttachment(
    userId,
    tripId,
    routeId,
    fileId
  );
  const storageRef = ref(getFirebaseStorage(), storagePath);

  if (isPdfFile(file)) {
    await uploadBytes(storageRef, file, {
      ...metadata,
      contentType: "application/pdf",
    });
    const url = await getDownloadURL(storageRef);
    return { url, storagePath, contentType: "application/pdf" };
  }

  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif|hif)$/i.test(file.name)) {
    throw new Error("Only images and PDF files are supported.");
  }

  const { blob } = await toUploadBlob(
    file,
    storageImageCompressOptions()
  );
  if (blob.size <= 0 || blob.size > STORAGE_IMAGE_MAX_BYTES) {
    throw new ImageUploadError("too_large", "Photo too large (max 300 KB).");
  }
  await uploadBytes(storageRef, blob, {
    ...metadata,
    contentType: "image/jpeg",
  });
  const url = await getDownloadURL(storageRef);
  return { url, storagePath, contentType: "image/jpeg" };
}

export async function deleteStorageObject(path: string): Promise<void> {
  await deleteObject(ref(getFirebaseStorage(), path));
}

/** Best-effort delete from a Firebase Storage download URL. */
export async function deleteStorageObjectByUrl(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("firebasestorage.googleapis.com")) return;
    const match = parsed.pathname.match(/\/o\/(.+)$/);
    if (!match?.[1]) return;
    await deleteStorageObject(decodeURIComponent(match[1]));
  } catch {
    // Ignore missing/unauthorized objects — caller already updated metadata.
  }
}
