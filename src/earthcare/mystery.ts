// Gizli Hazine (mystery drop) zones: data access, live list and countdown helpers.
import { useEffect, useMemo, useState } from 'react';

import { supabase } from '@/lib/supabase';

export interface MysteryDrop {
  id: string;
  municipality_id: string | null;
  title: string;
  description: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
  reward_mode: 'multiplier' | 'bonus';
  multiplier: number | null;
  bonus_points: number | null;
  starts_at: string;
  ends_at: string;
  ended_early_at: string | null;
  created_at: string;
}

const COLUMNS =
  'id, municipality_id, title, description, latitude, longitude, radius_m, reward_mode, multiplier, bonus_points, starts_at, ends_at, ended_early_at, created_at';

export function dropEnd(d: MysteryDrop): number {
  return new Date(d.ended_early_at ?? d.ends_at).getTime();
}

export function isDropActive(d: MysteryDrop, now = Date.now()): boolean {
  return new Date(d.starts_at).getTime() <= now && dropEnd(d) > now;
}

/** "2x" / "1,5x" / "+50 EC" */
export function dropLabel(d: Pick<MysteryDrop, 'reward_mode' | 'multiplier' | 'bonus_points'>): string {
  if (d.reward_mode === 'multiplier') {
    const m = Number(d.multiplier ?? 1);
    return `${Number.isInteger(m) ? m : m.toString().replace('.', ',')}x`;
  }
  return `+${d.bonus_points ?? 0} EC`;
}

/** "23s 45d" (saat/dakika), "12d" or "Süresi doldu" */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Süresi doldu';
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}s ${m}d` : `${m}d`;
}

export async function fetchDrops(includeEnded = false): Promise<MysteryDrop[]> {
  let query = supabase.from('mystery_drops').select(COLUMNS).order('created_at', { ascending: false }).limit(100);
  if (!includeEnded) query = query.gt('ends_at', new Date().toISOString()).is('ended_early_at', null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as MysteryDrop[];
}

/** A clock that ticks every `ms` (for countdowns). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Live list of drops (Supabase Realtime). `includeEnded` is for the admin list. */
export function useDrops(includeEnded = false) {
  const [drops, setDrops] = useState<MysteryDrop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    let active = true;
    const load = () =>
      fetchDrops(includeEnded)
        .then((rows) => {
          if (!active) return;
          setDrops(rows);
          setError(null);
        })
        .catch((e: Error) => active && setError(e.message));
    void load();
    const channel = supabase
      .channel(`mystery-drops-${includeEnded ? 'all' : 'active'}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mystery_drops' }, () => void load())
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [includeEnded]);

  const active = useMemo(() => drops.filter((d) => isDropActive(d, now)), [drops, now]);
  return { drops, active, now, error };
}
