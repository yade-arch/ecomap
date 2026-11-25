import type { Coords } from '@/lib/geo';

export type MarkerKind = 'low' | 'medium' | 'high' | 'cleaned' | 'pending';

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  kind: MarkerKind;
}

/** Changing `key` tells the map to move, even when the coordinates are the same as last time. */
export interface MapFocus extends Coords {
  key: number;
  zoomedIn?: boolean;
}

export interface PollutionMapProps {
  markers: MapMarker[];
  focus: MapFocus | null;
  showsUserLocation: boolean;
  userLocation: Coords | null;
  onMarkerPress: (id: string) => void;
  onMapPress?: () => void;
}

/** Türkiye as the starting view until the user's own position is known. */
export const INITIAL_REGION = { latitude: 39.0, longitude: 35.2, latitudeDelta: 13, longitudeDelta: 17 };
