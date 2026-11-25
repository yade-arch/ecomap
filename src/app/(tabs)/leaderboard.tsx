import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useI18n } from '@/i18n';
import { fetchLeaderboard, fetchMyRank } from '@/lib/api';
import { TR_CITIES } from '@/lib/config';
import type { LeaderboardEntry } from '@/lib/types';
import { useAuth } from '@/providers/auth';
import { Button, Chip, EmptyView, LoadingView, Notice } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

const MEDALS = ['#F59E0B', '#9CA3AF', '#B45309'];

type ScopeMode = 'all' | 'country' | 'city';

export default function LeaderboardScreen() {
  const { t } = useI18n();
  const { userId, profile } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [rank, setRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
  const [selectedCity, setSelectedCity] = useState<string | null>(profile?.city ?? null);
  const [showCityPicker, setShowCityPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      const city = scopeMode === 'city' ? selectedCity : null;
      const country = scopeMode === 'country' ? (profile?.country ?? 'TR') : null;
      const [list, mine] = await Promise.all([
        fetchLeaderboard(city, country),
        userId ? fetchMyRank().catch(() => null) : null,
      ]);
      setEntries(list);
      setRank(mine);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, profile, scopeMode, selectedCity]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const roleLabel = (entry: LeaderboardEntry) => {
    const roles = (entry.user_roles ?? []).map((r) => r.role);
    if (roles.includes('observer') && roles.includes('activist')) return t('board.roleBoth');
    if (roles.includes('activist')) return t('board.roleActivist');
    if (roles.includes('observer')) return t('board.roleObserver');
    return '';
  };

  if (loading) return <LoadingView label={t('common.loading')} />;
  if (failed) {
    return (
      <EmptyView
        icon="cloud-offline-outline"
        text={t('err.network')}
        action={<Button label={t('common.retry')} variant="secondary" onPress={() => void load()} />}
      />
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={entries}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.primary}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {rank ? <Notice tone="success" icon="trophy" text={t('board.myRank', { n: rank })} /> : null}

          {/* Scope tabs */}
          <View style={styles.scopeRow}>
            {(['all', 'country', 'city'] as ScopeMode[]).map((s) => (
              <Chip
                key={s}
                label={t(`board.scope_${s}` as any)}
                selected={scopeMode === s}
                onPress={() => {
                  setScopeMode(s);
                  if (s === 'city' && !selectedCity) setShowCityPicker(true);
                }}
              />
            ))}
          </View>

          {/* City picker row */}
          {scopeMode === 'city' ? (
            <TouchableOpacity style={styles.cityBtn} onPress={() => setShowCityPicker((v) => !v)} activeOpacity={0.7}>
              <Ionicons name="location-outline" size={16} color={colors.primary} />
              <Text style={styles.cityBtnText}>{selectedCity ?? t('board.chooseCity')}</Text>
              <Ionicons name={showCityPicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}

          {/* City list */}
          {scopeMode === 'city' && showCityPicker ? (
            <ScrollView style={styles.cityList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              <View style={styles.cityGrid}>
                {TR_CITIES.map((city) => (
                  <Chip
                    key={city}
                    label={city}
                    selected={selectedCity === city}
                    onPress={() => {
                      setSelectedCity(city);
                      setShowCityPicker(false);
                    }}
                  />
                ))}
              </View>
            </ScrollView>
          ) : null}
        </View>
      }
      ListEmptyComponent={<EmptyView icon="trophy-outline" text={t('board.empty')} />}
      renderItem={({ item, index }) => {
        const mine = item.id === userId;
        const details = [
          roleLabel(item),
          item.city,
          item.country && !item.city ? item.country : null,
          t('board.reports', { n: item.reports_count }),
          t('board.cleans', { n: item.cleans_count }),
        ].filter(Boolean);
        return (
          <View style={[styles.row, mine && styles.rowMine]}>
            <View style={[styles.rank, index < 3 && { backgroundColor: MEDALS[index] }]}>
              <Text style={[styles.rankText, index < 3 && styles.rankTextTop]}>{index + 1}</Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>
                {item.display_name}
              </Text>
              <Text style={styles.meta} numberOfLines={2}>
                {details.join(' · ')}
              </Text>
            </View>
            <View style={styles.points}>
              <Ionicons name="leaf" size={16} color={colors.primary} />
              <Text style={styles.pointsText}>{item.total_points}</Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  scopeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  cityList: { maxHeight: 220, borderRadius: radius.md, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowMine: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  rank: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { fontSize: font.body, fontWeight: '700', color: colors.text },
  rankTextTop: { color: colors.textOnPrimary },
  body: { flex: 1, gap: 2 },
  name: { fontSize: font.large, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
  points: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pointsText: { fontSize: font.large, fontWeight: '700', color: colors.text },
});
