import { heicTo, isHeic } from "heic-to";
import { ImageUploadError } from "./errors";

/** File input accept list for client photo uploads. */
export const IMAGE_FILE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/*,.heic,.heif,.hif";

const HEIC_EXTENSIONS = new Set(["heic", "heif", "hif"]);
const HEIC_MIME_PREFIXES = [
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
];
/** ISO BMFF brands commonly used by HEIC/HEIF containers. */
const HEIC_FTYP_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "heif",
]);

const DEFAULT_MAX_SIDES = [1280, 1024, 800, 640] as const;
const DEFAULT_QUALITIES = [0.8, 0.68, 0.52, 0.4] as const;
/** Target JPEG data URL size for AI / callable payloads (~1.8M chars). */
const DEFAULT_MAX_DATA_URL_CHARS = 1_800_000;
/** Reject enormous camera dumps before decoding into memory. */
const ABSOLUTE_MAX_FILE_BYTES = 40 * 1024 * 1024;

export type CompressImageOptions = {
  maxSides?: readonly number[];
  qualities?: readonly number[];
  maxDataUrlChars?: number;
};

export type PreparedClientImage = {
  dataUrl: string;
  blob: Blob;
};

function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i + 1).toLowerCase();
}

function isSafariBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Android|Edg/i.test(ua);
}

function readFourCc(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) return "";
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!
  );
}

/** Detect HEIC/HEIF via MIME, extension, or ftyp brands in the file header. */
export async function detectHeicContainer(file: Blob): Promise<boolean> {
  const mime = (file.type || "").toLowerCase().trim();
  if (HEIC_MIME_PREFIXES.some((p) => mime === p || mime.startsWith(`${p}`))) {
    return true;
  }

  if (file instanceof File) {
    const ext = fileExtension(file.name);
    if (HEIC_EXTENSIONS.has(ext)) return true;
  }

  try {
    if (file instanceof File && (await isHeic(file))) return true;
  } catch {
    // Fall through to ftyp sniffing.
  }

  try {
    const header = new Uint8Array(await file.slice(0, 128).arrayBuffer());
    if (header.length < 12) return false;
    if (readFourCc(header, 4) !== "ftyp") return false;
    const major = readFourCc(header, 8);
    if (HEIC_FTYP_BRANDS.has(major)) return true;
    for (let offset = 16; offset + 4 <= header.length; offset += 4) {
      if (HEIC_FTYP_BRANDS.has(readFourCc(header, offset))) return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Treat as an image when MIME starts with image/, or empty /
 * application/octet-stream with a HEIC-family extension (iPhone gallery).
 */
export function isAcceptedImageFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase().trim();
  if (mime.startsWith("image/")) return true;

  const ext = fileExtension(file.name);
  if (
    (!mime || mime === "application/octet-stream") &&
    HEIC_EXTENSIONS.has(ext)
  ) {
    return true;
  }

  return false;
}

async function convertHeicToJpeg(blob: Blob): Promise<Blob> {
  try {
    return await heicTo({
      blob,
      type: "image/jpeg",
      quality: 0.9,
    });
  } catch {
    throw new ImageUploadError("unreadable", "Could not read photo.");
  }
}

/**
 * Safari can often decode HEIC natively — prefer that and skip WASM conversion.
 * Elsewhere, convert HEIC → JPEG before canvas / ImageBitmap.
 */
async function decodeSourceBlob(file: Blob): Promise<{
  blob: Blob;
  convertedFromHeic: boolean;
}> {
  const heic = await detectHeicContainer(file);
  if (!heic) return { blob: file, convertedFromHeic: false };

  if (isSafariBrowser()) {
    try {
      const probe = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      probe.close();
      return { blob: file, convertedFromHeic: false };
    } catch {
      // Fall through to heic-to.
    }
  }

  return {
    blob: await convertHeicToJpeg(file),
    convertedFromHeic: true,
  };
}

async function createOrientedBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

function drawScaledJpegDataUrl(
  bitmap: ImageBitmap,
  maxSide: number,
  quality: number
): string {
  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  const scale = longest > maxSide ? maxSide / longest : 1;
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ImageUploadError("unreadable", "Could not read photo.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  if (!dataUrl.startsWith("data:image/jpeg")) {
    throw new ImageUploadError("unreadable", "Could not read photo.");
  }
  return dataUrl;
}

function ladderCompress(
  bitmap: ImageBitmap,
  options: Required<
    Pick<CompressImageOptions, "maxSides" | "qualities" | "maxDataUrlChars">
  >
): string {
  let best: string | null = null;

  for (const maxSide of options.maxSides) {
    for (const quality of options.qualities) {
      const dataUrl = drawScaledJpegDataUrl(bitmap, maxSide, quality);
      if (!best || dataUrl.length < best.length) best = dataUrl;
      if (dataUrl.length <= options.maxDataUrlChars) {
        return dataUrl;
      }
    }
  }

  if (!best) {
    throw new ImageUploadError("unreadable", "Could not read photo.");
  }
  return best;
}

/**
 * Decode (incl. HEIC), apply EXIF orientation, downscale + JPEG quality ladder
 * until the data URL is ≤ ~1.8M chars. Never send raw HEIC or multi‑MB originals.
 */
export async function compressImageToDataUrl(
  file: Blob,
  options: CompressImageOptions = {}
): Promise<string> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    throw new ImageUploadError("unreadable", "Could not read photo.");
  }

  if (file.size > ABSOLUTE_MAX_FILE_BYTES) {
    throw new ImageUploadError("too_large", "Photo too large.");
  }

  const maxSides = options.maxSides ?? DEFAULT_MAX_SIDES;
  const qualities = options.qualities ?? DEFAULT_QUALITIES;
  const maxDataUrlChars = options.maxDataUrlChars ?? DEFAULT_MAX_DATA_URL_CHARS;
  const ladderOpts = { maxSides, qualities, maxDataUrlChars };

  let source = await decodeSourceBlob(file);
  let convertedFromHeic = source.convertedFromHeic;

  const attempt = async (blob: Blob): Promise<string> => {
    const bitmap = await createOrientedBitmap(blob);
    try {
      return ladderCompress(bitmap, ladderOpts);
    } finally {
      bitmap.close();
    }
  };

  try {
    return await attempt(source.blob);
  } catch (firstErr) {
    // Draw/decode failed — force HEIC → JPEG then retry once.
    if (!convertedFromHeic && (await detectHeicContainer(file))) {
      try {
        source = {
          blob: await convertHeicToJpeg(file),
          convertedFromHeic: true,
        };
        convertedFromHeic = true;
        return await attempt(source.blob);
      } catch {
        throw new ImageUploadError("unreadable", "Could not read photo.");
      }
    }

    if (firstErr instanceof ImageUploadError) throw firstErr;
    throw new ImageUploadError("unreadable", "Could not read photo.");
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) {
    throw new ImageUploadError("unreadable", "Could not read photo.");
  }
  const meta = dataUrl.slice(5, comma); // after "data:"
  const data = dataUrl.slice(comma + 1);
  const isBase64 = /;base64$/i.test(meta) || /;base64;/i.test(meta);
  const mime = (meta.split(";")[0] || "image/jpeg").trim() || "image/jpeg";
  if (isBase64) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

/**
 * Validate + compress a user-picked file for preview, AI, and Storage.
 */
export async function prepareClientImage(
  file: File,
  options?: CompressImageOptions
): Promise<PreparedClientImage> {
  if (!isAcceptedImageFile(file)) {
    throw new ImageUploadError("unsupported", "Unsupported file.");
  }
  if (file.size > ABSOLUTE_MAX_FILE_BYTES) {
    throw new ImageUploadError("too_large", "Photo too large.");
  }

  const dataUrl = await compressImageToDataUrl(file, options);
  if (dataUrl.length > (options?.maxDataUrlChars ?? DEFAULT_MAX_DATA_URL_CHARS) * 1.5) {
    throw new ImageUploadError("too_large", "Photo too large.");
  }

  return {
    dataUrl,
    blob: dataUrlToBlob(dataUrl),
  };
}
