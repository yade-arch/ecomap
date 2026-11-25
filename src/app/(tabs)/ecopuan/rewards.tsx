// EARTHCARE · Ödüller (reference: "Ödüller" phone with four reward rows and "QR Kod Oluştur")
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { fetchMyRedemptions, redeemReward } from '@/earthcare/api';
import { BalanceCard, EcHeader, EcNotice, EcScroll, RewardGlyph } from '@/earthcare/components/ui';
import { useEcPoints } from '@/earthcare/points-context';
import { ecErrorText, relativeTime } from '@/earthcare/strings';
import { cardShadow, ec, ecRadius, rewardTints } from '@/earthcare/theme';
import type { Redemption, Reward } from '@/earthcare/types';
import { useRewards } from '@/earthcare/use-rewards';
import { useAuth } from '@/providers/auth';
import { confirm } from '@/ui/components';

export default function RewardsScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const { balance, lastChange, reload } = useEcPoints();
  const { rewards, loading, error: catalogError, reload: reloadRewards } = useRewards();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<Redemption[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadCodes = useCallback(async () => {
    if (!userId) return setCodes([]);
    try {
      setCodes((await fetchMyRedemptions(userId)).filter((r) => r.status === 'issued' && new Date(r.expires_at) > new Date()));
    } catch {
      // the list is a convenience; errors are shown for actions only
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void loadCodes();
    }, [loadCodes]),
  );

  const create = async (reward: Reward) => {
    if (!userId) return router.push('/auth/sign-in');
    setError(null);
    const ok = await confirm(
      `${reward.title} için ${reward.cost} EcoPuan harcanacak ve tek kullanımlık QR kod oluşturulacak. Onaylıyor musunuz?`,
      'QR Kod Oluştur',
      'Vazgeç',
    );
    if (!ok) return;
    setBusyId(reward.id);
    try {
      const result = await redeemReward(reward.id);
      void reload();
      router.push({ pathname: '/ecopuan/redeem/[id]', params: { id: result.redemption_id } });
    } catch (e) {
      setError(ecErrorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([reload(), reloadRewards(), loadCodes()]);
    setRefreshing(false);
  };

  return (
    <View style={styles.flex}>
      <EcHeader variant="sub" />
      <EcScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ec.green} />}>
        <View style={styles.pageTitle}>
          <Ionicons name="gift-outline" size={26} color={ec.green} />
          <Text style={styles.pageTitleText}>Ödüller</Text>
        </View>

        <BalanceCard balance={userId ? balance : null} compact flash={lastChange} />

        {catalogError ? <EcNotice tone="danger" text={catalogError} /> : null}
        {error ? <EcNotice tone="danger" text={error} /> : null}
        {loading && rewards.length === 0 ? <ActivityIndicator color={ec.green} /> : null}

        {rewards.map((r) => {
          const tint = rewardTints[r.icon] ?? rewardTints.bicycle;
          const affordable = balance != null && balance >= r.cost;
          const busy = busyId === r.id;
          return (
            <View key={r.id} style={[styles.row, { backgroundColor: tint.bg, borderColor: `${tint.fg}33` }]}>
              <View style={[styles.iconBox, { borderColor: `${tint.fg}55` }]}>
                <RewardGlyph icon={r.icon} size={34} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowDesc}>{r.description}</Text>
                <View style={[styles.costPill, { backgroundColor: ec.white }]}>
                  <MaterialCommunityIcons name="leaf" size={12} color={tint.fg} />
                  <Text style={[styles.costText, { color: tint.fg }]}>{r.cost} EcoPuan</Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${r.title} için QR Kod Oluştur`}
                accessibilityState={{ disabled: !affordable || busy }}
                disabled={!affordable || busy || !!busyId}
                onPress={() => void create(r)}
                style={({ pressed }) => [
                  styles.qrBtn,
                  { backgroundColor: tint.btn },
                  (!affordable || (!!busyId && !busy)) && styles.qrBtnOff,
                  pressed && { opacity: 0.85 },
                ]}>
                {busy ? (
                  <ActivityIndicator color={ec.white} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="qrcode" size={22} color={ec.white} />
                    <Text style={styles.qrText}>{affordable || balance == null ? 'QR Kod\nOluştur' : `${r.cost - balance} EC\neksik`}</Text>
                  </>
                )}
              </Pressable>
            </View>
          );
        })}

        {codes.length > 0 ? (
          <View style={styles.codes}>
            <Text style={styles.codesTitle}>Kullanıma hazır kodlarım</Text>
            {codes.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/ecopuan/redeem/[id]', params: { id: c.id } })}
                style={({ pressed }) => [styles.codeRow, pressed && { opacity: 0.85 }]}>
                <MaterialCommunityIcons name="qrcode-scan" size={22} color={ec.green} />
                <View style={styles.flex}>
                  <Text style={styles.codeName}>{c.reward?.title ?? 'Ödül'}</Text>
                  <Text style={styles.codeMeta}>
                    {c.code} · {relativeTime(c.created_at)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={ec.muted} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </EcScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pageTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  pageTitleText: { fontWeight: '700', fontSize: 24, color: ec.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: ecRadius.lg,
    padding: 12,
    borderWidth: 1,
    ...cardShadow,
  },
  iconBox: {
    width: 62,
    height: 62,
    borderRadius: 14,
    backgroundColor: ec.white,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontWeight: '700', color: ec.ink, fontSize: 16 },
  rowDesc: { fontWeight: '400', color: ec.text, fontSize: 12, lineHeight: 16, marginTop: 1 },
  costPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  costText: { fontWeight: '600', fontSize: 11 },
  qrBtn: {
    width: 84,
    minHeight: 62,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 2,
  },
  qrBtnOff: { opacity: 0.45 },
  qrText: { fontWeight: '600', color: ec.white, fontSize: 11, lineHeight: 13, textAlign: 'center' },
  codes: { gap: 8, marginTop: 4 },
  codesTitle: { fontWeight: '700', color: ec.ink, fontSize: 15 },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: ec.card,
    borderRadius: ecRadius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: ec.line,
  },
  codeName: { fontWeight: '600', color: ec.ink, fontSize: 14 },
  codeMeta: { fontWeight: '400', color: ec.muted, fontSize: 12 },
});
