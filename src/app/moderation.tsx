import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDateTime, useI18n } from '@/i18n';
import { fetchCleanupQueue, fetchReportQueue, moderateCleanup, moderateReport, reanalyzePending } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { formatDistance } from '@/lib/geo';
import { publicPhotoUrl } from '@/lib/supabase';
import type { CleanupSubmission, Report } from '@/lib/types';
import { useAuth } from '@/providers/auth';
import { Button, EmptyView, LoadingView, Notice, SectionTitle, SeverityBadge, StatusBadge } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

export default function ModerationScreen() {
  const { t, language } = useI18n();
  const { access } = useAuth();
  const router = useRouter();

  const [cleanups, setCleanups] = useState<CleanupSubmission[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!access.is_staff) {
      setLoading(false);
      return;
    }
    try {
      const [c, r] = await Promise.all([fetchCleanupQueue(), fetchReportQueue()]);
      setCleanups(c);
      setReports(r);
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [access.is_staff, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = async (id: string, work: () => Promise<unknown>) => {
    setBusyId(id);
    setNotice(null);
    try {
      await work();
      await load();
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    } finally {
      setBusyId(null);
    }
  };

  const recheck = () =>
    act('recheck', async () => {
      const result = await reanalyzePending();
      setNotice({
        tone: 'info',
        text: result.status === 'done' ? t('mod.recheckDone', { n: result.checked ?? 0 }) : t('mod.aiNone'),
      });
    });

  if (!access.is_staff) return <EmptyView icon="lock-closed-outline" text={t('mod.notStaff')} />;
  if (loading) return <LoadingView label={t('common.loading')} />;

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
      {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}

      <SectionTitle>{`${t('mod.cleanups')} (${cleanups.length})`}</SectionTitle>
      {cleanups.length === 0 ? <Text style={styles.muted}>{t('mod.empty')}</Text> : null}
      {cleanups.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.photos}>
            <View style={styles.photoBox}>
              <Text style={styles.photoLabel}>{t('detail.before')}</Text>
              {item.report ? (
                <Image source={{ uri: publicPhotoUrl('report-photos', item.report.photo_path) }} style={styles.photo} contentFit="cover" />
              ) : null}
            </View>
            <View style={styles.photoBox}>
              <Text style={styles.photoLabel}>{t('detail.after')}</Text>
              {item.after_photo ? (
                <Image source={{ uri: publicPhotoUrl('cleanup-photos', item.after_photo.path) }} style={styles.photo} contentFit="cover" />
              ) : null}
            </View>
          </View>
          <View style={styles.badges}>
            {item.report ? <SeverityBadge severity={item.report.severity} t={t} /> : null}
            <Text style={styles.muted}>{formatDateTime(item.submitted_at, language)}</Text>
          </View>
          <Text style={styles.body}>
            {[item.activist?.display_name ?? t('common.deletedUser'), item.report?.address ?? item.report?.city].filter(Boolean).join(' · ')}
          </Text>
          {item.distance_m != null ? <Text style={styles.muted}>{t('mod.distance', { d: formatDistance(item.distance_m) })}</Text> : null}
          <Text style={styles.muted}>
            {item.ai_verification_result?.summary
              ? `${t('detail.aiNote')}: ${item.ai_verification_result.summary}` +
                (item.ai_confidence != null ? ` (${Math.round(item.ai_confidence * 100)}%)` : '')
              : t('mod.aiNone')}
          </Text>
          <View style={styles.actions}>
            <Button
              label={t('mod.approve')}
              icon="checkmark"
              style={styles.action}
              loading={busyId === item.id}
              disabled={busyId !== null}
              onPress={() => void act(item.id, () => moderateCleanup(item.id, true))}
            />
            <Button
              label={t('mod.reject')}
              icon="close"
              variant="danger"
              style={styles.action}
              disabled={busyId !== null}
              onPress={() => void act(item.id, () => moderateCleanup(item.id, false))}
            />
          </View>
        </View>
      ))}

      <SectionTitle>{`${t('mod.reports')} (${reports.length})`}</SectionTitle>
      {reports.length === 0 ? <Text style={styles.muted}>{t('mod.empty')}</Text> : null}
      {reports.map((item) => (
        <View key={item.id} style={styles.card}>
          <Image source={{ uri: publicPhotoUrl('report-photos', item.photo_path) }} style={styles.photoWide} contentFit="cover" />
          <View style={styles.badges}>
            <SeverityBadge severity={item.severity} t={t} />
            <StatusBadge status={item.report_status} t={t} />
          </View>
          <Text style={styles.body}>
            {[t(`category.${item.ai_category ?? 'unknown'}`), item.reporter?.display_name, item.address ?? item.city]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {item.ai_summary ? <Text style={styles.muted}>{`${t('detail.aiNote')}: ${item.ai_summary}`}</Text> : null}
          {item.description ? <Text style={styles.muted}>{item.description}</Text> : null}
          <Text style={styles.muted}>{formatDateTime(item.created_at, language)}</Text>
          <View style={styles.actions}>
            <Button
              label={t('mod.approve')}
              icon="checkmark"
              style={styles.action}
              loading={busyId === item.id}
              disabled={busyId !== null}
              onPress={() => void act(item.id, () => moderateReport(item.id, 'approve'))}
            />
            <Button
              label={t('mod.reject')}
              icon="close"
              variant="danger"
              style={styles.action}
              disabled={busyId !== null}
              onPress={() => void act(item.id, () => moderateReport(item.id, 'reject'))}
            />
          </View>
          <Button
            label={t('map.details')}
            variant="ghost"
            onPress={() => router.push({ pathname: '/report/[id]', params: { id: item.id } })}
          />
        </View>
      ))}

      <Button
        label={t('mod.recheck')}
        icon="refresh"
        variant="secondary"
        loading={busyId === 'recheck'}
        disabled={busyId !== null}
        onPress={() => void recheck()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: spacing.md },
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photos: { flexDirection: 'row', gap: spacing.sm },
  photoBox: { flex: 1, gap: spacing.xs },
  photoLabel: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface },
  photoWide: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.surface },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  body: { fontSize: font.body, color: colors.text, fontWeight: '600' },
  muted: { fontSize: font.small, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
