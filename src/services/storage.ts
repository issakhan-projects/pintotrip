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

export async function deleteStorageObject(path: string): Promise<void> {
  await deleteObject(ref(getFirebaseStorage(), path));
}
