// For municipal staff: where and when each photo of a report was really taken
// (GPS at capture + server timestamp from public.photo_captures), and how far that is from the report.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatDateTime, type StringKey, useI18n } from '@/i18n';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { type CaptureInfo, fetchCaptures } from '@/lib/photo';
import type { Report } from '@/lib/types';
import { colors, font, radius, spacing } from '@/ui/theme';

export function CaptureProof({ report }: { report: Report }) {
  const { t, language } = useI18n();
  const [captures, setCaptures] = useState<Record<string, CaptureInfo> | null>(null);
  const photos: { label: StringKey; path: string | null }[] = [
    { label: 'staff.captureReport', path: report.photo_path },
    { label: 'staff.captureResolution', path: report.resolution_photo_path },
  ];
  const paths = photos.map((p) => p.path).filter((p): p is string => !!p);
  const key = paths.join('|');

  useEffect(() => {
    let active = true;
    fetchCaptures(key.split('|')).then((rows) => active && setCaptures(rows));
    return () => {
      active = false;
    };
  }, [key]);

  if (!captures) return null;
  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.primaryDark} />
        <Text style={styles.title}>{t('staff.captureTitle')}</Text>
      </View>
      {photos
        .filter((p) => p.path)
        .map((p) => {
          const c = captures[p.path as string];
          const hasGps = c && c.latitude != null && c.longitude != null;
          const away = hasGps
            ? distanceMeters(
                { latitude: c.latitude as number, longitude: c.longitude as number },
                { latitude: report.latitude, longitude: report.longitude },
              )
            : null;
          return (
            <View key={p.path} style={styles.item}>
              <Text style={styles.label}>{t(p.label)}</Text>
              {!c ? (
                <Text style={[styles.text, styles.warn]}>{t('staff.captureMissing')}</Text>
              ) : (
                <>
                  <Text style={[styles.text, away != null && away > 300 && styles.warn]}>
                    {hasGps
                      ? t('staff.captureWhere', {
                          p: `${(c.latitude as number).toFixed(5)}, ${(c.longitude as number).toFixed(5)}${c.accuracy_m != null ? ` (±${Math.round(c.accuracy_m)} m)` : ''}`,
                          d: formatDistance(away as number),
                        })
                      : t('staff.captureNoGps')}
                  </Text>
                  <Text style={styles.text}>{t('staff.captureServerTime', { t: formatDateTime(c.server_recorded_at, language) })}</Text>
                </>
              )}
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: font.small, fontWeight: '700', color: colors.primaryDark },
  item: { gap: 1 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.text },
  text: { fontSize: font.small, color: colors.textMuted },
  warn: { color: colors.warning },
});
