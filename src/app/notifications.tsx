import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDateTime, type StringKey, useI18n } from '@/i18n';
import { fetchNotifications, markNotificationsRead } from '@/lib/api';
import type { AppNotification } from '@/lib/types';
import { useAuth } from '@/providers/auth';
import { Button, EmptyView, LoadingView } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

export default function NotificationsScreen() {
  const { t, language } = useI18n();
  const { userId } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchNotifications());
    } catch {
      // keep the list
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (userId) void load();
    }, [userId, load]),
  );

  if (!userId) return <EmptyView icon="notifications-outline" text={t('err.notAuthenticated')} />;
  if (loading) return <LoadingView label={t('common.loading')} />;

  const text = (n: AppNotification): string => {
    const code = typeof n.data?.code === 'string' ? n.data.code : '';
    if (n.type === 'report_status') {
      const status = typeof n.data?.muni_status === 'string' ? t(`muni.${n.data.muni_status}` as StringKey) : '';
      return t('notif.report_status', { c: code, s: status });
    }
    const str = (k: string) => (typeof n.data?.[k] === 'string' || typeof n.data?.[k] === 'number' ? String(n.data[k]) : '');
    if (n.type === 'mystery_drop') return t('notif.mystery_drop', { l: str('label'), t: str('title') });
    if (n.type === 'points_adjusted') {
      const delta = Number(n.data?.delta ?? 0);
      return t('notif.points_adjusted', { d: `${delta > 0 ? '+' : ''}${delta}`, r: str('reason') });
    }
    const key = `notif.${n.type}` as StringKey;
    const value = t(key, { c: code });
    return value === key ? t('notif.generic') : value;
  };

  const unread = items.some((n) => !n.read_at);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.primary}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }>
      {unread ? (
        <Button
          label={t('notif.markRead')}
          icon="checkmark-done"
          variant="ghost"
          onPress={() => void markNotificationsRead().then(load).catch(() => {})}
        />
      ) : null}
      {items.length === 0 ? <EmptyView icon="notifications-off-outline" text={t('notif.empty')} /> : null}
      {items.map((n) => (
        <Pressable
          key={n.id}
          accessibilityRole="button"
          disabled={!n.report_id}
          onPress={() => n.report_id && router.push({ pathname: '/report/[id]', params: { id: n.report_id } })}
          style={({ pressed }) => [styles.item, !n.read_at && styles.unread, pressed && styles.pressed]}>
          <Ionicons name={n.read_at ? 'notifications-outline' : 'notifications'} size={20} color={colors.primaryDark} />
          <View style={styles.body}>
            <Text style={styles.title}>{text(n)}</Text>
            <Text style={styles.muted}>{formatDateTime(n.created_at, language)}</Text>
          </View>
          {n.report_id ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 56,
  },
  unread: { borderColor: colors.primary },
  pressed: { opacity: 0.8 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: font.body, color: colors.text, fontWeight: '600' },
  muted: { fontSize: font.small, color: colors.textMuted },
});
