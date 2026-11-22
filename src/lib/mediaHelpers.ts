import type { BlockType } from '../types/database';

/** Private Supabase Storage bucket holding room task photos and expense receipts. */
export const ROOM_MEDIA_BUCKET = 'room-media';

/** Hard per-image upload limit (5 MB), aligned with `storage.buckets.file_size_limit`. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Signed URL validity window (1 hour) for private `room-media` image rendering. */
export const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60;

/** Domain error codes produced by media path validation, size checks, or Storage uploads. */
export type MediaUploadErrorCode =
  | 'IMAGE_TOO_LARGE'
  | 'MEDIA_PERMISSION_DENIED'
  | 'INVALID_MEDIA_PATH'
  | 'UPLOAD_FAILED';

/** Typed error for room media validation and upload failures. */
export class MediaUploadError extends Error {
  public readonly code: MediaUploadErrorCode;

  constructor(code: MediaUploadErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'MediaUploadError';
    this.code = code;
    Object.setPrototypeOf(this, MediaUploadError.prototype);
  }
}

const MEDIA_ERROR_MESSAGES: Record<MediaUploadErrorCode, string> = {
  IMAGE_TOO_LARGE: '图片大小不能超过 5MB，请重新选择或压缩后再试',
  MEDIA_PERMISSION_DENIED: '需要相册或相机权限才能上传图片',
  INVALID_MEDIA_PATH: '图片地址无效，无法加载',
  UPLOAD_FAILED: '图片上传失败，请检查网络后重试',
};

/** Maps `MediaUploadError` or Storage errors to crisp Chinese user-facing messages. */
export function mapMediaUploadError(err: unknown): string {
  if (err instanceof MediaUploadError) {
    return MEDIA_ERROR_MESSAGES[err.code];
  }
  if (err instanceof Error && err.message.includes('IMAGE_TOO_LARGE')) {
    return MEDIA_ERROR_MESSAGES.IMAGE_TOO_LARGE;
  }
  return MEDIA_ERROR_MESSAGES.UPLOAD_FAILED;
}

function generateUniqueMediaToken(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
}

function normalizeExtension(rawExt: string): string {
  const cleaned = rawExt.trim().replace(/^\.+/, '').toLowerCase();
  if (cleaned === 'jpeg') {
    return 'jpg';
  }
  if (/^[a-z0-9]{2,5}$/.test(cleaned)) {
    return cleaned;
  }
  return 'jpg';
}

function sanitizePathSegment(value: string, label: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed.includes('/') || trimmed.includes('..')) {
    throw new MediaUploadError(
      'INVALID_MEDIA_PATH',
      `INVALID_MEDIA_PATH: invalid ${label}`,
    );
  }
  return trimmed;
}

/**
 * Generates a unique Storage object key matching `002_rls_policies.sql`:
 * `{room_id}/{block_type}/{item_id}/{uuid}.{ext}`.
 */
export function buildRoomMediaPath(
  roomId: string,
  blockType: BlockType,
  itemId: string,
  ext: string,
): string {
  const safeRoomId = sanitizePathSegment(roomId, 'roomId');
  const safeItemId = sanitizePathSegment(itemId, 'itemId');
  const normalizedExt = normalizeExtension(ext);
  const token = generateUniqueMediaToken();
  return `${safeRoomId}/${blockType}/${safeItemId}/${token}.${normalizedExt}`;
}

/**
 * Builds the canonical authenticated Supabase Storage URL saved inside `imageUrls` / `receiptUrl`
 * so Zod URL checks succeed while the bucket remains private.
 */
export function buildCanonicalMediaUrl(
  supabaseBaseUrl: string,
  storagePath: string,
): string {
  const cleanBase = supabaseBaseUrl.trim().replace(/\/+$/, '');
  const cleanPath = storagePath.trim().replace(/^\/+/, '');
  return `${cleanBase}/storage/v1/object/authenticated/${ROOM_MEDIA_BUCKET}/${cleanPath}`;
}

/**
 * Extracts the bucket-relative `storagePath` from a canonical authenticated/signed URL
 * or passes through a valid bucket-relative `{room}/{type}/{item}/{file}` path.
 * Returns `null` for external URLs, other buckets, or malformed strings.
 */
export function extractMediaStoragePath(url: string): string | null {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    let pathname = '';
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return null;
    }

    const match =
      /\/storage\/v1\/object\/(?:(?:authenticated|public|sign)\/)?room-media\/(.+)$/.exec(
        pathname,
      );
    if (!match?.[1]) {
      return null;
    }

    let decoded = '';
    try {
      decoded = decodeURIComponent(match[1]).replace(/^\/+/, '');
    } catch {
      return null;
    }
    if (!decoded || decoded.includes('..')) {
      return null;
    }
    return decoded;
  }

  const withoutLeadingSlash = trimmed.replace(/^\/+/, '');
  const strippedBucket = withoutLeadingSlash.startsWith(`${ROOM_MEDIA_BUCKET}/`)
    ? withoutLeadingSlash.slice(`${ROOM_MEDIA_BUCKET}/`.length)
    : withoutLeadingSlash;

  const segments = strippedBucket.split('/').filter(Boolean);
  if (segments.length < 3 || strippedBucket.includes('..')) {
    return null;
  }

  return strippedBucket;
}

/** Verifies an image byte count does not exceed `MAX_IMAGE_BYTES` (5 MB). */
export function validateImageSizeBytes(bytes: number | undefined): void {
  if (bytes === undefined) {
    return;
  }
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new MediaUploadError('UPLOAD_FAILED', 'INVALID_IMAGE_SIZE');
  }
  if (bytes > MAX_IMAGE_BYTES) {
    throw new MediaUploadError('IMAGE_TOO_LARGE', 'IMAGE_TOO_LARGE');
  }
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
};

/** Infers a safe normalized file extension from an `ImagePickerAsset` metadata object. */
export function inferImageExtension(asset: {
  fileName?: string | null;
  mimeType?: string | null;
  uri?: string;
}): string {
  const mime = asset.mimeType?.trim().toLowerCase();
  if (mime && MIME_TO_EXT[mime]) {
    return MIME_TO_EXT[mime];
  }

  const candidate = asset.fileName || asset.uri || '';
  const withoutQuery = candidate.split(/[?#]/)[0] ?? '';
  const lastDot = withoutQuery.lastIndexOf('.');
  if (lastDot !== -1 && lastDot < withoutQuery.length - 1) {
    return normalizeExtension(withoutQuery.slice(lastDot + 1));
  }

  return 'jpg';
}

/** Resolves the HTTP Content-Type header for a normalized image extension. */
export function getContentTypeForExtension(ext: string): string {
  const normalized = normalizeExtension(ext);
  return EXT_TO_MIME[normalized] ?? 'image/jpeg';
}
