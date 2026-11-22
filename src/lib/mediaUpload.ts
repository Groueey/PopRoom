import * as ImagePicker from 'expo-image-picker';
import {
  MediaUploadError,
  ROOM_MEDIA_BUCKET,
  SIGNED_URL_EXPIRES_IN_SECONDS,
  buildCanonicalMediaUrl,
  buildRoomMediaPath,
  extractMediaStoragePath,
  getContentTypeForExtension,
  inferImageExtension,
  validateImageSizeBytes,
} from './mediaHelpers';
import { supabase } from './supabase';
import type { BlockType } from '../types/database';

export * from './mediaHelpers';

/** Parameters accepted by `pickAndUploadRoomImage`. */
export interface PickAndUploadRoomImageParams {
  roomId: string;
  blockType: BlockType;
  itemId: string;
  source?: 'library' | 'camera';
}

function getSupabaseBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return 'https://placeholder.supabase.co';
}

/**
 * Picks or captures an image via `expo-image-picker` (`quality: 0.7`), enforces the 5 MB limit,
 * uploads it to the private `room-media` bucket, and returns its canonical authenticated object URL
 * (or `null` if the user canceled the picker).
 */
export async function pickAndUploadRoomImage(
  params: PickAndUploadRoomImageParams,
): Promise<string | null> {
  const source = params.source ?? 'library';

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new MediaUploadError('MEDIA_PERMISSION_DENIED');
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new MediaUploadError('MEDIA_PERMISSION_DENIED');
    }
  }

  const pickerOptions: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 0.7,
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }

  const asset = result.assets[0];
  validateImageSizeBytes(asset.fileSize);

  let arrayBuffer: ArrayBuffer;
  if (asset.file) {
    arrayBuffer = await asset.file.arrayBuffer();
  } else {
    const response = await fetch(asset.uri);
    if (!response.ok && response.status !== 0) {
      throw new MediaUploadError('UPLOAD_FAILED', '无法读取所选图片内容');
    }
    arrayBuffer = await response.arrayBuffer();
  }

  if (arrayBuffer.byteLength === 0) {
    throw new MediaUploadError('UPLOAD_FAILED', '图片内容为空，请重新选择');
  }

  validateImageSizeBytes(arrayBuffer.byteLength);

  const ext = inferImageExtension(asset);
  const contentType = getContentTypeForExtension(ext);
  const storagePath = buildRoomMediaPath(
    params.roomId,
    params.blockType,
    params.itemId,
    ext,
  );

  const { error: uploadError } = await supabase.storage
    .from(ROOM_MEDIA_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new MediaUploadError('UPLOAD_FAILED', uploadError.message);
  }

  return buildCanonicalMediaUrl(getSupabaseBaseUrl(), storagePath);
}

/**
 * Extracts the private `room-media` storage path from a canonical URL (or relative path)
 * and requests a 1-hour signed URL for rendering inside `<Image>`.
 */
export async function getSignedMediaUrl(
  canonicalOrPath: string,
): Promise<string> {
  const storagePath = extractMediaStoragePath(canonicalOrPath);
  if (!storagePath) {
    throw new MediaUploadError('INVALID_MEDIA_PATH');
  }

  const { data, error } = await supabase.storage
    .from(ROOM_MEDIA_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error || !data?.signedUrl) {
    throw new MediaUploadError(
      'UPLOAD_FAILED',
      error?.message ?? '无法获取图片临时访问地址',
    );
  }

  return data.signedUrl;
}
