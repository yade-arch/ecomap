import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEcPoints } from '@/earthcare/points-context';
import { useI18n } from '@/i18n';
import { fetchReports } from '@/lib/api';
import { type Coords, distanceMeters, formatDistance, getCurrentCoords } from '@/lib/geo';
import { publicPhotoUrl, supabase } from '@/lib/supabase';
import type { Report } from '@/lib/types';
import PollutionMap from '@/map/PollutionMap';
import type { MapFocus, MapMarker, MarkerKind } from '@/map/types';
import { useAuth } from '@/providers/auth';
import { Button, Chip, Notice, SeverityBadge, StatusBadge } from '@/ui/components';
import { colors, font, radius, shadow, spacing } from '@/ui/theme';

type Filter = 'all' | 'active' | 'cleaned';

function markerKind(report: Report): MarkerKind {
  if (report.report_status === 'cleaned') return 'cleaned';
  if (report.report_status === 'pending_review') return 'pending';
  return report.severity;
}

export default function MapScreen() {
  const { t } = useI18n();
  const { userId, profile } = useAuth();
  const { balance: liveBalance } = useEcPoints();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [me, setMe] = useState<Coords | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const focusKey = useRef(0);
  const centredOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      setReports(await fetchReports());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the screen comes back into view (e.g. after creating a report).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Live updates: any change to a report refreshes the list (debounced).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel('map-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pollution_reports' }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void load(), 600);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [load, userId]);

  const moveTo = useCallback((coords: Coords, zoomedIn: boolean) => {
    focusKey.current += 1;
    setFocus({ ...coords, zoomedIn, key: focusKey.current });
  }, []);

  const locate = useCallback(async (): Promise<Coords | null> => {
    setLocating(true);
    const coords = await getCurrentCoords();
    setLocating(false);
    if (!coords) {
      setMessage(t('map.locationDenied'));
      return null;
    }
    setMessage(null);
    setMe(coords);
    return coords;
  }, [t]);

  const visible = useMemo(
    () =>
      reports.filter((r) =>
        filter === 'all' ? true : filter === 'cleaned' ? r.report_status === 'cleaned' : r.report_status !== 'cleaned',
      ),
    [reports, filter],
  );

  const markers = useMemo<MapMarker[]>(
    () => visible.map((r) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude, kind: markerKind(r) })),
    [visible],
  );

  const selected = useMemo(() => reports.find((r) => r.id === selectedId) ?? null, [reports, selectedId]);

  const centreOnMe = async () => {
    const coords = await locate();
    if (coords) moveTo(coords, false);
  };

  const findNearest = async () => {
    const coords = me ?? (await locate());
    if (!coords) return;
    const open = reports.filter((r) => ['active', 'cleanup_in_progress'].includes(r.report_status));
    if (open.length === 0) {
      setMessage(t('map.noActive'));
      return;
    }
    let nearest = open[0];
    let best = distanceMeters(coords, nearest);
    for (const r of open) {
      const d = distanceMeters(coords, r);
      if (d < best) {
        best = d;
        nearest = r;
      }
    }
    setFilter((f) => (f === 'cleaned' ? 'all' : f));
    setSelectedId(nearest.id);
    moveTo(nearest, true);
  };

  // First time the map opens: if location is already allowed, centre on the user once.
  useEffect(() => {
    if (centredOnce.current) return;
    centredOnce.current = true;
    void (async () => {
      const coords = await getCurrentCoords();
      if (coords) {
        setMe(coords);
        moveTo(coords, false);
      }
    })();
  }, [moveTo]);

  const openNew = () => {
    if (!userId) router.push('/auth/sign-in');
    else router.push('/report/new');
  };

  return (
    <View style={styles.screen}>
      <PollutionMap
        markers={markers}
        focus={focus}
        showsUserLocation={!!me}
        userLocation={me}
        onMarkerPress={setSelectedId}
        onMapPress={() => setSelectedId(null)}
      />

      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            onPress={findNearest}
            style={({ pressed }) => [styles.nearest, pressed && styles.pressed]}>
            {locating ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Ionicons name="navigate" size={18} color={colors.textOnPrimary} />
            )}
            <Text style={styles.nearestLabel} numberOfLines={1}>
              {t('map.findNearest')}
            </Text>
          </Pressable>
          {profile ? (
            // Live EcoPuan balance; opens the EARTHCARE points & rewards module.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.points', { n: liveBalance ?? profile.total_points })}
              accessibilityHint="EcoPuan ve ödüller"
              onPress={() => router.navigate('/ecopuan')}
              style={({ pressed }) => [styles.points, pressed && styles.pressed]}>
              <Ionicons name="leaf" size={16} color={colors.primary} />
              <Text style={styles.pointsLabel}>{liveBalance ?? profile.total_points}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filters} pointerEvents="box-none">
          <Chip label={t('map.filterAll')} selected={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label={t('map.filterActive')} selected={filter === 'active'} onPress={() => setFilter('active')} />
          <Chip label={t('map.filterCleaned')} selected={filter === 'cleaned'} onPress={() => setFilter('cleaned')} />
          {loading ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
        {failed ? (
          <View style={styles.banner}>
            <Notice tone="danger" text={t('map.loadError')} />
            <Button label={t('common.retry')} variant="secondary" onPress={() => void load()} />
          </View>
        ) : null}
        {message ? (
          <Pressable onPress={() => setMessage(null)} style={styles.banner}>
            <Notice tone="warning" text={message} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.fabs} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="My location"
            onPress={centreOnMe}
            style={({ pressed }) => [styles.fabSmall, pressed && styles.pressed]}>
            <Ionicons name="locate" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('map.newReport')}
            onPress={openNew}
            style={({ pressed }) => [styles.fab, pressed && styles.pressed]}>
            <Ionicons name="camera" size={26} color={colors.textOnPrimary} />
          </Pressable>
        </View>

        {selected ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/report/[id]', params: { id: selected.id } })}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <Image
              source={{ uri: publicPhotoUrl('report-photos', selected.photo_path) }}
              style={styles.cardPhoto}
              contentFit="cover"
              transition={150}
            />
            <View style={styles.cardBody}>
              <View style={styles.cardBadges}>
                <SeverityBadge severity={selected.severity} t={t} />
                <StatusBadge status={selected.report_status} t={t} />
              </View>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {t(`category.${selected.ai_category ?? 'unknown'}`)}
              </Text>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {[selected.address ?? selected.city, me ? t('map.away', { d: formatDistance(distanceMeters(me, selected)) }) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md, gap: spacing.sm },
  topRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  nearest: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    ...shadow,
  },
  nearestLabel: { color: colors.textOnPrimary, fontSize: font.body, fontWeight: '700', flexShrink: 1 },
  points: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    ...shadow,
  },
  pointsLabel: { fontSize: font.body, fontWeight: '700', color: colors.text },
  filters: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  banner: { gap: spacing.sm },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md, gap: spacing.md },
  fabs: { alignItems: 'flex-end', gap: spacing.md },
  fabSmall: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    ...shadow,
  },
  cardPhoto: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surface },
  cardBody: { flex: 1, gap: 4 },
  cardBadges: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  cardTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: font.small, color: colors.textMuted },
  pressed: { opacity: 0.8 },
});
