export {
  IMAGE_FILE_ACCEPT,
  LOCATION_STORAGE_MAX_BYTES,
  STORAGE_IMAGE_MAX_BYTES,
  compressImageToDataUrl,
  dataUrlToBlob,
  detectHeicContainer,
  isAcceptedImageFile,
  prepareClientImage,
  storageImageCompressOptions,
  type CompressImageOptions,
  type PreparedClientImage,
} from "./clientImage";
export {
  ImageUploadError,
  imageUploadErrorMessage,
  type ImageUploadErrorCode,
} from "./errors";
