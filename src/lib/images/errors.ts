export type ImageUploadErrorCode =
  | "unsupported"
  | "too_large"
  | "unreadable";

export class ImageUploadError extends Error {
  readonly code: ImageUploadErrorCode;

  constructor(code: ImageUploadErrorCode, message: string) {
    super(message);
    this.name = "ImageUploadError";
    this.code = code;
  }
}

export function imageUploadErrorMessage(err: unknown): string {
  if (err instanceof ImageUploadError) return err.message;
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Could not read photo.";
}
