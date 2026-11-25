// EARTHCARE · Ana Sayfa (reference: "EARTHCARE – Marmaris App Entegrasyon Önerisi" phone).
// Shown in two places: the EARTHCARE module's first tab and the EcoMap "EcoPuan" tab.
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { SceneImage } from '@/earthcare/components/scenes';
import {
  BalanceCard,
  EcHeader,
  EcNotice,
  EcScroll,
  PrimaryButton,
  RewardGlyph,
  SectionHeader,
  StatTile,
} from '@/earthcare/components/ui';
import { useEcPoints } from '@/earthcare/points-context';
import { useWalk } from '@/earthcare/walk';
import { cardShadow, ec, ecRadius, formatKg, formatPoints, rewardTints } from '@/earthcare/theme';
import { useRewards } from '@/earthcare/use-rewards';
import { useAuth } from '@/providers/auth';

const BALANCE_INFO =
  'EcoPuan; onaylanan çevresel katkılarınız (bildirim, temizlik) ve belediye etkinlikleri karşılığında kazanılır. ' +
  'Biriktirdiğiniz puanları Marmaris Belediyesi iş birliğindeki ödüllerde kullanabilirsiniz.';

export function EarthcareHomeScreen() {
  const router = useRouter();
  const { userId, access } = useAuth();
  const { balance, summary, lastChange, loading, error, reload } = useEcPoints();
  const { rewards, reload: reloadRewards } = useRewards();
  const [refreshing, setRefreshing] = useState(false);
  const walk = useWalk();

  const info = () => {
    if (Platform.OS === 'web') window.alert(BALANCE_INFO);
    else Alert.alert('EcoPuan nedir?', BALANCE_INFO);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([reload(), reloadRewards()]);
    setRefreshing(false);
  };

  return (
    <View style={styles.flex}>
      <EcHeader variant="home" bellDot={!!lastChange} />
      <EcScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ec.green} />}>
        <SceneImage scene="bay" style={styles.hero}>
          <View style={styles.heroPanel}>
            <Text style={styles.heroText}>
              Çevreye katkı sağla, Marmaris&apos;in daha temiz ve sürdürülebilir geleceğine destek ol!
            </Text>
          </View>
        </SceneImage>

        {access.is_municipality_admin ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/municipality', params: { section: 'points' } })}
            style={({ pressed }) => [styles.adminBanner, pressed && { opacity: 0.9 }]}>
            <View style={styles.adminIcon}>
              <Ionicons name="shield-checkmark" size={20} color={ec.white} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.adminTitle}>Belediye Puan Yönetimi</Text>
              <Text style={styles.adminSub}>Vatandaş puanlarını anlık görüntüle ve düzenle</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={ec.infoDark} />
          </Pressable>
        ) : null}

        <BalanceCard balance={userId ? balance : null} onInfo={info} flash={lastChange} />

        {!userId ? (
          <EcNotice tone="info" text="EcoPuan biriktirmek ve ödülleri kullanmak için giriş yapın." />
        ) : null}
        {error && !loading ? <EcNotice tone="danger" text={error} /> : null}

        <View style={styles.stats}>
          <StatTile
            icon={<MaterialCommunityIcons name="leaf" size={20} color={ec.greenBright} />}
            value={summary ? String(summary.contributions) : '—'}
            label="Onaylanan Katkı"
          />
          <StatTile
            icon={<MaterialCommunityIcons name="recycle" size={20} color={ec.green} />}
            value={summary ? `${formatKg(summary.waste_kg)} kg` : '—'}
            label="Toplanan Atık"
          />
          <StatTile
            icon={<Ionicons name="gift-outline" size={19} color={ec.warning} />}
            value={summary ? String(summary.rewards_used) : '—'}
            label="Kullanılan Ödül"
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Eko-Ulaşım: yürüyüş ve bisiklet"
          onPress={() => router.push('/ecopuan/mobility')}
          style={({ pressed }) => [styles.mobility, pressed && { opacity: 0.9 }]}>
          <View style={styles.mobilityIcon}>
            <MaterialCommunityIcons name="walk" size={24} color={ec.white} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.mobilityTitle}>Eko-Ulaşım</Text>
            <Text style={styles.mobilitySub} numberOfLines={1}>
              {walk.permission === 'granted'
                ? `Bugün ${formatPoints(Math.max(walk.steps, walk.server?.steps ?? 0))} adım · +${walk.server?.points_today ?? 0} EC`
                : 'Yürü veya belediye bisikletiyle sür, EcoPuan kazan'}
            </Text>
          </View>
          <MaterialCommunityIcons name="bicycle" size={22} color={ec.green} />
          <Ionicons name="chevron-forward" size={18} color={ec.muted} />
        </Pressable>

        <PrimaryButton
          label="Çevresel Katkı Bildir"
          icon="camera"
          onPress={() => (userId ? router.push('/ecopuan/contribute') : router.push('/auth/sign-in'))}
        />

        <SectionHeader icon="gift-outline" title="Ödüller" action="Tüm Ödülleri Gör" onAction={() => router.push('/ecopuan/rewards')} />
        <View style={styles.grid}>
          {rewards.map((r) => {
            const tint = rewardTints[r.icon] ?? rewardTints.bicycle;
            return (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={`${r.title}, ${r.cost} EcoPuan`}
                onPress={() => router.push('/ecopuan/rewards')}
                style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}>
                <View style={[styles.tileIcon, { backgroundColor: tint.bg }]}>
                  <RewardGlyph icon={r.icon} size={24} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.tileTitle} numberOfLines={2}>
                    {r.title}
                  </Text>
                  <Text style={[styles.tileCost, { color: tint.fg }]}>{r.cost} EC</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={ec.muted} />
              </Pressable>
            );
          })}
        </View>
      </EcScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    width: '100%',
    aspectRatio: 1.9,
    minHeight: 150,
    borderRadius: ecRadius.xl,
    justifyContent: 'center',
    alignItems: 'flex-end',
    padding: 12,
    ...cardShadow,
  },
  heroPanel: {
    maxWidth: '62%',
    flexShrink: 1,
    backgroundColor: ec.white,
    borderRadius: ecRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  heroText: { fontWeight: '600', color: ec.header, fontSize: 13.5, lineHeight: 19 },

  adminBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: ec.infoSoft,
    borderRadius: ecRadius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: '#C9DDF4',
  },
  adminIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: ec.info, alignItems: 'center', justifyContent: 'center' },
  adminTitle: { fontWeight: '700', color: ec.infoDark, fontSize: 14.5 },
  adminSub: { fontWeight: '400', color: '#46627F', fontSize: 12 },

  stats: { flexDirection: 'row', gap: 10 },
  mobility: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: ec.card,
    borderRadius: ecRadius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: ec.mintBorder,
    ...cardShadow,
  },
  mobilityIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: ec.green, alignItems: 'center', justifyContent: 'center' },
  mobilityTitle: { fontWeight: '700', color: ec.ink, fontSize: 15 },
  mobilitySub: { color: ec.muted, fontSize: 12.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: ec.card,
    borderRadius: ecRadius.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: ec.line,
    ...cardShadow,
  },
  tileIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontWeight: '600', color: ec.ink, fontSize: 13.5 },
  tileCost: { fontWeight: '700', fontSize: 12 },
});
