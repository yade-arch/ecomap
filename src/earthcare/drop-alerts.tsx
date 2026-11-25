// Local push for new Gizli Hazine zones near the user.
// The database already adds an in-app notification for everyone in the drop's city; this watcher
// additionally rings the phone (expo-notifications, local) when the device's last known position is
// close to a newly opened zone. Location is read only if permission was already given — it never
// prompts for location by itself.
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { distanceMeters, formatDistance } from '@/lib/geo';
import { supabase } from '@/lib/supabase';

import { dropEnd, dropLabel, formatRemaining, type MysteryDrop } from './mystery';

/** Alert people within the zone radius plus this many metres. */
const NEARBY_EXTRA_M = 3000;
const CHANNEL = 'mystery-drops';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function canNotify(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function alertIfNearby(drop: MysteryDrop) {
  if (dropEnd(drop) <= Date.now()) return;
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return;
  const position = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 });
  if (!position) return;
  const away = distanceMeters(
    { latitude: position.coords.latitude, longitude: position.coords.longitude },
    { latitude: drop.latitude, longitude: drop.longitude },
  );
  if (away > drop.radius_m + NEARBY_EXTRA_M) return;
  if (!(await canNotify())) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Gizli Hazine',
      importance: AndroidImportance.HIGH,
    });
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Gizli Hazine açıldı: ${dropLabel(drop)} EcoPuan!`,
      body: `${drop.title} • ${away <= drop.radius_m ? 'Bölgenin içindesiniz' : `${formatDistance(away)} uzakta`} • Kalan süre: ${formatRemaining(dropEnd(drop) - Date.now())}`,
      data: { dropId: drop.id, url: '/map' },
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
}

/** Mounted once in the root layout. Renders nothing. */
export function MysteryDropAlerts() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const channel = supabase
      .channel('mystery-drop-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mystery_drops' }, (payload) => {
        void alertIfNearby(payload.new as MysteryDrop).catch(() => {});
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
  return null;
}
