import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { type StringKey, useI18n } from '@/i18n';
import { setReportCategory, submitIssue, submitReport } from '@/lib/api';
import { ISSUE_GROUPS, type IssueGroup } from '@/lib/categories';
import { errorKey } from '@/lib/errors';
import { type Coords, describePlace, getCurrentCoords, type Place } from '@/lib/geo';
import { type PickedPhoto, pickPhoto, uploadPhoto } from '@/lib/photo';
import type { Severity } from '@/lib/types';
import { useAuth } from '@/providers/auth';
import { Button, Chip, EmptyView, Field, LoadingView, Notice } from '@/ui/components';
import { colors, font, radius, severityColor, spacing } from '@/ui/theme';

type Phase = 'form' | 'working' | 'severity' | 'done';

interface Outcome {
  tone: 'success' | 'info' | 'warning';
  title: string;
  body: string;
  extra: string[];
  reportId: string | null;
  /** true = the user should take another photo */
  retry: boolean;
  duplicate?: boolean;
  /** true = show "report anyway" button */
  canForce?: boolean;
}

const SEVERITIES: { value: Severity; hint: StringKey }[] = [
  { value: 'low', hint: 'new.severityLowHint' },
  { value: 'medium', hint: 'new.severityMediumHint' },
  { value: 'high', hint: 'new.severityHighHint' },
];

export default function NewReportScreen() {
  const { t } = useI18n();
  const { userId, refresh } = useAuth();
  const router = useRouter();

  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [extraPhotos, setExtraPhotos] = useState<PickedPhoto[]>([]);
  // Once uploaded, the same file is reused if the user has to answer the severity question.
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [extraPhotoPaths, setExtraPhotoPaths] = useState<string[]>([]);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [locating, setLocating] = useState(true);
  const [note, setNote] = useState('');
  const [group, setGroup] = useState<IssueGroup>('environment');
  const [issueType, setIssueType] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const locate = useCallback(async () => {
    setLocating(true);
    const found = await getCurrentCoords();
    setCoords(found);
    setLocating(false);
    if (found) setPlace(await describePlace(found));
  }, []);

  useEffect(() => {
    if (userId) void locate();
  }, [userId, locate]);

  const choose = async (source: 'camera' | 'gallery') => {
    setError(null);
    try {
      const picked = await pickPhoto(source);
      if (picked) {
        setPhoto(picked);
        setPhotoPath(null);
      }
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };

  const chooseExtra = async (source: 'camera' | 'gallery', index: number) => {
    setError(null);
    try {
      const picked = await pickPhoto(source);
      if (picked) {
        setExtraPhotos((prev) => {
          const next = [...prev];
          next[index] = picked;
          return next;
        });
        // Reset uploaded paths so they get re-uploaded
        setExtraPhotoPaths([]);
      }
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };

  const removeExtra = (index: number) => {
    setExtraPhotos((prev) => prev.filter((_, i) => i !== index));
    setExtraPhotoPaths([]);
  };

  const send = async (userSeverity: Severity | null, force = false) => {
    if (!userId || !photo) return;
    if (!coords) {
      setError(t('new.locationMissing'));
      return;
    }
    setError(null);
    setPhase('working');
    let path = photoPath;
    try {
      if (!path) {
        setStep(t('new.uploading'));
        path = await uploadPhoto(photo, 'report-photos', userId);
        setPhotoPath(path);
      }
      // Upload extra photos if not yet uploaded
      let extraPaths = extraPhotoPaths;
      if (extraPhotos.length > 0 && extraPaths.length === 0) {
        setStep(t('new.uploading'));
        extraPaths = await Promise.all(
          extraPhotos.map((p) => uploadPhoto(p, 'report-photos', userId))
        );
        setExtraPhotoPaths(extraPaths);
      }

      setStep(t('new.analyzing'));
      const base = {
        photoPath: path,
        extraPhotoPaths: extraPaths,
        latitude: coords.latitude,
        longitude: coords.longitude,
        address: place?.address ?? null,
        city: place?.city ?? null,
        country: place?.country ?? null,
        description: note.trim() || null,
        userSeverity,
        force,
      };
      // Pollution goes through the AI check; roads, parks and storm damage are recorded directly.
      const result =
        group === 'environment'
          ? await submitReport(base)
          : await submitIssue({ ...base, issueGroup: group, issueType });

      const reportId = result.report_id ?? null;
      if (reportId && group === 'environment' && issueType && (result.status === 'created' || result.status === 'pending_review')) {
        await setReportCategory(reportId, group, issueType).catch(() => {});
      }
      switch (result.status) {
        case 'created': {
          const extra: string[] = [];
          if (result.ai_available === false) extra.push(t('new.createdNoAi'));
          if (result.hazardous) extra.push(t('new.hazard'));
          setOutcome({
            tone: 'success',
            title: t('new.createdTitle'),
            body: t('new.createdBody', { n: result.points ?? 0 }),
            extra,
            reportId,
            retry: false,
          });
          setPhase('done');
          void refresh();
          break;
        }
        case 'pending_review':
          setOutcome({ tone: 'info', title: t('new.reviewTitle'), body: t('new.reviewBody'), extra: [], reportId, retry: false });
          setPhase('done');
          break;
        case 'needs_severity':
          setPhase('severity');
          break;
        case 'not_pollution':
        case 'unclear':
          setOutcome({
            tone: 'warning',
            title: t(result.status === 'unclear' ? 'new.unclearTitle' : 'new.notPollutionTitle'),
            body: t(result.status === 'unclear' ? 'new.unclearBody' : 'new.notPollutionBody'),
            extra: [],
            reportId: null,
            retry: true,
          });
          setPhase('done');
          break;
        case 'duplicate':
          setOutcome({ tone: 'info', title: t('new.duplicateTitle'), body: t('new.duplicateBody'), extra: [], reportId, retry: false, duplicate: true, canForce: true });
          setPhase('done');
          break;
        default:
          // The server removed the uploaded file, so the next try uploads again.
          setPhotoPath(null);
          setError(t(errorKey(result.status)));
          setPhase('form');
      }
    } catch (e) {
      setError(t(errorKey(e)));
      setPhase('form');
    }
  };

  const startOver = () => {
    setPhoto(null);
    setPhotoPath(null);
    setExtraPhotos([]);
    setExtraPhotoPaths([]);
    setOutcome(null);
    setError(null);
    setPhase('form');
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/map');
  };

  if (!userId) {
    return (
      <EmptyView
        icon="camera-outline"
        text={t('new.signInFirst')}
        action={<Button label={t('common.signIn')} onPress={() => router.replace('/auth/sign-in')} />}
      />
    );
  }

  if (phase === 'working') return <LoadingView label={step} />;

  if (phase === 'done' && outcome) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.outcome}>
          <Ionicons
            name={outcome.tone === 'success' ? 'checkmark-circle' : outcome.tone === 'warning' ? 'alert-circle' : 'information-circle'}
            size={64}
            color={outcome.tone === 'success' ? colors.primary : outcome.tone === 'warning' ? colors.warning : colors.info}
          />
          <Text style={styles.outcomeTitle}>{outcome.title}</Text>
          <Text style={styles.outcomeBody}>{outcome.body}</Text>
        </View>
        {outcome.extra.map((text) => (
          <Notice key={text} tone="warning" text={text} />
        ))}
        {outcome.reportId ? (
          <Button
            label={t(outcome.duplicate ? 'new.openExisting' : 'new.viewReport')}
            onPress={() => router.replace({ pathname: '/report/[id]', params: { id: outcome.reportId as string } })}
          />
        ) : null}
        {outcome.canForce ? (
          <Button
            label={t('new.reportAnyway')}
            variant="secondary"
            icon="send"
            onPress={() => { setOutcome(null); setPhase('form'); void send(null, true); }}
          />
        ) : null}
        {outcome.retry ? <Button label={t('new.retake')} icon="camera" onPress={startOver} /> : null}
        <Button label={t('new.backToMap')} variant="secondary" onPress={close} />
      </ScrollView>
    );
  }

  if (phase === 'severity') {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('new.severityTitle')}</Text>
        <Notice tone="info" text={t('new.severityBody')} />
        {SEVERITIES.map(({ value, hint }) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            onPress={() => void send(value)}
            style={({ pressed }) => [styles.severity, { borderColor: severityColor[value] }, pressed && styles.pressed]}>
            <View style={[styles.dot, { backgroundColor: severityColor[value] }]} />
            <View style={styles.severityBody}>
              <Text style={styles.severityLabel}>{t(`severity.${value}`)}</Text>
              <Text style={styles.muted}>{t(hint)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>
        ))}
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setPhase('form')} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error ? <Notice tone="danger" text={error} /> : null}

      {photo ? (
        <>
          <Image source={{ uri: photo.uri }} style={styles.preview} contentFit="cover" />
          <Button label={t('new.retake')} variant="secondary" icon="camera-reverse" onPress={() => void choose('camera')} />
          {/* Optional extra photos */}
          <View style={styles.extraPhotos}>
            {[0, 1].map((index) => {
              const extra = extraPhotos[index];
              return extra ? (
                <View key={index} style={styles.extraSlot}>
                  <Image source={{ uri: extra.uri }} style={styles.extraPreview} contentFit="cover" />
                  <Pressable style={styles.removeBtn} onPress={() => removeExtra(index)} accessibilityRole="button">
                    <Ionicons name="close-circle" size={22} color={colors.danger} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  key={index}
                  style={styles.extraAdd}
                  onPress={() => void chooseExtra('camera', index)}
                  accessibilityRole="button">
                  <Ionicons name="camera-outline" size={24} color={colors.textMuted} />
                  <Text style={styles.extraAddLabel}>{t('new.addPhoto')}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : (
        <>
          <Text style={styles.intro}>{t('new.intro')}</Text>
          <Button label={t('new.camera')} icon="camera" onPress={() => void choose('camera')} />
        </>
      )}
      <Button label={t('new.gallery')} variant="ghost" icon="images" onPress={() => void choose('gallery')} />

      <View style={styles.location}>
        {locating ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Ionicons name={coords ? 'location' : 'location-outline'} size={20} color={coords ? colors.primary : colors.danger} />
        )}
        <Text style={styles.locationText}>
          {locating
            ? t('new.locating')
            : coords
              ? [t('new.locationReady'), place?.address ?? place?.city].filter(Boolean).join(': ')
              : t('new.locationMissing')}
        </Text>
        {!locating && !coords ? <Button label={t('common.retry')} variant="secondary" onPress={() => void locate()} /> : null}
      </View>

      <Text style={styles.label}>{t('new.category')}</Text>
      <View style={styles.chips}>
        {ISSUE_GROUPS.map((g) => (
          <Chip
            key={g.group}
            label={t(`group.${g.group}`)}
            selected={group === g.group}
            onPress={() => {
              setGroup(g.group);
              setIssueType(null);
            }}
          />
        ))}
      </View>
      <Text style={styles.label}>{t('new.subtype')}</Text>
      <View style={styles.chips}>
        {ISSUE_GROUPS.find((g) => g.group === group)?.types.map((type) => (
          <Chip
            key={type}
            label={t(`issue.${type}` as StringKey)}
            selected={issueType === type}
            onPress={() => setIssueType(issueType === type ? null : type)}
          />
        ))}
      </View>
      {group === 'disaster' || issueType === 'hazardous_waste' ? (
        <Notice tone="danger" icon="call" text={t('new.emergency')} />
      ) : null}

      <Field
        label={t('new.note')}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
        style={styles.note}
      />

      <Button label={t('new.submit')} icon="send" onPress={() => void send(null)} disabled={!photo || !coords} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  title: { fontSize: font.title, fontWeight: '700', color: colors.text },
  intro: { fontSize: font.body, color: colors.textMuted, lineHeight: 22 },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: colors.surface },
  location: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  locationText: { flex: 1, fontSize: font.body, color: colors.text },
  note: { minHeight: 80, textAlignVertical: 'top' },
  outcome: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  outcomeTitle: { fontSize: font.title, fontWeight: '700', color: colors.text, textAlign: 'center' },
  outcomeBody: { fontSize: font.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  severity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 2,
    backgroundColor: colors.background,
    minHeight: 72,
  },
  severityBody: { flex: 1, gap: 2 },
  severityLabel: { fontSize: font.large, fontWeight: '700', color: colors.text },
  dot: { width: 20, height: 20, borderRadius: 10 },
  muted: { fontSize: font.small, color: colors.textMuted },
  pressed: { opacity: 0.8 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  extraPhotos: { flexDirection: 'row', gap: spacing.sm },
  extraSlot: { flex: 1, position: 'relative' },
  extraPreview: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface },
  removeBtn: { position: 'absolute', top: -8, right: -8, backgroundColor: colors.background, borderRadius: 11 },
  extraAdd: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  extraAddLabel: { fontSize: font.small, color: colors.textMuted },
});
