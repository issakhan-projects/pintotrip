import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  type UploadMetadata,
} from "firebase/storage";
import { getFirebaseStorage, StoragePaths } from "@/lib/firebase/storage";
import {
  prepareClientImage,
  type CompressImageOptions,
} from "@/lib/images";

const AVATAR_COMPRESS: CompressImageOptions = {
  maxSides: [512, 384],
  qualities: [0.82, 0.68, 0.52, 0.4],
  maxDataUrlChars: 600_000,
};

async function toUploadBlob(
  file: Blob,
  options?: CompressImageOptions
): Promise<{ blob: Blob; contentType: string }> {
  // Already-compressed JPEG from prepareClientImage / dataUrlToBlob.
  if (file.type === "image/jpeg" && !(file instanceof File)) {
    return { blob: file, contentType: "image/jpeg" };
  }

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
  options?: CompressImageOptions,
  metadata?: UploadMetadata
): Promise<string> {
  const { blob, contentType } = await toUploadBlob(file, options);
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, blob, {
    ...metadata,
    contentType,
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

/** Wide hero cover — compress before Storage (JPEG). */
const TRIP_COVER_COMPRESS: CompressImageOptions = {
  maxSides: [1920, 1600, 1280, 1024],
  qualities: [0.82, 0.7, 0.55, 0.42],
  maxDataUrlChars: 1_400_000,
};

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
    undefined,
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
    undefined,
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
    undefined,
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
 * Returns download URL + storage path for Firestore metadata.
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

  const { blob, contentType } = await toUploadBlob(file);
  await uploadBytes(storageRef, blob, {
    ...metadata,
    contentType,
  });
  const url = await getDownloadURL(storageRef);
  return { url, storagePath, contentType };
}

export async function deleteStorageObject(path: string): Promise<void> {
  await deleteObject(ref(getFirebaseStorage(), path));
}
