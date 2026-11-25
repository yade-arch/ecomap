import * as Location from 'expo-location';

export interface Coords {
  latitude: number;
  longitude: number;
}

export interface Place {
  address: string | null;
  city: string | null;
  country: string | null;
}

/** Great-circle distance in metres. */
export function distanceMeters(a: Coords, b: Coords): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Asks for location permission only when a feature needs it, then reads the position.
 * Returns null when the user says no or the position cannot be read.
 */
export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      const last = await Location.getLastKnownPositionAsync();
      return last ? { latitude: last.coords.latitude, longitude: last.coords.longitude } : null;
    }
  } catch {
    return null;
  }
}

/** Best-effort address lookup done by the phone itself. Never blocks a report if it fails. */
export async function describePlace(coords: Coords): Promise<Place> {
  try {
    const results = await Location.reverseGeocodeAsync(coords);
    const r = results[0];
    if (!r) return { address: null, city: null, country: null };
    // In Türkiye the province ("il") is what people call the city, and it is what municipalities map to.
    const city =
      r.isoCountryCode === 'TR'
        ? (r.region ?? r.city ?? r.subregion)
        : (r.city ?? r.subregion ?? r.region);
    const address = [r.street ?? r.name, r.district, r.subregion]
      .filter((part, index, all) => !!part && all.indexOf(part) === index)
      .join(', ');
    return { address: address || null, city: city ?? null, country: r.isoCountryCode ?? null };
  } catch {
    return { address: null, city: null, country: null };
  }
}
