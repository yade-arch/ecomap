// EcoPuan tab = its own stack (home -> Katkı Sağla / Ödüller / Puan Geçmişi / QR kod),
// so the main bottom bar (Harita · Sıralama · EcoPuan · Profil) stays visible on every EARTHCARE screen.
import { Stack } from 'expo-router';

import { colors } from '@/ui/theme';

export default function EcoPuanStack() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />;
}
