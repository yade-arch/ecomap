// Taking, shrinking and uploading photos.
// Photos come ONLY from the live camera (no gallery), so downloaded or AI-generated images cannot be
// submitted. Each photo carries where it was taken (GPS at the moment of capture) and, once uploaded,
// a server timestamp in public.photo_captures, which municipal staff see next to the report.
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import { base64ToBytes } from './base64';
import { MAX_PHOTO_SIDE, PHOTO_QUALITY } from './config';
import { ApiError } from './errors';
import { supabase } from './supabase';

export interface PhotoCapture {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  /** device clock at the moment of capture (the server stamps its own time on upload) */
  capturedAt: string;
}

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
  capture: PhotoCapture;
}

/** GPS at the moment of capture; never blocks the photo for more than a few seconds. */
async function captureLocation(): Promise<Pick<PhotoCapture, 'latitude' | 'longitude' | 'accuracy'>> {
  const none = { latitude: null, longitude: null, accuracy: null };
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return none;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      timeout,
    ]);
    const fix = position ?? (await Location.getLastKnownPositionAsync({ maxAge: 60_000 }));
    if (!fix) return none;
    return { latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy: fix.coords.accuracy ?? null };
  } catch {
    return none;
  }
}

/** Opens the camera (never the gallery). Returns null if the user cancels. */
export async function pickPhoto(): Promise<PickedPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new ApiError('camera_denied');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.9,
    allowsEditing: false,
    cameraType: ImagePicker.CameraType.back,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const capturedAt = new Date().toISOString();
  const where = await captureLocation();
  return { uri: asset.uri, width: asset.width, height: asset.height, capture: { ...where, capturedAt } };
}

/**
 * Shrinks the photo to a sensible size, converts it to JPEG and uploads it into the
 * signed-in user's own folder, then records the capture metadata (GPS + server time).
 * Returns the storage path to hand to the server function.
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

  // Capture metadata; the database adds its own timestamp. A failure here must not lose the report.
  const { error: metaError } = await supabase.rpc('record_photo_capture', {
    p_bucket: bucket,
    p_path: path,
    p_latitude: photo.capture.latitude,
    p_longitude: photo.capture.longitude,
    p_accuracy_m: photo.capture.accuracy,
    p_device_captured_at: photo.capture.capturedAt,
  });
  if (metaError) console.warn('photo capture metadata not saved', metaError.message);
  return path;
}

export interface CaptureInfo {
  bucket: string;
  path: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  device_captured_at: string | null;
  server_recorded_at: string;
}

/** Capture metadata for photos (visible to the uploader and municipal staff). */
export async function fetchCaptures(paths: string[]): Promise<Record<string, CaptureInfo>> {
  const wanted = paths.filter(Boolean);
  if (wanted.length === 0) return {};
  const { data, error } = await supabase
    .from('photo_captures')
    .select('bucket, path, latitude, longitude, accuracy_m, device_captured_at, server_recorded_at')
    .in('path', wanted);
  if (error) return {};
  const out: Record<string, CaptureInfo> = {};
  for (const row of (data ?? []) as CaptureInfo[]) out[row.path] = row;
  return out;
}
