// Taking, shrinking and uploading photos.
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { base64ToBytes } from './base64';
import { MAX_PHOTO_SIDE, PHOTO_QUALITY } from './config';
import { ApiError } from './errors';
import { supabase } from './supabase';

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

/** Opens the camera or the gallery. Returns null if the user cancels. */
export async function pickPhoto(source: 'camera' | 'gallery'): Promise<PickedPhoto | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new ApiError('camera_denied');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9, allowsEditing: false };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Shrinks the photo to a sensible size, converts it to JPEG and uploads it into the
 * signed-in user's own folder. Returns the storage path to hand to the server function.
 */
export async function uploadPhoto(
  photo: PickedPhoto,
  bucket: 'report-photos' | 'cleanup-photos',
  userId: string,
): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  const longest = Math.max(photo.width, photo.height);
  if (longest > MAX_PHOTO_SIDE) {
    if (photo.width >= photo.height) {
      context.resize({ width: MAX_PHOTO_SIDE });
    } else {
      context.resize({ height: MAX_PHOTO_SIDE });
    }
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new ApiError('photo_missing');

  const bytes = base64ToBytes(saved.base64);
  const path = `${userId}/${Crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, bytes.buffer as ArrayBuffer, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    const lower = error.message.toLowerCase();
    throw new ApiError(lower.includes('network') || lower.includes('fetch') ? 'network_error' : 'photo_missing');
  }
  return path;
}
