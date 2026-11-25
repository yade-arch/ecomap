// EcoPuan › Eko-Ulaşım: walking (step counter) and municipal bike rides.
// Points, daily caps and anti-abuse checks are all on the server (sync_walk_steps, finish_bike_ride).
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useBikeRides, type RideResult } from '@/earthcare/bike';
import { Card, EcHeader, EcNotice, EcScroll, PrimaryButton, SectionHeader } from '@/earthcare/components/ui';
import { useNow } from '@/earthcare/mystery';
import { ecErrorText, relativeTime } from '@/earthcare/strings';
import { ec, ecRadius, formatPoints } from '@/earthcare/theme';
import { requestWalkPermission, syncWalk, useWalk } from '@/earthcare/walk';
import { useAuth } from '@/providers/auth';

// Same rules as the server defaults (app_config eco.*); the server response overrides them.
const WALK_STEPS = 3000;
const WALK_PTS = 20;
const WALK_CAP = 100;
const BIKE_PTS = 30;
const BIKE_CAP = 120;
const M_PER_STEP = 0.75;
const CO2_G_PER_KM = 120;

function km(m: number) {
  return (m / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2, minimumFractionDigits: m < 10000 ? 2 : 1 });
}
function co2(g: number) {
  return g >= 1000 ? `${(g / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} kg` : `${Math.round(g)} g`;
}
function clock(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function Stat({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function WalkCard() {
  const walk = useWalk();
  const s = walk.server;
  const steps = Math.max(walk.steps, s?.steps ?? 0);
  const per = s?.steps_per_reward ?? WALK_STEPS;
  const pts = s?.points_per_reward ?? WALK_PTS;
  const cap = s?.daily_cap ?? WALK_CAP;
  const earned = s?.points_today ?? 0;
  const capped = earned >= cap;
  const into = steps % per;
  const meters = s?.distance_m ?? steps * M_PER_STEP;

  return (
    <Card style={styles.card}>
      <SectionHeader icon="walk-outline" title="Yürüyüş" />
      <Text style={styles.rule}>
        Her {formatPoints(per)} adımda +{pts} EC · günde en fazla {cap} EC
      </Text>

      {walk.permission === 'unavailable' ? (
        <EcNotice
          tone="info"
          text={
            Platform.OS === 'web'
              ? 'Adım sayar yalnızca telefon uygulamasında çalışır.'
              : 'Bu cihazda adım sensörü bulunamadı.'
          }
        />
      ) : walk.permission === 'undetermined' || walk.permission === 'checking' ? (
        <View style={styles.permission}>
          <MaterialCommunityIcons name="shoe-print" size={30} color={ec.green} />
          <View style={styles.flex}>
            <Text style={styles.permTitle}>Adım sayarı açın</Text>
            <Text style={styles.permText}>
              Yürüdüğünüz adımları saymak için hareket sensörü izni gerekir. Konumunuz kaydedilmez.
            </Text>
          </View>
          <PrimaryButton label="İzin ver" onPress={() => void requestWalkPermission()} style={styles.permBtn} />
        </View>
      ) : walk.permission === 'denied' ? (
        <View style={styles.permission}>
          <Ionicons name="lock-closed-outline" size={26} color={ec.danger} />
          <View style={styles.flex}>
            <Text style={styles.permTitle}>Hareket izni kapalı</Text>
            <Text style={styles.permText}>Ayarlar → EcoMap → Hareket ve Fitness iznini açın.</Text>
          </View>
          <PrimaryButton label="Ayarlar" tone="outline" onPress={() => void Linking.openSettings()} style={styles.permBtn} />
        </View>
      ) : (
        <>
          <View style={styles.stats}>
            <Stat value={formatPoints(steps)} label="adım (bugün)" icon={<MaterialCommunityIcons name="shoe-print" size={20} color={ec.green} />} />
            <Stat value={`${km(meters)} km`} label="yürüme" icon={<Ionicons name="navigate-outline" size={20} color={ec.info} />} />
            <Stat
              value={co2(s?.co2_saved_g ?? (meters / 1000) * CO2_G_PER_KM)}
              label="CO₂ tasarrufu"
              icon={<MaterialCommunityIcons name="molecule-co2" size={22} color={ec.greenBright} />}
            />
          </View>
          <View style={styles.progressHead}>
            <Text style={styles.progressText}>
              {capped ? 'Bugünkü yürüyüş limitine ulaştınız 🎉' : `Sonraki +${pts} EC için ${formatPoints(per - into)} adım`}
            </Text>
            <Text style={styles.earned}>
              {earned}/{cap} EC
            </Text>
          </View>
          <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: per, now: capped ? per : into }}>
            <View style={[styles.barFill, { width: `${capped ? 100 : Math.round((into / per) * 100)}%` }]} />
          </View>
          {Platform.OS === 'android' ? (
            <Text style={styles.note}>{"Android'de adımlar EcoMap açıkken sayılır."}</Text>
          ) : null}
          {walk.error ? <EcNotice tone="danger" text={ecErrorText({ message: walk.error })} /> : null}
          <PrimaryButton label="Adımları şimdi gönder" icon="sync" tone="outline" loading={walk.syncing} onPress={() => void syncWalk(true)} />
        </>
      )}
    </Card>
  );
}

function BikeCard() {
  const { userId } = useAuth();
  const bike = useBikeRides(userId);
  const now = useNow(1000);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<RideResult | null>(null);

  const elapsed = bike.active ? Math.max(0, (now - new Date(bike.active.started_at).getTime()) / 1000) : 0;
  const estimate = Math.max(Math.floor(elapsed / 900), Math.floor(bike.distance / 3000)) * BIKE_PTS;

  const finish = async () => {
    const r = await bike.finish();
    if (r) setResult(r);
  };

  return (
    <Card style={styles.card}>
      <SectionHeader icon="bicycle-outline" title="Belediye Bisikleti" />
      <Text style={styles.rule}>Her 15 dakika veya 3 km sürüşte +{BIKE_PTS} EC · günde en fazla {BIKE_CAP} EC</Text>

      {bike.active ? (
        <View style={styles.ride}>
          <View style={styles.rideHead}>
            <View style={styles.liveDot} />
            <Text style={styles.rideTitle}>Sürüş devam ediyor · {bike.active.bike_code}</Text>
          </View>
          <View style={styles.stats}>
            <Stat value={clock(elapsed)} label="süre" icon={<Ionicons name="timer-outline" size={20} color={ec.green} />} />
            <Stat value={`${km(bike.distance)} km`} label="mesafe (GPS)" icon={<Ionicons name="navigate-outline" size={20} color={ec.info} />} />
            <Stat value={`~${estimate} EC`} label="tahmini" icon={<MaterialCommunityIcons name="leaf" size={20} color={ec.greenBright} />} />
          </View>
          <PrimaryButton label="Sürüşü Bitir" icon="flag" loading={bike.busy} onPress={() => void finish()} />
          <Pressable accessibilityRole="button" onPress={() => void bike.cancel()} style={styles.cancel}>
            <Text style={styles.cancelText}>Sürüşü iptal et</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.label}>Bisiklet numarası</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20))}
            placeholder="Örn. MRM-042"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="characters"
            style={styles.input}
            accessibilityLabel="Bisiklet numarası"
          />
          <PrimaryButton
            label="Sürüşü Başlat"
            icon="bicycle"
            loading={bike.busy}
            disabled={code.length < 2 || !userId}
            onPress={() => {
              setResult(null);
              void bike.start(code);
            }}
          />
        </>
      )}

      {result ? (
        <EcNotice
          tone={result.points > 0 ? 'success' : 'info'}
          text={
            result.status === 'too_short'
              ? 'Sürüş 1 dakikadan kısa olduğu için puan verilmedi.'
              : result.points > 0
                ? `Sürüş tamamlandı: ${clock(result.duration_s)} · ${km(result.distance_m ?? 0)} km · +${result.points} EC (Eko-Ulaşım: Bisiklet Sürüşü)`
                : `Sürüş kaydedildi (${clock(result.duration_s)}). ${(result.points_today ?? 0) >= (result.daily_cap ?? BIKE_CAP) ? 'Bugünkü bisiklet limitine ulaştınız.' : 'Puan için en az 15 dk sürüş veya 3 km gerekir.'}`
          }
        />
      ) : null}
      {bike.error ? <EcNotice tone="danger" text={ecErrorText({ message: bike.error })} /> : null}

      {bike.recent.length > 0 ? (
        <View style={styles.history}>
          <Text style={styles.label}>Son sürüşler</Text>
          {bike.recent.slice(0, 5).map((r) => (
            <View key={r.id} style={styles.histRow}>
              <MaterialCommunityIcons name="bicycle" size={18} color={r.status === 'completed' ? ec.green : ec.muted} />
              <Text style={styles.histText} numberOfLines={1}>
                {r.bike_code} · {r.duration_s != null ? clock(r.duration_s) : '—'} · {km(r.distance_m ?? 0)} km ·{' '}
                {relativeTime(r.started_at)}
              </Text>
              <Text style={[styles.histPts, r.points_awarded <= 0 && { color: ec.muted }]}>
                {r.status === 'cancelled' ? 'iptal' : `+${r.points_awarded} EC`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export default function MobilityScreen() {
  const { userId } = useAuth();
  return (
    <View style={styles.flex}>
      <EcHeader variant="sub" />
      <EcScroll>
        <View style={styles.pageTitle}>
          <MaterialCommunityIcons name="leaf-circle-outline" size={28} color={ec.green} />
          <View>
            <Text style={styles.pageTitleText}>Eko-Ulaşım</Text>
            <Text style={styles.pageSub}>Yürü, pedala bas, karbonu azalt, EcoPuan kazan.</Text>
          </View>
        </View>
        {!userId ? <EcNotice tone="info" text="Eko-Ulaşım puanları için giriş yapın." /> : null}
        <WalkCard />
        <BikeCard />
        <Text style={styles.footnote}>
          CO₂ tasarrufu, aynı mesafenin otomobille gidilmesine göre tahminidir (km başına ~{CO2_G_PER_KM} g). Puanlar ve günlük
          limitler sunucuda hesaplanır.
        </Text>
      </EcScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pageTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pageTitleText: { fontWeight: '800', fontSize: 22, color: ec.ink },
  pageSub: { color: ec.muted, fontSize: 13 },
  card: { gap: 10, borderWidth: 1, borderColor: ec.line },
  rule: { color: ec.text, fontSize: 13, backgroundColor: ec.mint, borderRadius: ecRadius.sm, padding: 8 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: ec.bg, borderRadius: ecRadius.md, paddingVertical: 10, paddingHorizontal: 4 },
  statValue: { fontWeight: '800', fontSize: 17, color: ec.ink },
  statLabel: { fontSize: 11.5, color: ec.muted, textAlign: 'center' },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  progressText: { flex: 1, color: ec.text, fontSize: 13, fontWeight: '600' },
  earned: { color: ec.green, fontWeight: '800', fontSize: 13 },
  bar: { height: 10, borderRadius: 5, backgroundColor: ec.mintDeep, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: ec.green, borderRadius: 5 },
  note: { color: ec.muted, fontSize: 12 },
  permission: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: ec.mint, borderRadius: ecRadius.md, padding: 12, flexWrap: 'wrap' },
  permTitle: { fontWeight: '700', color: ec.ink, fontSize: 14.5 },
  permText: { color: ec.text, fontSize: 12.5, lineHeight: 17 },
  permBtn: { minHeight: 42, paddingHorizontal: 14 },
  label: { fontWeight: '600', color: ec.text, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: ec.mintBorder,
    borderRadius: ecRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
    color: ec.ink,
    backgroundColor: ec.white,
  },
  ride: { gap: 10 },
  rideHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ec.greenBright },
  rideTitle: { fontWeight: '700', color: ec.ink, fontSize: 14.5 },
  cancel: { alignSelf: 'center', padding: 6 },
  cancelText: { color: ec.danger, fontWeight: '600', fontSize: 13 },
  history: { gap: 6, marginTop: 4 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  histText: { flex: 1, color: ec.text, fontSize: 12.5 },
  histPts: { fontWeight: '700', color: ec.green, fontSize: 12.5 },
  footnote: { color: ec.muted, fontSize: 11.5, lineHeight: 16 },
});
