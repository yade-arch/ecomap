// Eko-Ulaşım municipal bike rides: start / finish / cancel through the database, and a GPS
// distance tracker while a ride is active. The server recomputes time from its own clock and
// cuts impossible distances (max speed), so the phone cannot inflate the reward.
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { distanceMeters, getCurrentCoords } from '@/lib/geo';
import { supabase } from '@/lib/supabase';

export interface BikeRide {
  id: string;
  bike_code: string;
  status: 'active' | 'completed' | 'cancelled';
  started_at: string;
  ended_at: string | null;
  distance_m: number | null;
  duration_s: number | null;
  points_awarded: number;
}

export interface RideResult {
  status: 'completed' | 'too_short';
  duration_s: number;
  distance_m?: number;
  points: number;
  points_before_cap?: number;
  daily_cap?: number;
  points_today?: number;
  co2_saved_g?: number;
}

const COLUMNS = 'id, bike_code, status, started_at, ended_at, distance_m, duration_s, points_awarded';
const distKey = (rideId: string) => `eco.ride.${rideId}`;

function readDist(rideId: string): number {
  try {
    return Number(localStorage.getItem(distKey(rideId)) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeDist(rideId: string, m: number) {
  try {
    localStorage.setItem(distKey(rideId), String(Math.round(m)));
  } catch {
    // not critical
  }
}

export function useBikeRides(userId: string | null) {
  const [active, setActive] = useState<BikeRide | null>(null);
  const [recent, setRecent] = useState<BikeRide[]>([]);
  const [distance, setDistance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef<{ latitude: number; longitude: number } | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error: e } = await supabase
      .from('bike_rides')
      .select(COLUMNS)
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(8);
    if (e) return setError(e.message);
    const rows = (data ?? []) as BikeRide[];
    const open = rows.find((r) => r.status === 'active') ?? null;
    setActive(open);
    setRecent(rows.filter((r) => r.status !== 'active'));
    if (open) setDistance(readDist(open.id));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    supabase
      .from('bike_rides')
      .select(COLUMNS)
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(8)
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) return setError(e.message);
        const rows = (data ?? []) as BikeRide[];
        const open = rows.find((r) => r.status === 'active') ?? null;
        setActive(open);
        setRecent(rows.filter((r) => r.status !== 'active'));
        if (open) setDistance(readDist(open.id));
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  // GPS distance while a ride is active (fixes worse than 50 m are ignored).
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void Location.getForegroundPermissionsAsync().then(async (p) => {
      if (!p.granted || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: 5000 },
        (pos) => {
          if ((pos.coords.accuracy ?? 999) > 50) return;
          const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          if (last.current) {
            const step = distanceMeters(last.current, here);
            if (step < 500) {
              setDistance((d) => {
                const next = d + step;
                writeDist(active.id, next);
                return next;
              });
            }
          }
          last.current = here;
        },
      );
    });
    return () => {
      cancelled = true;
      sub?.remove();
      last.current = null;
    };
  }, [active]);

  const start = async (bikeCode: string) => {
    setBusy(true);
    setError(null);
    const at = await getCurrentCoords();
    const { error: e } = await supabase.rpc('start_bike_ride', {
      p_bike_code: bikeCode,
      p_latitude: at?.latitude ?? null,
      p_longitude: at?.longitude ?? null,
    });
    setBusy(false);
    if (e) return setError(e.message);
    setDistance(0);
    await load();
  };

  const finish = async (): Promise<RideResult | null> => {
    if (!active) return null;
    setBusy(true);
    setError(null);
    const at = await getCurrentCoords();
    const { data, error: e } = await supabase.rpc('finish_bike_ride', {
      p_ride_id: active.id,
      p_latitude: at?.latitude ?? null,
      p_longitude: at?.longitude ?? null,
      p_distance_m: Math.round(distance),
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return null;
    }
    writeDist(active.id, 0);
    await load();
    return data as RideResult;
  };

  const cancel = async () => {
    if (!active) return;
    await supabase.rpc('cancel_bike_ride', { p_ride_id: active.id });
    await load();
  };

  return { active, recent, distance, error, busy, start, finish, cancel, reload: load };
}
