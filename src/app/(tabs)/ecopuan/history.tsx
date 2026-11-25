// EARTHCARE · Profil: the citizen's balance, rank, badges and full points history — read-only.
// There is deliberately no control here that could change points; the database refuses it anyway.
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { BalanceCard, Card, EcHeader, EcNotice, EcScroll, LiveBadge, PrimaryButton, SectionHeader } from '@/earthcare/components/ui';
import { useEcPoints } from '@/earthcare/points-context';
import { LEDGER_LABEL, OPERATION_LABEL, dateTime, relativeTime } from '@/earthcare/strings';
import { cardShadow, ec, ecRadius, formatPoints } from '@/earthcare/theme';
import { useAuth } from '@/providers/auth';

const BADGES = [
  { min: 0, name: 'Yeşil Filiz', icon: 'sprout' as const },
  { min: 250, name: 'Doğa Dostu', icon: 'leaf' as const },
  { min: 1000, name: 'Çevre Elçisi', icon: 'earth' as const },
  { min: 2500, name: 'Marmaris Kahramanı', icon: 'trophy-award' as const },
];

export default function EcProfile() {
  const router = useRouter();
  const { userId, profile, session, access } = useAuth();
  const { balance, summary, ledger, audit, live, lastChange, error, reload } = useEcPoints();
  const [tab, setTab] = useState<'history' | 'audit'>('history');
  const [refreshing, setRefreshing] = useState(false);

  if (!userId) {
    return (
      <View style={styles.flex}>
        <EcHeader variant="sub" />
        <EcScroll>
          <EcNotice tone="info" text="Puan geçmişinizi görmek için giriş yapın." />
          <PrimaryButton label="Giriş Yap" icon="log-in-outline" onPress={() => router.push('/auth/sign-in')} />
        </EcScroll>
      </View>
    );
  }

  const points = balance ?? profile?.total_points ?? 0;
  const initials = (profile?.display_name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.flex}>
      <EcHeader variant="sub" />
      <EcScroll
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={ec.green}
            onRefresh={async () => {
              setRefreshing(true);
              await reload();
              setRefreshing(false);
            }}
          />
        }>
        <Card style={styles.who}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{profile?.display_name}</Text>
            <Text style={styles.email}>{session?.user.email}</Text>
            <View style={styles.rankRow}>
              <MaterialCommunityIcons name="podium-gold" size={16} color={ec.sun} />
              <Text style={styles.rank}>{summary?.rank ? `Sıralama: ${summary.rank}.` : 'Sıralama gizli'}</Text>
            </View>
          </View>
          <LiveBadge live={live} />
        </Card>

        <BalanceCard balance={balance} flash={lastChange} />
        <View style={styles.readonly}>
          <Ionicons name="lock-closed-outline" size={15} color={ec.muted} />
          <Text style={styles.readonlyText}>Puanlarınız salt okunurdur; yalnızca belediye yetkilileri düzenleyebilir.</Text>
        </View>
        {error ? <EcNotice tone="danger" text={error} /> : null}

        {access.is_municipality_admin ? (
          <PrimaryButton label="Belediye Puan Yönetimi" icon="shield-checkmark-outline" onPress={() => router.push({ pathname: '/municipality', params: { section: 'points' } })} />
        ) : null}

        <SectionHeader icon="ribbon-outline" title="Rozetlerim" />
        <View style={styles.badges}>
          {BADGES.map((b) => {
            const earned = points >= b.min;
            return (
              <View key={b.name} style={[styles.badge, !earned && styles.badgeLocked]} accessibilityLabel={`${b.name}${earned ? '' : ' (kilitli)'}`}>
                <View style={[styles.badgeIcon, { backgroundColor: earned ? ec.mint : '#EFEFEF' }]}>
                  <MaterialCommunityIcons name={earned ? b.icon : 'lock-outline'} size={24} color={earned ? ec.green : '#9E9E9E'} />
                </View>
                <Text style={styles.badgeName} numberOfLines={2}>
                  {b.name}
                </Text>
                <Text style={styles.badgeMin}>{formatPoints(b.min)} EC</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.segment}>
          {(['history', 'audit'] as const).map((k) => (
            <Pressable
              key={k}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === k }}
              onPress={() => setTab(k)}
              style={[styles.segBtn, tab === k && styles.segBtnOn]}>
              <Text style={[styles.segText, tab === k && styles.segTextOn]}>
                {k === 'history' ? 'Puan Geçmişi' : 'Belediye İşlemleri'}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'history' ? (
          ledger.length === 0 ? (
            <Text style={styles.empty}>Henüz puan hareketi yok.</Text>
          ) : (
            ledger.map((row) => {
              const plus = row.points > 0;
              return (
                <View key={row.id} style={styles.item}>
                  <View style={[styles.itemIcon, { backgroundColor: plus ? ec.mint : ec.dangerSoft }]}>
                    <Ionicons name={plus ? 'arrow-up' : 'arrow-down'} size={18} color={plus ? ec.green : ec.danger} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.itemTitle}>{LEDGER_LABEL[row.transaction_type] ?? row.transaction_type}</Text>
                    <Text style={styles.itemSub} numberOfLines={2}>
                      {row.reason && !row.reason.startsWith('reward:') && !/^[a-z_]+$/.test(row.reason) ? `${row.reason} · ` : ''}
                      {relativeTime(row.created_at)}
                    </Text>
                  </View>
                  <Text style={[styles.amount, { color: plus ? ec.green : ec.danger }]}>
                    {plus ? '+' : ''}
                    {formatPoints(row.points)} EC
                  </Text>
                </View>
              );
            })
          )
        ) : audit.length === 0 ? (
          <Text style={styles.empty}>Belediye tarafından yapılmış bir puan işlemi yok.</Text>
        ) : (
          audit.map((row) => (
            <View key={row.id} style={styles.item}>
              <View style={[styles.itemIcon, { backgroundColor: ec.infoSoft }]}>
                <Ionicons name="business-outline" size={18} color={ec.info} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.itemTitle}>
                  {OPERATION_LABEL[row.operation]} · {row.reason}
                </Text>
                <Text style={styles.itemSub}>
                  {formatPoints(row.previous_points)} → {formatPoints(row.new_points)} EC · {dateTime(row.created_at)}
                </Text>
              </View>
              <Text style={[styles.amount, { color: row.delta >= 0 ? ec.green : ec.danger }]}>
                {row.delta > 0 ? '+' : ''}
                {formatPoints(row.delta)}
              </Text>
            </View>
          ))
        )}

        <PrimaryButton label="Hesap Ayarları" icon="settings-outline" tone="outline" onPress={() => router.push('/profile')} />
      </EcScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: ec.green, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: ec.white, fontSize: 20 },
  name: { fontWeight: '700', color: ec.ink, fontSize: 17 },
  email: { fontWeight: '400', color: ec.muted, fontSize: 12.5 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  rank: { fontWeight: '600', color: ec.text, fontSize: 12.5 },
  readonly: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6, paddingHorizontal: 4 },
  readonlyText: { flex: 1, fontWeight: '400', color: ec.muted, fontSize: 12 },
  badges: { flexDirection: 'row', gap: 8 },
  badge: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: ec.card,
    borderRadius: ecRadius.md,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: ec.line,
    ...cardShadow,
  },
  badgeLocked: { opacity: 0.6 },
  badgeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badgeName: { fontWeight: '600', color: ec.ink, fontSize: 11, textAlign: 'center', marginTop: 4, minHeight: 28 },
  badgeMin: { fontWeight: '400', color: ec.muted, fontSize: 10 },
  segment: { flexDirection: 'row', backgroundColor: ec.mint, borderRadius: 12, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segBtnOn: { backgroundColor: ec.white, ...cardShadow },
  segText: { fontWeight: '500', color: ec.muted, fontSize: 13 },
  segTextOn: { fontWeight: '600', color: ec.green },
  empty: { fontWeight: '400', color: ec.muted, textAlign: 'center', paddingVertical: 12 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: ec.card,
    borderRadius: ecRadius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: ec.line,
  },
  itemIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontWeight: '600', color: ec.ink, fontSize: 13.5 },
  itemSub: { fontWeight: '400', color: ec.muted, fontSize: 12 },
  amount: { fontWeight: '700', fontSize: 14 },
});
