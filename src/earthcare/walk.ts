// Eko-Ulaşım walking tracker: one small store for the whole app.
//  * iOS: today's total comes from the phone's motion history (Pedometer.getStepCountAsync since midnight).
//  * Android: Expo's pedometer cannot read history, so steps are counted while the app is open and
//    saved per day on the device.
// The step count is sent to the server (sync_walk_steps), which decides the EcoPuan and the daily cap.
import { Pedometer } from 'expo-sensors';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth';

export interface WalkServerState {
  steps: number;
  distance_m: number;
  points_today: number;
  points_added: number;
  daily_cap: number;
  steps_per_reward: number;
  points_per_reward: number;
  next_reward_steps: number | null;
  co2_saved_g: number;
}

export type WalkPermission = 'checking' | 'unavailable' | 'undetermined' | 'denied' | 'granted';

interface WalkState {
  permission: WalkPermission;
  steps: number;
  server: WalkServerState | null;
  syncing: boolean;
  error: string | null;
}

let state: WalkState = {
  permission: Platform.OS === 'web' ? 'unavailable' : 'checking',
  steps: 0,
  server: null,
  syncing: false,
  error: null,
};
const listeners = new Set<() => void>();
function set(patch: Partial<WalkState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const todayKey = () => {
  const d = new Date();
  return `eco.steps.${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
function readStored(): number {
  try {
    return Number(localStorage.getItem(todayKey()) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeStored(n: number) {
  try {
    localStorage.setItem(todayKey(), String(n));
  } catch {
    // storage unavailable: the count simply restarts next launch
  }
}

let subscription: { remove: () => void } | null = null;
let lastSynced = -1;

async function readTodayIos(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const result = await Pedometer.getStepCountAsync(start, new Date());
  return result.steps;
}

async function startCounting() {
  if (subscription) return;
  if (Platform.OS === 'ios') {
    try {
      set({ steps: await readTodayIos() });
    } catch {
      // keep the last value
    }
    // Live updates: re-read the total, which already contains the new steps.
    subscription = Pedometer.watchStepCount(() => {
      void readTodayIos().then((steps) => set({ steps })).catch(() => {});
    });
  } else {
    let base = readStored();
    let day = todayKey();
    set({ steps: base });
    subscription = Pedometer.watchStepCount((result) => {
      if (todayKey() !== day) {
        // New day: start again from zero.
        day = todayKey();
        base = -result.steps;
      }
      const steps = Math.max(0, base + result.steps);
      writeStored(steps);
      set({ steps });
    });
  }
}

/** Checks availability and permission without prompting; starts counting if already allowed. */
export async function initWalk() {
  if (Platform.OS === 'web') return set({ permission: 'unavailable' });
  try {
    if (!(await Pedometer.isAvailableAsync())) return set({ permission: 'unavailable' });
    const p = await Pedometer.getPermissionsAsync();
    const permission: WalkPermission = p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
    set({ permission });
    if (p.granted) await startCounting();
  } catch {
    set({ permission: 'unavailable' });
  }
}

/** One-tap permission from the info card. */
export async function requestWalkPermission() {
  try {
    const p = await Pedometer.requestPermissionsAsync();
    set({ permission: p.granted ? 'granted' : 'denied' });
    if (p.granted) {
      await startCounting();
      await syncWalk(true);
    }
  } catch {
    set({ permission: 'unavailable' });
  }
}

/** Sends today's steps; the server returns points, cap and progress. */
export async function syncWalk(force = false) {
  if (state.syncing || (!force && state.steps === lastSynced)) return;
  set({ syncing: true });
  const { data, error } = await supabase.rpc('sync_walk_steps', { p_steps: state.steps });
  if (error) {
    set({ syncing: false, error: error.message });
    return;
  }
  lastSynced = state.steps;
  set({ syncing: false, error: null, server: data as WalkServerState });
}

export function stopWalk() {
  subscription?.remove();
  subscription = null;
}

export function useWalk(): WalkState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Mounted once in the root layout: counts steps while the app is open and syncs every minute. */
export function WalkTracker() {
  const { userId } = useAuth();
  useEffect(() => {
    if (!userId) return;
    void initWalk().then(() => syncWalk(true));
    const id = setInterval(() => void syncWalk(), 60_000);
    return () => {
      clearInterval(id);
      stopWalk();
    };
  }, [userId]);
  return null;
}
