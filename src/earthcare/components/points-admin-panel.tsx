// Vatandaş Puan Yönetimi — the municipality_admin's live points panel.
// Shown as the "Vatandaş Puan Yönetimi" tab of the original Belediye Paneli (/municipality).
// Wide screens (web / tablet): citizen list | editor + audit log. Phones: list -> /points/[userId].
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { useAuth } from '@/providers/auth';

import { markRedemptionUsed } from '../api';
import { ecErrorText } from '../strings';
import { cardShadow, ec, ecRadius, formatPoints } from '../theme';
import { useAdminCitizens, useAuditFeed } from '../use-admin-live';
import { AuditList, CitizenRow, Forbidden, Loading, PointsEditor } from './admin';
import { EcNotice, LiveBadge, PrimaryButton } from './ui';

const WIDE = 900;

function CodeCheck() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await markRedemptionUsed(code);
      setNotice(
        r.status === 'used'
          ? { tone: 'success', text: 'Kod geçerli, ödül kullanıldı olarak işaretlendi.' }
          : { tone: 'danger', text: r.status === 'expired' ? 'Kodun süresi dolmuş.' : 'Bu kod daha önce kullanılmış.' },
      );
      setCode('');
    } catch (e) {
      setNotice({ tone: 'danger', text: ecErrorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Ödül Kodu Doğrula</Text>
      <View style={styles.codeRow}>
        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase().slice(0, 12))}
          placeholder="EC-XXXX-XXXX"
          placeholderTextColor="#9AA79E"
          autoCapitalize="characters"
          style={[styles.codeInput, { flex: 1 }]}
          accessibilityLabel="Ödül kodu"
        />
        <PrimaryButton
          label="Doğrula"
          onPress={() => void run()}
          loading={busy}
          disabled={!/^EC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)}
          style={{ minHeight: 46 }}
        />
      </View>
      {notice ? <EcNotice tone={notice.tone} text={notice.text} /> : null}
    </View>
  );
}

export function PointsAdminPanel() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { access, userId } = useAuth();
  const allowed = !!userId && !!access.is_municipality_admin;
  const wide = width >= WIDE;

  const [search, setSearch] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { citizens, loading, error, flash, setCitizens } = useAdminCitizens(search, allowed);
  // On wide screens the first citizen is pre-selected until the admin picks one.
  const selectedId = pickedId ?? (wide ? (citizens[0]?.id ?? null) : null);
  const feed = useAuditFeed(wide ? selectedId : null, allowed);
  const selected = useMemo(() => citizens.find((c) => c.id === selectedId) ?? null, [citizens, selectedId]);
  const total = citizens.reduce((s, c) => s + c.total_points, 0);

  if (!allowed) return <Forbidden />;

  const list = (
    <View style={{ gap: 8 }}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={ec.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Vatandaş ara (ad veya şehir)"
          placeholderTextColor="#9AA79E"
          style={styles.searchInput}
          accessibilityLabel="Vatandaş ara"
        />
      </View>
      {error ? <EcNotice tone="danger" text={error} /> : null}
      {loading && citizens.length === 0 ? <Loading /> : null}
      {!loading && citizens.length === 0 && !error ? <Text style={styles.muted}>Vatandaş bulunamadı.</Text> : null}
      {citizens.map((c) => (
        <CitizenRow
          key={c.id}
          citizen={c}
          selected={wide && c.id === selectedId}
          flashing={!!flash[c.id]}
          onPress={() =>
            wide ? setPickedId(c.id) : router.push({ pathname: '/points/[userId]', params: { userId: c.id } })
          }
        />
      ))}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <Ionicons name="people" size={22} color={ec.white} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>Vatandaş Puan Yönetimi</Text>
          <Text style={styles.muted}>Değişiklikler vatandaş ekranlarına anında yansır ve kayıt altına alınır.</Text>
        </View>
        <LiveBadge live={feed.live} />
      </View>

      <View style={styles.kpis}>
        <View style={styles.kpi}>
          <Text style={styles.kpiValue}>{citizens.length}</Text>
          <Text style={styles.kpiLabel}>Vatandaş</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiValue}>{formatPoints(total)}</Text>
          <Text style={styles.kpiLabel}>Toplam EcoPuan</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiValue}>{feed.entries.length}</Text>
          <Text style={styles.kpiLabel}>{wide && selected ? 'Kişi işlemi' : 'Son işlem'}</Text>
        </View>
      </View>

      {wide ? (
        <View style={styles.split}>
          <View style={styles.left}>{list}</View>
          <View style={styles.right}>
            {selected ? (
              <PointsEditor
                key={selected.id}
                citizen={selected}
                onApplied={(n) => setCitizens((prev) => prev.map((c) => (c.id === selected.id ? { ...c, total_points: n } : c)))}
              />
            ) : (
              <Text style={styles.muted}>Düzenlemek için bir vatandaş seçin.</Text>
            )}
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>İşlem Kaydı (Audit Log){selected ? ` · ${selected.display_name}` : ''}</Text>
              {feed.error ? <EcNotice tone="danger" text={feed.error} /> : null}
              <AuditList entries={feed.entries} names={feed.names} showTarget={!selected} />
            </View>
            <CodeCheck />
          </View>
        </View>
      ) : (
        <>
          {list}
          <CodeCheck />
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Son İşlemler (Audit Log)</Text>
            {feed.error ? <EcNotice tone="danger" text={feed.error} /> : null}
            <AuditList entries={feed.entries.slice(0, 30)} names={feed.names} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: ec.info, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '700', color: ec.ink, fontSize: 20 },
  muted: { fontWeight: '400', color: ec.muted, fontSize: 12.5 },
  kpis: { flexDirection: 'row', gap: 10 },
  kpi: { flex: 1, backgroundColor: ec.card, borderRadius: ecRadius.md, padding: 12, borderWidth: 1, borderColor: ec.line, ...cardShadow },
  kpiValue: { fontWeight: '700', color: ec.header, fontSize: 20 },
  kpiLabel: { fontWeight: '400', color: ec.muted, fontSize: 11.5 },
  split: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  left: { flex: 1, maxWidth: 460 },
  right: { flex: 1.25, gap: 14 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: ec.card,
    borderRadius: ecRadius.md,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: ec.mintBorder,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontWeight: '400', fontSize: 14, color: ec.ink },
  codeInput: {
    borderWidth: 1,
    borderColor: ec.mintBorder,
    borderRadius: ecRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontWeight: '600',
    fontSize: 15,
    color: ec.ink,
    backgroundColor: ec.white,
    letterSpacing: 1,
  },
  panel: { gap: 10, backgroundColor: ec.card, borderRadius: ecRadius.lg, padding: 14, borderWidth: 1, borderColor: ec.line, ...cardShadow },
  panelTitle: { fontWeight: '700', color: ec.ink, fontSize: 15 },
  codeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
