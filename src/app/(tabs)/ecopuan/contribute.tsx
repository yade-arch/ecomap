// EARTHCARE · Katkı Sağla (reference: "Çevresel Katkı Bildir" phone)
// Before photo -> pollution report (AI check); after photo -> cleanup submission on that report.
// Points are granted by the existing server flow once the cleanup is verified (AI or moderator).
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { submitCleanup, submitReport } from '@/lib/api';
import { type Coords, describePlace, getCurrentCoords, type Place } from '@/lib/geo';
import { type PickedPhoto, pickPhoto, uploadPhoto } from '@/lib/photo';
import { SceneImage } from '@/earthcare/components/scenes';
import { Card, EcHeader, EcNotice, EcScroll, PrimaryButton } from '@/earthcare/components/ui';
import { useEcPoints } from '@/earthcare/points-context';
import { ecErrorText } from '@/earthcare/strings';
import { cardShadow, ec, ecRadius } from '@/earthcare/theme';
import { useAuth } from '@/providers/auth';

type Slot = 'before' | 'after';
interface Outcome {
  tone: 'success' | 'info' | 'danger';
  text: string;
  reportId?: string | null;
}

function ProgressRing({ active, done }: { active: boolean; done: boolean }) {
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [active, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const C = 2 * Math.PI * 15;
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Svg width={38} height={38} viewBox="0 0 38 38">
        <Circle cx={19} cy={19} r={15} stroke={ec.mintDeep} strokeWidth={4} fill="none" />
        <Circle
          cx={19}
          cy={19}
          r={15}
          stroke={ec.greenBright}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${C}`}
          strokeDashoffset={done ? 0 : C * 0.7}
          transform="rotate(-90 19 19)"
        />
      </Svg>
    </Animated.View>
  );
}

export default function ContributeScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const { reload } = useEcPoints();
  const [before, setBefore] = useState<PickedPhoto | null>(null);
  const [after, setAfter] = useState<PickedPhoto | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [locating, setLocating] = useState(!!userId);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const applyCoords = useCallback(async (found: Coords | null) => {
    setCoords(found);
    setLocating(false);
    if (found) setPlace(await describePlace(found));
    else setError('Konum alınamadı. Konum iznini açıp tekrar deneyin.');
  }, []);

  const locate = async () => {
    setLocating(true);
    await applyCoords(await getCurrentCoords());
  };

  // Location is read once when the screen opens (the user can refresh it with "Konum Ekle").
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void getCurrentCoords().then((found) => {
      if (active) void applyCoords(found);
    });
    return () => {
      active = false;
    };
  }, [userId, applyCoords]);

  const pick = async (slot: Slot) => {
    setError(null);
    const choose = async (source: 'camera' | 'gallery') => {
      try {
        const photo = await pickPhoto(source);
        if (photo) (slot === 'before' ? setBefore : setAfter)(photo);
      } catch (e) {
        setError(ecErrorText(e));
      }
    };
    if (Platform.OS === 'web') return choose('gallery');
    Alert.alert(slot === 'before' ? 'Öncesi fotoğrafı' : 'Sonrası fotoğrafı', undefined, [
      { text: 'Fotoğraf çek', onPress: () => void choose('camera') },
      { text: 'Galeriden seç', onPress: () => void choose('gallery') },
      { text: 'Vazgeç', style: 'cancel' },
    ]);
  };

  const send = async () => {
    if (!userId) return router.push('/auth/sign-in');
    if (!before || !after) return setError('Lütfen öncesi ve sonrası fotoğraflarını ekleyin.');
    if (!coords) return setError('Konum gerekli. Lütfen "Konum Ekle" ile konumunuzu alın.');
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      setStep('Öncesi fotoğrafı yükleniyor…');
      const beforePath = await uploadPhoto(before, 'report-photos', userId);
      setStep('Yapay zekâ kirliliği analiz ediyor…');
      const report = await submitReport({
        photoPath: beforePath,
        latitude: coords.latitude,
        longitude: coords.longitude,
        address: place?.address ?? null,
        city: place?.city ?? null,
        country: place?.country ?? null,
        description: 'EARTHCARE çevresel katkı',
        userSeverity: 'medium',
      });

      if (report.status === 'not_pollution' || report.status === 'unclear') {
        setOutcome({
          tone: 'danger',
          text:
            report.status === 'unclear'
              ? 'Öncesi fotoğrafı net değil. Lütfen kirliliği net gösteren yeni bir fotoğraf ekleyin.'
              : 'Öncesi fotoğrafında çevre kirliliği tespit edilmedi.',
        });
        return;
      }
      const reportId = report.report_id ?? null;
      if (!reportId) throw new Error(report.status);
      if (report.status === 'pending_review') {
        setOutcome({
          tone: 'info',
          reportId,
          text: 'Bildiriminiz alındı ve belediye incelemesinde. Onaylandığında sonrası fotoğrafınızı bildirim sayfasından ekleyebilirsiniz.',
        });
        return;
      }

      setStep('Sonrası fotoğrafı yükleniyor…');
      const afterPath = await uploadPhoto(after, 'cleanup-photos', userId);
      setStep('Yapay zekâ temizliği doğruluyor…');
      const cleanup = await submitCleanup({ reportId, photoPath: afterPath, latitude: coords.latitude, longitude: coords.longitude });
      if (cleanup.status === 'approved') {
        setOutcome({ tone: 'success', reportId, text: `Katkınız doğrulandı! +${cleanup.points ?? 0} EcoPuan kazandınız.` });
      } else if (cleanup.status === 'manual_review' || cleanup.status === 'pending') {
        setOutcome({
          tone: 'info',
          reportId,
          text: 'Katkınız alındı. Doğrulama tamamlanınca EcoPuan bakiyenize anında eklenecek.',
        });
      } else if (cleanup.status === 'rejected') {
        setOutcome({ tone: 'danger', reportId, text: 'Sonrası fotoğrafı temizliği doğrulamadı. Lütfen alanın temiz halini çekin.' });
      } else {
        setOutcome({ tone: 'danger', reportId, text: ecErrorText({ message: cleanup.status }) });
      }
      setBefore(null);
      setAfter(null);
      void reload();
    } catch (e) {
      setError(ecErrorText(e));
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  const slot = (which: Slot) => {
    const photo = which === 'before' ? before : after;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={which === 'before' ? 'Öncesi fotoğrafı ekle' : 'Sonrası fotoğrafı ekle'}
        onPress={() => void pick(which)}
        style={styles.slot}>
        <SceneImage scene={which === 'before' ? 'parkBefore' : 'parkAfter'} style={styles.slotImage}>
          {photo ? <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={styles.slotDim} />}
          <View style={styles.slotTag}>
            <Text style={styles.slotTagText}>{which === 'before' ? 'Öncesi' : 'Sonrası'}</Text>
          </View>
          <View style={styles.camBadge}>
            <Ionicons name={photo ? 'checkmark' : 'camera'} size={15} color={ec.white} />
          </View>
        </SceneImage>
      </Pressable>
    );
  };

  return (
    <View style={styles.flex}>
      <EcHeader variant="sub" showBell={false} />
      <EcScroll>
        <Card style={styles.mainCard}>
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <Ionicons name="camera-outline" size={28} color={ec.green} />
            </View>
            <View style={styles.flex}>
              <View style={styles.titleLine}>
                <Text style={styles.title}>Çevresel Katkı Bildir</Text>
                <MaterialCommunityIcons name="leaf" size={20} color={ec.greenBright} />
              </View>
              <Text style={styles.desc}>
                Kirlilik tespit ettiğiniz alanı temizleyin, katkınızı fotoğraflarla bildirin.
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fotoğraf Yükle"
            onPress={() => void pick(before ? 'after' : 'before')}
            style={({ pressed }) => [styles.drop, pressed && { backgroundColor: ec.mintDeep }]}>
            <Ionicons name="cloud-upload-outline" size={34} color={ec.green} />
            <Text style={styles.dropTitle}>Fotoğraf Yükle</Text>
            <Text style={styles.dropSub}>Öncesi ve sonrası fotoğraflarını ekleyin.</Text>
          </Pressable>

          <View style={styles.pair}>
            {slot('before')}
            <Ionicons name="arrow-forward" size={24} color={ec.green} />
            {slot('after')}
          </View>
        </Card>

        <Pressable accessibilityRole="button" onPress={() => void locate()} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
          <View style={styles.rowIcon}>
            <Ionicons name="location" size={22} color={ec.green} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>{coords ? 'Konum Eklendi' : 'Konum Ekle'}</Text>
            <Text style={styles.rowSub} numberOfLines={2}>
              {locating
                ? 'Konumunuz alınıyor…'
                : coords
                  ? (place?.address ?? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`)
                  : 'Konumunuz otomatik olarak kaydedilecek.'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={ec.muted} />
        </Pressable>

        <View style={[styles.row, styles.aiRow]}>
          <View style={[styles.rowIcon, styles.aiIcon]}>
            <MaterialCommunityIcons name="chip" size={20} color={ec.green} />
            <Text style={styles.aiText}>AI</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>Yapay zekâ ile doğrulanıyor</Text>
            <Text style={styles.rowSub}>
              {busy && step ? step : 'Fotoğraflarınız çevre kirliliği ve temizlik kriterlerine göre analiz edilecek.'}
            </Text>
          </View>
          <ProgressRing active={busy} done={outcome?.tone === 'success'} />
        </View>

        {error ? <EcNotice tone="danger" text={error} /> : null}
        {outcome ? <EcNotice tone={outcome.tone} text={outcome.text} /> : null}
        {outcome?.reportId ? (
          <PrimaryButton
            label="Bildirimi Görüntüle"
            icon="document-text-outline"
            tone="outline"
            onPress={() => router.push({ pathname: '/report/[id]', params: { id: outcome.reportId as string } })}
          />
        ) : null}

        <PrimaryButton label="Gönder" icon="paper-plane-outline" onPress={() => void send()} loading={busy} disabled={!before || !after} />
      </EcScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  mainCard: { gap: 14, borderWidth: 1, borderColor: ec.line },
  titleRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  titleIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: ec.mint,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ec.mintBorder,
  },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontWeight: '700', color: ec.ink, fontSize: 19 },
  desc: { fontWeight: '400', color: ec.text, fontSize: 13, lineHeight: 18, marginTop: 2 },
  drop: {
    alignItems: 'center',
    paddingVertical: 18,
    borderRadius: ecRadius.lg,
    borderWidth: 1.6,
    borderStyle: 'dashed',
    borderColor: ec.dashed,
    backgroundColor: ec.mint,
  },
  dropTitle: { fontWeight: '700', color: ec.green, fontSize: 16, marginTop: 4 },
  dropSub: { fontWeight: '400', color: ec.muted, fontSize: 12.5 },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slot: { flex: 1 },
  slotImage: { aspectRatio: 1.25, borderRadius: ecRadius.md },
  slotDim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(255,255,255,0.35)' },
  slotTag: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: ec.white,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  slotTagText: { fontWeight: '600', color: ec.ink, fontSize: 11.5 },
  camBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ec.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: ec.white,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: ec.card,
    borderRadius: ecRadius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: ec.line,
    ...cardShadow,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: ec.mint, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontWeight: '600', color: ec.ink, fontSize: 15 },
  rowSub: { fontWeight: '400', color: ec.muted, fontSize: 12.5, lineHeight: 17 },
  aiRow: { backgroundColor: ec.mint, borderColor: ec.mintBorder },
  aiIcon: { backgroundColor: ec.white, borderRadius: 10, width: 44, height: 44, flexDirection: 'row', gap: 0 },
  aiText: { fontWeight: '700', color: ec.green, fontSize: 10, marginLeft: -2 },
});
