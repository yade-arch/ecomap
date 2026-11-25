import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MysteryDropAlerts } from '@/earthcare/drop-alerts';
import { EcPointsRoot } from '@/earthcare/points-context';
import { WalkTracker } from '@/earthcare/walk';
import { I18nProvider, useI18n } from '@/i18n';
import { isConfigured } from '@/lib/config';
import { AuthProvider, useAuth } from '@/providers/auth';
import { EmptyView } from '@/ui/components';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Navigation() {
  const { t } = useI18n();
  const { ready } = useAuth();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!isConfigured) return <EmptyView icon="cloud-offline-outline" text={t('err.notConfigured')} />;
  if (!ready) return null;

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primaryDark,
        headerTitleStyle: { color: colors.text },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="explore" options={{ headerShown: false }} />
      <Stack.Screen name="report/new" options={{ title: t('new.title'), presentation: 'modal' }} />
      <Stack.Screen name="report/[id]" options={{ title: t('detail.title') }} />
      <Stack.Screen name="auth/sign-in" options={{ title: t('common.signIn'), presentation: 'modal' }} />
      <Stack.Screen name="auth/sign-up" options={{ title: t('common.signUp'), presentation: 'modal' }} />
      <Stack.Screen name="moderation" options={{ title: t('mod.title') }} />
      <Stack.Screen name="municipality" options={{ title: t('panel.title') }} />
      <Stack.Screen name="notifications" options={{ title: t('notif.title') }} />
      <Stack.Screen name="points/[userId]" options={{ title: t('panel.sectionPoints') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <EcPointsRoot>
            <StatusBar style="dark" />
            <MysteryDropAlerts />
            <WalkTracker />
            <Navigation />
          </EcPointsRoot>
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
