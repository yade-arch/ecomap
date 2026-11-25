// Belediye Paneli › Vatandaş Puan Yönetimi, phone layout: one citizen's points editor + their audit log (live).
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuditList, Forbidden, Loading, PointsEditor } from '@/earthcare/components/admin';
import { EcNotice, LiveBadge } from '@/earthcare/components/ui';
import { cardShadow, ec, ecRadius } from '@/earthcare/theme';
import { useAdminCitizens, useAuditFeed } from '@/earthcare/use-admin-live';
import { useAuth } from '@/providers/auth';

export default function AdminCitizenScreen() {
  const { userId: targetId } = useLocalSearchParams<{ userId: string }>();
  const { access, userId } = useAuth();
  const allowed = !!userId && !!access.is_municipality_admin;
  const { citizens, loading, error, setCitizens } = useAdminCitizens('', allowed);
  const feed = useAuditFeed(targetId ?? null, allowed);
  const citizen = useMemo(() => citizens.find((c) => c.id === targetId) ?? null, [citizens, targetId]);

  return (
    <View style={styles.flex}>
      {!allowed ? (
        <Forbidden />
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {error ? <EcNotice tone="danger" text={error} /> : null}
          {loading && !citizen ? <Loading /> : null}
          {!loading && !citizen && !error ? <EcNotice tone="danger" text="Vatandaş bulunamadı." /> : null}
          {citizen ? (
            <PointsEditor
              citizen={citizen}
              onApplied={(n) => setCitizens((prev) => prev.map((c) => (c.id === citizen.id ? { ...c, total_points: n } : c)))}
            />
          ) : null}
          <View style={styles.panel}>
            <View style={styles.panelHead}>
              <Text style={styles.panelTitle}>İşlem Kaydı (Audit Log)</Text>
              <LiveBadge live={feed.live} />
            </View>
            {feed.error ? <EcNotice tone="danger" text={feed.error} /> : null}
            <AuditList entries={feed.entries} names={feed.names} showTarget={false} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: ec.bg },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 16, paddingBottom: 60, gap: 14 },
  panel: { gap: 10, backgroundColor: ec.card, borderRadius: ecRadius.lg, padding: 14, borderWidth: 1, borderColor: ec.line, ...cardShadow },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: { fontWeight: '700', color: ec.ink, fontSize: 15 },
});
