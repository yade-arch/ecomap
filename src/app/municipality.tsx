// Municipality panel: summary numbers, the case queue and a CSV export.
// Municipality admins also get a second tab, "Vatandaş Puan Yönetimi" (live EcoPuan management + audit log).
// Staff open a case to act on it (accept, assign, start, resolve, verify) in the report screen.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MysteryAdminPanel } from '@/earthcare/components/mystery-admin-panel';
import { PointsAdminPanel } from '@/earthcare/components/points-admin-panel';
import { formatDateTime, type StringKey, useI18n } from '@/i18n';
import { fetchMuniReports, fetchMuniStats } from '@/lib/api';
import { TR_CITIES } from '@/lib/config';
import { errorKey } from '@/lib/errors';
import { publicPhotoUrl } from '@/lib/supabase';
import type { MuniStats, Report } from '@/lib/types';
import { MuniBadge } from '@/municipal/MuniSection';
import { useAuth } from '@/providers/auth';
import { Button, Chip, EmptyView, LoadingView, Notice, SeverityBadge } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

type Filter = 'open' | 'mine' | 'closed' | 'all';
type Section = 'reports' | 'points' | 'drops';
const SECTIONS: { key: Section; icon: 'map-outline' | 'people-outline' | 'star-outline'; label: StringKey }[] = [
  { key: 'reports', icon: 'map-outline', label: 'panel.sectionReports' },
  { key: 'points', icon: 'people-outline', label: 'panel.sectionPoints' },
  { key: 'drops', icon: 'star-outline', label: 'panel.sectionDrops' },
];
const FILTERS: { key: Filter; label: StringKey }[] = [
  { key: 'open', label: 'panel.open' },
  { key: 'mine', label: 'panel.mine' },
  { key: 'closed', label: 'panel.closed' },
  { key: 'all', label: 'panel.all' },
];

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function MunicipalityScreen() {
  const { t, language } = useI18n();
  const { userId, profile, access } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>(
    params.section === 'points' || params.section === 'drops' ? params.section : 'reports',
  );
  const [filter, setFilter] = useState<Filter>('open');
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<MuniStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // City filter: default = user's own city; null = all cities
  const [cityFilter, setCityFilter] = useState<string | null>(profile?.city ?? null);
  const [showCityPicker, setShowCityPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([fetchMuniReports(filter, userId, cityFilter), fetchMuniStats()]);
      setReports(r);
      setStats(s);
      setError(null);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, userId, cityFilter, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const showPoints = !!access.is_municipality_admin;
  const segment = showPoints ? (
    <View style={styles.segment} accessibilityRole="tablist">
      {SECTIONS.map(({ key, icon, label }) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityState={{ selected: section === key }}
          onPress={() => setSection(key)}
          style={[styles.segmentBtn, section === key && styles.segmentBtnOn]}>
          <Ionicons
            name={icon}
            size={16}
            color={section === key ? colors.primaryDark : colors.textMuted}
          />
          <Text style={[styles.segmentText, section === key && styles.segmentTextOn]} numberOfLines={1}>
            {t(label)}
          </Text>
        </Pressable>
      ))}
    </View>
  ) : null;

  if (!access.is_staff && !showPoints) return <EmptyView icon="lock-closed-outline" text={t('mod.notStaff')} />;
  if (showPoints && (section !== 'reports' || !access.is_staff)) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
        {access.is_staff ? segment : null}
        {section === 'drops' ? <MysteryAdminPanel /> : <PointsAdminPanel />}
      </ScrollView>
    );
  }
  if (loading) return <LoadingView label={t('common.loading')} />;

  const exportCsv = () => {
    const header = ['code', 'created_at', 'group', 'type', 'severity', 'muni_status', 'address', 'latitude', 'longitude', 'supports', 'due_at'];
    const rows = reports.map((r) =>
      [r.public_code, r.created_at, r.issue_group, r.issue_type ?? r.ai_category, r.severity, r.muni_status, r.address ?? r.city, r.latitude, r.longitude, r.supports_count, r.due_at]
        .map(csvCell)
        .join(','),
    );
    void Share.share({ title: 'EcoMap.csv', message: [header.join(','), ...rows].join('\n') }).catch(() => {});
  };

  const hours = (n: number | null | undefined) => (n == null ? '–' : t('panel.hours', { n }));
  const tiles: { label: string; value: string | number; danger?: boolean }[] = stats
    ? [
        { label: t('panel.total'), value: stats.total },
        { label: t('panel.open'), value: ['submitted', 'accepted', 'assigned', 'in_progress', 'resolved', 'reopened'].reduce((a, k) => a + (stats.by_status[k] ?? 0), 0) },
        { label: t('muni.verified'), value: stats.by_status.verified ?? 0 },
        { label: t('panel.overdue'), value: stats.overdue, danger: stats.overdue > 0 },
        { label: t('panel.firstResponse'), value: hours(stats.median_first_response_h) },
        { label: t('panel.resolution'), value: hours(stats.median_resolution_h) },
      ]
    : [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
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
      {segment}
      <Notice tone="info" text={t('panel.pilotNote')} />
      {error ? <Notice tone="danger" text={error} /> : null}

      <View style={styles.tiles}>
        {tiles.map((tile) => (
          <View key={tile.label} style={styles.tile}>
            <Text style={[styles.tileValue, tile.danger && styles.danger]}>{tile.value}</Text>
            <Text style={styles.muted}>{tile.label}</Text>
          </View>
        ))}
      </View>

      {/* City selector */}
      <TouchableOpacity style={styles.cityBtn} onPress={() => setShowCityPicker((v) => !v)} activeOpacity={0.7}>
        <Ionicons name="location-outline" size={16} color={colors.primary} />
        <Text style={styles.cityBtnText}>{cityFilter ?? t('panel.allCities')}</Text>
        <Ionicons name={showCityPicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {showCityPicker ? (
        <View style={styles.cityGrid}>
          <Chip label={t('panel.allCities')} selected={cityFilter === null} onPress={() => { setCityFilter(null); setShowCityPicker(false); }} />
          {TR_CITIES.map((c) => (
            <Chip key={c} label={c} selected={cityFilter === c} onPress={() => { setCityFilter(c); setShowCityPicker(false); }} />
          ))}
        </View>
      ) : null}

      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={t(f.label)} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>

      {reports.length === 0 ? <Text style={styles.muted}>{t('panel.empty')}</Text> : null}
      {reports.map((r) => {
        const overdue = !!r.due_at && new Date(r.due_at) < new Date() && r.muni_status !== 'verified';
        return (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/report/[id]', params: { id: r.id } })}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <Image source={{ uri: publicPhotoUrl('report-photos', r.photo_path) }} style={styles.thumb} contentFit="cover" />
            <View style={styles.cardBody}>
              <Text style={styles.code}>{r.public_code}</Text>
              <Text style={styles.title} numberOfLines={1}>
                {r.issue_type ? t(`issue.${r.issue_type}` as StringKey) : t(`group.${r.issue_group}`)}
              </Text>
              <View style={styles.badges}>
                <MuniBadge status={r.muni_status} />
                <SeverityBadge severity={r.severity} t={t} />
              </View>
              <Text style={[styles.muted, overdue && styles.danger]} numberOfLines={1}>
                {overdue ? `${t('staff.overdue')} · ` : ''}
                {[r.address ?? r.city, formatDateTime(r.created_at, language)].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {reports.length > 0 ? <Button label={t('panel.export')} icon="share-outline" variant="secondary" onPress={exportCsv} /> : null}
      {access.is_moderator ? (
        <Button label={t('profile.moderation')} icon="shield-checkmark" variant="ghost" onPress={() => router.push('/moderation')} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: spacing.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '31%',
    flexGrow: 1,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  tileValue: { fontSize: font.title, fontWeight: '700', color: colors.primaryDark },
  danger: { color: colors.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  thumb: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.surface },
  cardBody: { flex: 1, gap: 4 },
  code: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  title: { fontSize: font.body, fontWeight: '700', color: colors.text },
  badges: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  muted: { fontSize: font.small, color: colors.textMuted },
  cityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  cityBtnText: { flex: 1, fontSize: font.body, color: colors.text, fontWeight: '600' },
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  segmentBtnOn: { backgroundColor: colors.primarySoft },
  segmentText: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
  segmentTextOn: { color: colors.primaryDark },
});
