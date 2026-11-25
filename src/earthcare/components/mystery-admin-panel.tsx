// Belediye Paneli › Gizli Hazine: open a 2x / bonus EcoPuan zone for a limited time, see active and
// past zones, end one early. Every action is checked again by the database (403 for non-admins).
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getCurrentCoords, type Coords } from '@/lib/geo';
import { supabase } from '@/lib/supabase';
import PollutionMap from '@/map/PollutionMap';
import type { MapFocus, MapZone } from '@/map/types';
import { useAuth } from '@/providers/auth';
import { confirm } from '@/ui/components';

import { dropEnd, dropLabel, formatRemaining, isDropActive, useDrops } from '../mystery';
import { ecErrorText } from '../strings';
import { cardShadow, ec, ecRadius } from '../theme';
import { Forbidden } from './admin';
import { EcNotice, LiveBadge, PrimaryButton } from './ui';

const RADII = [100, 250, 500, 1000, 2000];
const MULTIPLIERS = [1.5, 2, 3];
const BONUSES = [20, 50, 100];
const HOURS = [6, 12, 24, 48];
// Marmaris pilot area centre (first view of the picker map).
const START: Coords = { latitude: 36.851, longitude: 28.274 };

function Chips<T extends string | number>({
  values,
  value,
  onChange,
  label,
}: {
  values: T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => string;
}) {
  return (
    <View style={styles.chips}>
      {values.map((v) => (
        <Pressable
          key={String(v)}
          accessibilityRole="button"
          accessibilityState={{ selected: v === value }}
          onPress={() => onChange(v)}
          style={[styles.chip, v === value && styles.chipOn]}>
          <Text style={[styles.chipText, v === value && styles.chipTextOn]}>{label(v)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function MysteryAdminPanel() {
  const { access, userId } = useAuth();
  const allowed = !!userId && !!access.is_municipality_admin;
  const { drops, now, error: listError } = useDrops(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [point, setPoint] = useState<Coords | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>({ ...START, key: 1 });
  const [radius, setRadius] = useState(500);
  const [mode, setMode] = useState<'multiplier' | 'bonus'>('multiplier');
  const [multiplier, setMultiplier] = useState(2);
  const [bonus, setBonus] = useState(50);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);

  const preview = useMemo<MapZone[]>(() => {
    const zones: MapZone[] = drops
      .filter((d) => isDropActive(d, now))
      .map((d) => ({ id: d.id, latitude: d.latitude, longitude: d.longitude, radius: d.radius_m, label: dropLabel(d), title: d.title }));
    if (point) {
      const label = mode === 'multiplier' ? dropLabel({ reward_mode: 'multiplier', multiplier, bonus_points: null }) : `+${bonus}`;
      zones.push({ id: 'new', ...point, radius, label, title: 'Yeni bölge' });
    }
    return zones;
  }, [drops, now, point, radius, mode, multiplier, bonus]);

  if (!allowed) return <Forbidden />;

  const takeMyLocation = async () => {
    const c = await getCurrentCoords();
    if (!c) return setNotice({ tone: 'danger', text: 'Konum alınamadı. Konum iznini kontrol edin veya haritaya dokunun.' });
    setPoint(c);
    setFocus({ ...c, zoomedIn: true, key: Date.now() });
  };

  const start = async () => {
    if (!point) return setNotice({ tone: 'danger', text: 'Haritaya dokunarak bölgenin merkezini seçin.' });
    if (title.trim().length < 3) return setNotice({ tone: 'danger', text: 'Başlık en az 3 karakter olmalı.' });
    setBusy(true);
    setNotice(null);
    const { data, error } = await supabase.rpc('muni_create_mystery_drop', {
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_latitude: point.latitude,
      p_longitude: point.longitude,
      p_radius_m: radius,
      p_reward_mode: mode,
      p_value: mode === 'multiplier' ? multiplier : bonus,
      p_duration_hours: hours,
    });
    setBusy(false);
    if (error) return setNotice({ tone: 'danger', text: ecErrorText({ message: error.message, sqlState: error.code }) });
    const res = data as { label: string; notified: number };
    setNotice({
      tone: 'success',
      text: `${res.label} Gizli Hazine bölgesi ${hours} saatliğine açıldı. ${res.notified} vatandaşa uygulama içi bildirim gönderildi; yakındaki telefonlara anlık bildirim gider.`,
    });
    setTitle('');
    setDescription('');
    setPoint(null);
  };

  const endEarly = async (id: string, name: string) => {
    const ok = await confirm(`"${name}" bölgesi şimdi sonlandırılsın mı? Bundan sonraki katkılar bonus almaz.`, 'Sonlandır', 'Vazgeç');
    if (!ok) return;
    const { error } = await supabase.rpc('muni_end_mystery_drop', { p_drop_id: id });
    setNotice(error ? { tone: 'danger', text: ecErrorText({ message: error.message, sqlState: error.code }) } : { tone: 'info', text: 'Bölge sonlandırıldı.' });
  };

  const active = drops.filter((d) => isDropActive(d, now));
  const past = drops.filter((d) => !isDropActive(d, now)).slice(0, 20);

  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <Ionicons name="star" size={20} color={ec.white} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>Gizli Hazine / 2x Bölge Oluştur</Text>
          <Text style={styles.muted}>Bölge içinde yapılan ve onaylanan katkılar seçtiğiniz bonusu otomatik alır.</Text>
        </View>
        <LiveBadge live />
      </View>

      <View style={styles.panel}>
        <Text style={styles.label}>Bölgenin merkezi — haritaya dokunun</Text>
        <View style={styles.map}>
          <PollutionMap
            markers={[]}
            focus={focus}
            showsUserLocation={false}
            userLocation={null}
            onMarkerPress={() => {}}
            onMapPress={(c) => setPoint(c)}
            zones={preview}
          />
        </View>
        <View style={styles.row}>
          <Text style={[styles.muted, styles.flex]}>
            {point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : 'Henüz konum seçilmedi'}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void takeMyLocation()} style={styles.linkBtn}>
            <Ionicons name="locate" size={16} color={ec.green} />
            <Text style={styles.link}>Konumumu kullan</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Yarıçap</Text>
        <Chips values={RADII} value={radius} onChange={setRadius} label={(v) => (v >= 1000 ? `${v / 1000} km` : `${v} m`)} />

        <Text style={styles.label}>Ödül</Text>
        <Chips<'multiplier' | 'bonus'>
          values={['multiplier', 'bonus']}
          value={mode}
          onChange={setMode}
          label={(v) => (v === 'multiplier' ? 'Puan çarpanı' : 'Sabit bonus')}
        />
        {mode === 'multiplier' ? (
          <Chips values={MULTIPLIERS} value={multiplier} onChange={setMultiplier} label={(v) => `${String(v).replace('.', ',')}x EcoPuan`} />
        ) : (
          <Chips values={BONUSES} value={bonus} onChange={setBonus} label={(v) => `+${v} EC`} />
        )}

        <Text style={styles.label}>Geçerlilik süresi</Text>
        <Chips values={HOURS} value={hours} onChange={setHours} label={(v) => `${v} saat`} />

        <Text style={styles.label}>Başlık</Text>
        <TextInput
          value={title}
          onChangeText={(v) => setTitle(v.slice(0, 80))}
          placeholder="Örn. Kordon Sahil Temizliği"
          placeholderTextColor="#9CA3AF"
          style={styles.input}
          accessibilityLabel="Başlık"
        />
        <Text style={styles.label}>Açıklama (isteğe bağlı)</Text>
        <TextInput
          value={description}
          onChangeText={(v) => setDescription(v.slice(0, 300))}
          placeholder="Vatandaşlara kısa bir not"
          placeholderTextColor="#9CA3AF"
          style={[styles.input, { minHeight: 64 }]}
          multiline
          accessibilityLabel="Açıklama"
        />

        {notice ? <EcNotice tone={notice.tone} text={notice.text} /> : null}
        <PrimaryButton label="Gizli Hazineyi Başlat" icon="star" onPress={() => void start()} loading={busy} disabled={!point} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Aktif bölgeler ({active.length})</Text>
        {listError ? <EcNotice tone="danger" text={ecErrorText({ message: listError })} /> : null}
        {active.length === 0 ? <Text style={styles.muted}>Şu an aktif Gizli Hazine bölgesi yok.</Text> : null}
        {active.map((d) => (
          <View key={d.id} style={styles.item}>
            <View style={[styles.badge, { backgroundColor: '#F59E0B' }]}>
              <Text style={styles.badgeText}>{dropLabel(d)}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.itemTitle}>{d.title}</Text>
              <Text style={styles.muted}>
                Kalan süre: {formatRemaining(dropEnd(d) - now)} · {d.radius_m >= 1000 ? `${d.radius_m / 1000} km` : `${d.radius_m} m`}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => void endEarly(d.id, d.title)} style={styles.endBtn}>
              <Text style={styles.endText}>Erken Sonlandır</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Süresi dolan / sonlandırılan</Text>
        {past.length === 0 ? <Text style={styles.muted}>Kayıt yok.</Text> : null}
        {past.map((d) => (
          <View key={d.id} style={[styles.item, { opacity: 0.7 }]}>
            <View style={[styles.badge, { backgroundColor: '#9CA3AF' }]}>
              <Text style={styles.badgeText}>{dropLabel(d)}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.itemTitle}>{d.title}</Text>
              <Text style={styles.muted}>
                {d.ended_early_at ? 'Erken sonlandırıldı' : 'Süresi doldu'} ·{' '}
                {new Date(d.ended_early_at ?? d.ends_at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '700', color: ec.ink, fontSize: 18 },
  muted: { color: ec.muted, fontSize: 12.5 },
  panel: { gap: 10, backgroundColor: ec.card, borderRadius: ecRadius.lg, padding: 14, borderWidth: 1, borderColor: ec.line, ...cardShadow },
  panelTitle: { fontWeight: '700', color: ec.ink, fontSize: 15 },
  label: { fontWeight: '600', color: ec.text, fontSize: 13, marginTop: 2 },
  map: { height: 260, borderRadius: ecRadius.md, overflow: 'hidden', backgroundColor: ec.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  link: { color: ec.green, fontWeight: '600', fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: ec.mintBorder, backgroundColor: ec.white },
  chipOn: { backgroundColor: ec.green, borderColor: ec.green },
  chipText: { fontWeight: '500', color: ec.text, fontSize: 12.5 },
  chipTextOn: { color: ec.white },
  input: {
    borderWidth: 1,
    borderColor: ec.mintBorder,
    borderRadius: ecRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: ec.ink,
    backgroundColor: '#FBFDFB',
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  badge: { minWidth: 54, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  badgeText: { color: ec.white, fontWeight: '800', fontSize: 13 },
  itemTitle: { fontWeight: '600', color: ec.ink, fontSize: 14 },
  endBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: ec.danger },
  endText: { color: ec.danger, fontWeight: '600', fontSize: 12 },
});
