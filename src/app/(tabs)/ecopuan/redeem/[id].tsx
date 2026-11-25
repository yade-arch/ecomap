// EARTHCARE · QR Kod ile Ödül Kullan (references: "Ödül Kullanımı" and "QR Kod ile Ödül Kullan" phones)
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { supabase } from '@/lib/supabase';
import { fetchRedemption, markRedemptionUsed } from '@/earthcare/api';
import { EcHeader, EcNotice, EcScroll, PrimaryButton, RewardGlyph } from '@/earthcare/components/ui';
import { useEcPoints } from '@/earthcare/points-context';
import { dateTime, ecErrorText } from '@/earthcare/strings';
import { cardShadow, ec, ecRadius, formatPoints, rewardTints } from '@/earthcare/theme';
import type { Redemption } from '@/earthcare/types';
import { useAuth } from '@/providers/auth';

function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const s = {
    tl: { top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 14 },
    tr: { top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 14 },
    bl: { bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 14 },
    br: { bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 14 },
  }[pos];
  return <View style={[styles.corner, s]} />;
}

export default function RedeemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { access } = useAuth();
  const { balance } = useEcPoints();
  const [item, setItem] = useState<Redemption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setItem(await fetchRedemption(id));
      setError(null);
    } catch (e) {
      setError(ecErrorText(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    fetchRedemption(id)
      .then((row) => active && setItem(row))
      .catch((e: unknown) => active && setError(ecErrorText(e)))
      .finally(() => active && setLoading(false));
    // The partner desk marks the code used -> this screen changes state live.
    const channel = supabase
      .channel(`ec-redemption-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reward_redemptions', filter: `id=eq.${id}` }, (p) =>
        setItem((prev) => (prev ? { ...prev, ...(p.new as Partial<Redemption>) } : prev)),
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [id]);

  const markUsed = async () => {
    if (!item) return;
    setMarking(true);
    try {
      await markRedemptionUsed(item.code);
      await load();
    } catch (e) {
      setError(ecErrorText(e));
    } finally {
      setMarking(false);
    }
  };

  const reward = item?.reward ?? null;
  const tint = rewardTints[reward?.icon ?? 'cafe'] ?? rewardTints.cafe;
  const expired = item ? item.status === 'expired' || (item.status === 'issued' && new Date(item.expires_at) < new Date()) : false;
  const ready = item?.status === 'issued' && !expired;

  return (
    <View style={styles.flex}>
      <EcHeader variant="sub" showBell={false} />
      <EcScroll>
        <View style={styles.titleRow}>
          <MaterialCommunityIcons name="qrcode" size={26} color={ec.green} />
          <Text style={styles.title}>QR Kod ile Ödül Kullan</Text>
        </View>

        {loading ? <ActivityIndicator color={ec.green} /> : null}
        {error ? <EcNotice tone="danger" text={error} /> : null}
        {!loading && !item && !error ? <EcNotice tone="danger" text="Kod bulunamadı." /> : null}

        {item ? (
          <>
            <View style={styles.qrWrap}>
              <View style={styles.qrFrame}>
                <Corner pos="tl" />
                <Corner pos="tr" />
                <Corner pos="bl" />
                <Corner pos="br" />
                <View style={[styles.qrInner, !ready && { opacity: 0.25 }]}>
                  <QRCode value={`EARTHCARE:${item.code}`} size={196} color="#111111" backgroundColor="#FFFFFF" ecl="M" />
                </View>
              </View>
            </View>

            <View style={styles.summary}>
              <View style={[styles.summaryIcon, { backgroundColor: tint.bg }]}>
                <RewardGlyph icon={reward?.icon ?? 'cafe'} size={34} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.summaryTitle}>{reward?.title ?? 'Ödül'}</Text>
                {reward?.subtitle ? <Text style={styles.summarySub}>{reward.subtitle}</Text> : null}
                <View style={styles.costPill}>
                  <MaterialCommunityIcons name="leaf" size={13} color={ec.green} />
                  <Text style={styles.costText}>{item.points_spent} EcoPuan</Text>
                </View>
              </View>
            </View>

            <View style={[styles.status, !ready && { backgroundColor: item.status === 'used' ? '#EEF4FB' : ec.dangerSoft }]}>
              <Ionicons
                name={ready ? 'checkmark-circle' : item.status === 'used' ? 'checkmark-done-circle' : 'time'}
                size={26}
                color={ready ? ec.green : item.status === 'used' ? ec.info : ec.danger}
              />
              <Text style={[styles.statusText, !ready && { color: item.status === 'used' ? ec.info : ec.danger }]}>
                {ready
                  ? 'Ödülünüz kullanıma hazır'
                  : item.status === 'used'
                    ? `Ödül kullanıldı${item.used_at ? ` · ${dateTime(item.used_at)}` : ''}`
                    : 'Kodun süresi doldu'}
              </Text>
            </View>

            {showCode ? (
              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>Ödül kodu</Text>
                <Text style={styles.code} selectable>
                  {item.code}
                </Text>
                <Text style={styles.codeMeta}>Son kullanma: {dateTime(item.expires_at)}</Text>
              </View>
            ) : null}

            <PrimaryButton
              label={showCode ? 'Kodu Gizle' : 'Kodu Göster'}
              icon="qr-code-outline"
              onPress={() => setShowCode((v) => !v)}
            />

            <View style={styles.note}>
              <Ionicons name="information-circle-outline" size={18} color={ec.muted} />
              <Text style={styles.noteText}>
                Bu QR kodu, {reward?.partner ?? reward?.title ?? 'iş ortağı'}&apos;nde ödülünüzü kullanmak için personele gösteriniz.
              </Text>
            </View>

            <View style={styles.remaining}>
              <MaterialCommunityIcons name="leaf" size={18} color={ec.green} />
              <Text style={styles.remainingText}>
                Kalan bakiye: <Text style={styles.remainingValue}>{formatPoints(balance)} EC</Text>
              </Text>
            </View>

            {access.is_municipality_admin && ready ? (
              <PrimaryButton label="Kullanıldı olarak işaretle" icon="checkmark-done" tone="outline" loading={marking} onPress={() => void markUsed()} />
            ) : null}
          </>
        ) : null}
      </EcScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontWeight: '700', fontSize: 20, color: ec.ink },
  qrWrap: { alignItems: 'center' },
  qrFrame: { width: 250, height: 250, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: ec.green },
  qrInner: { backgroundColor: ec.white, padding: 10, borderRadius: 8, ...cardShadow },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: ec.card,
    borderRadius: ecRadius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: ec.line,
    ...cardShadow,
  },
  summaryIcon: { width: 64, height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { fontWeight: '700', fontSize: 18, color: ec.ink },
  summarySub: { fontWeight: '400', fontSize: 12.5, color: ec.muted },
  costPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ec.mint,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 4,
  },
  costText: { fontWeight: '600', color: ec.green, fontSize: 12.5 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: ec.mint,
    borderRadius: ecRadius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: ec.mintBorder,
  },
  statusText: { flex: 1, fontWeight: '600', color: ec.green, fontSize: 15.5 },
  codeBox: { alignItems: 'center', backgroundColor: ec.card, borderRadius: ecRadius.lg, padding: 14, borderWidth: 1, borderColor: ec.line },
  codeLabel: { fontWeight: '500', color: ec.muted, fontSize: 12 },
  code: { fontWeight: '800', color: ec.ink, fontSize: 26, letterSpacing: 2 },
  codeMeta: { fontWeight: '400', color: ec.muted, fontSize: 12 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 },
  noteText: { flex: 1, fontWeight: '400', color: ec.muted, fontSize: 12.5, lineHeight: 18 },
  remaining: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: ec.mint,
    borderRadius: ecRadius.md,
    padding: 12,
  },
  remainingText: { fontWeight: '500', color: ec.text, fontSize: 14 },
  remainingValue: { fontWeight: '700', color: ec.green },
});
