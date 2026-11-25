import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateTime, useI18n } from '@/i18n';
import {
  fetchMessages,
  fetchParticipants,
  fetchReport,
  fetchRoomId,
  flagReport,
  hasSupported,
  joinCleanup,
  leaveCleanup,
  sendMessage,
  submitCleanup,
  supportReport,
} from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { getCurrentCoords } from '@/lib/geo';
import { pickPhoto, uploadPhoto } from '@/lib/photo';
import { publicPhotoUrl, supabase } from '@/lib/supabase';
import type { ChatMessage, Participant, Report } from '@/lib/types';
import { MuniSection } from '@/municipal/MuniSection';
import { useAuth } from '@/providers/auth';
import { Button, EmptyView, LoadingView, Notice, SectionTitle, SeverityBadge, StatusBadge, confirm } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

type Tone = 'info' | 'success' | 'warning' | 'danger';

export default function ReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useI18n();
  const { userId, access, refresh } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const [report, setReport] = useState<Report | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'join' | 'cleanup' | 'send' | null>(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);
  const [supported, setSupported] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([fetchReport(id), fetchParticipants(id).catch(() => [] as Participant[])]);
      setReport(r);
      setParticipants(p);
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  const loadMessages = useCallback(async (room: string) => {
    try {
      setMessages(await fetchMessages(room));
    } catch {
      // keep what is already on screen
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    void hasSupported(id, userId).then(setSupported).catch(() => {});
  }, [id, userId]);

  // The chat is for signed-in users only.
  useEffect(() => {
    if (!userId) {
      setRoomId(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const room = await fetchRoomId(id);
        if (cancelled) return;
        setRoomId(room);
        if (room) await loadMessages(room);
      } catch {
        // chat stays hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, userId, loadMessages, report?.report_status]);

  // Live updates for this report: status, volunteers and chat.
  useEffect(() => {
    let channel = supabase
      .channel(`report-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pollution_reports', filter: `id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cleanup_participants', filter: `report_id=eq.${id}` }, () => void load());
    if (roomId) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        () => void loadMessages(roomId),
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, roomId, load, loadMessages]);

  if (loading) return <LoadingView label={t('common.loading')} />;
  if (!report) return <EmptyView icon="help-circle-outline" text={t('detail.notFound')} />;

  const open = report.report_status === 'active' || report.report_status === 'cleanup_in_progress';
  const joined = !!userId && participants.some((p) => p.user_id === userId);
  const canVolunteer = open && !report.is_hazardous;

  const requireSignIn = (): boolean => {
    if (userId) return true;
    router.push('/auth/sign-in');
    return false;
  };

  const toggleJoin = async () => {
    if (!requireSignIn()) return;
    if (!joined && !access.roles.includes('activist')) {
      setNotice({ tone: 'warning', text: t('err.activistRole') });
      return;
    }
    setBusy('join');
    setNotice(null);
    try {
      if (joined) await leaveCleanup(report.id);
      else await joinCleanup(report.id);
      await load();
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    } finally {
      setBusy(null);
    }
  };

  const sendCleanup = async () => {
    if (!requireSignIn() || !userId) return;
    setNotice(null);
    try {
      // The after-photo must be fresh, so the camera is used (the browser only has a file picker).
      const photo = await pickPhoto(Platform.OS === 'web' ? 'gallery' : 'camera');
      if (!photo) return;
      setBusy('cleanup');
      setBusyLabel(t('new.locating'));
      const coords = await getCurrentCoords();
      if (!coords) {
        setNotice({ tone: 'danger', text: t('err.locationRequired') });
        return;
      }
      setBusyLabel(t('new.uploading'));
      const path = await uploadPhoto(photo, 'cleanup-photos', userId);
      setBusyLabel(t('detail.verifying'));
      const result = await submitCleanup({
        reportId: report.id,
        photoPath: path,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      if (result.status === 'approved') {
        setNotice({ tone: 'success', text: t('detail.cleanupApproved', { n: result.points ?? 0 }) });
      } else if (result.status === 'manual_review') {
        setNotice({ tone: 'info', text: t('detail.cleanupReview') });
      } else if (result.status === 'rejected') {
        setNotice({ tone: 'warning', text: t('detail.cleanupRejected') });
      } else {
        setNotice({ tone: 'danger', text: t(errorKey(result.status)) });
      }
      await Promise.all([load(), refresh()]);
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    } finally {
      setBusy(null);
      setBusyLabel('');
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !roomId || !userId) return;
    setBusy('send');
    try {
      await sendMessage(roomId, userId, body);
      setDraft('');
      await loadMessages(roomId);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    } finally {
      setBusy(null);
    }
  };

  const support = async () => {
    if (!requireSignIn()) return;
    setNotice(null);
    try {
      await supportReport(report.id);
      setSupported(true);
      await load();
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    }
  };

  const flag = async () => {
    if (!requireSignIn() || !userId) return;
    if (!(await confirm(t('detail.flagConfirm'), t('common.ok'), t('common.cancel')))) return;
    try {
      await flagReport(report.id, userId);
      setNotice({ tone: 'success', text: t('detail.flagged') });
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'web' ? undefined : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}>
      <ScrollView ref={scroll} style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.photos}>
          <View style={styles.photoBox}>
            {report.cleaned_photo_path ? <Text style={styles.photoLabel}>{t('detail.before')}</Text> : null}
            <Image
              source={{ uri: publicPhotoUrl('report-photos', report.photo_path) }}
              style={report.cleaned_photo_path ? styles.photoHalf : styles.photoFull}
              contentFit="cover"
              transition={150}
            />
          </View>
          {report.cleaned_photo_path ? (
            <View style={styles.photoBox}>
              <Text style={styles.photoLabel}>{t('detail.after')}</Text>
              <Image
                source={{ uri: publicPhotoUrl('cleanup-photos', report.cleaned_photo_path) }}
                style={styles.photoHalf}
                contentFit="cover"
                transition={150}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.badges}>
          <SeverityBadge severity={report.severity} t={t} />
          <StatusBadge status={report.report_status} t={t} />
        </View>
        <Text style={styles.title}>
          {report.issue_type ? t(`issue.${report.issue_type}` as never) : t(`category.${report.ai_category ?? 'unknown'}`)}
        </Text>
        <Text style={styles.muted}>
          {[t(`group.${report.issue_group}`), report.public_code ? t('detail.code', { c: report.public_code }) : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text style={styles.muted}>
          {[report.address ?? report.city, formatDateTime(report.created_at, language)].filter(Boolean).join(' · ')}
        </Text>
        <Text style={styles.muted}>
          {t('detail.reportedBy', { name: report.reporter?.display_name ?? t('common.deletedUser') })}
        </Text>
        {report.description ? <Text style={styles.body}>{report.description}</Text> : null}
        {report.report_status !== 'rejected' && report.report_status !== 'cleaned' && report.reporter_id !== userId ? (
          <Button
            label={t(supported ? 'detail.supported' : 'detail.support', { n: report.supports_count })}
            icon={supported ? 'checkmark-circle' : 'eye'}
            variant="secondary"
            disabled={supported}
            onPress={() => void support()}
          />
        ) : report.supports_count > 0 ? (
          <Text style={styles.muted}>{t('detail.support', { n: report.supports_count })}</Text>
        ) : null}

        {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}
        {report.is_hazardous ? <Notice tone="danger" icon="skull" text={t('detail.hazard')} /> : null}
        {report.report_status === 'pending_review' ? <Notice tone="warning" text={t('detail.pendingReview')} /> : null}
        {report.report_status === 'pending_verification' ? <Notice tone="info" text={t('detail.awaitingVerification')} /> : null}
        {report.ai_analysis_status === 'unavailable' ? (
          <Notice tone="info" text={t('detail.aiPending')} />
        ) : report.ai_summary ? (
          <Notice tone="info" icon="sparkles" text={`${t('detail.aiNote')}: ${report.ai_summary}`} />
        ) : null}

        <MuniSection report={report} onChanged={load} />

        {open || participants.length > 0 ? (
          <>
            <SectionTitle>{t('detail.volunteers', { n: participants.length })}</SectionTitle>
            {participants.length === 0 ? (
              <Text style={styles.muted}>{t('detail.noVolunteers')}</Text>
            ) : (
              <View style={styles.people}>
                {participants.map((p) => (
                  <View key={p.user_id} style={styles.person}>
                    <Ionicons name="person" size={14} color={colors.primaryDark} />
                    <Text style={styles.personName}>{p.profile?.display_name ?? t('common.deletedUser')}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : null}

        {canVolunteer ? (
          <>
            {joined ? (
              <>
                <Text style={styles.muted}>{t('detail.cleanupHint')}</Text>
                <Button
                  label={busy === 'cleanup' ? busyLabel : t('detail.submitCleanup')}
                  icon="camera"
                  loading={busy === 'cleanup'}
                  disabled={busy !== null}
                  onPress={() => void sendCleanup()}
                />
              </>
            ) : null}
            <Button
              label={t(joined ? 'detail.leave' : 'detail.join')}
              icon={joined ? 'exit-outline' : 'hand-left'}
              variant={joined ? 'secondary' : 'primary'}
              loading={busy === 'join'}
              disabled={busy !== null}
              onPress={() => void toggleJoin()}
            />
          </>
        ) : null}

        <SectionTitle>{t('detail.chat')}</SectionTitle>
        {!userId ? (
          <Button label={t('detail.chatSignIn')} variant="secondary" onPress={() => router.push('/auth/sign-in')} />
        ) : messages.length === 0 ? (
          <Text style={styles.muted}>{t('detail.chatEmpty')}</Text>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === userId;
            return (
              <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                {!mine ? <Text style={styles.sender}>{m.sender?.display_name ?? t('common.deletedUser')}</Text> : null}
                <Text style={styles.body}>{m.body}</Text>
                <Text style={styles.time}>{formatDateTime(m.created_at, language)}</Text>
              </View>
            );
          })
        )}

        <Pressable accessibilityRole="button" onPress={() => void flag()} style={styles.flag}>
          <Ionicons name="flag-outline" size={16} color={colors.textMuted} />
          <Text style={styles.muted}>{t('detail.flag')}</Text>
        </Pressable>
      </ScrollView>

      {userId && roomId ? (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('detail.chatPlaceholder')}
            placeholderTextColor={colors.textMuted}
            maxLength={500}
            multiline
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('detail.send')}
            disabled={busy === 'send' || draft.trim().length === 0}
            onPress={() => void send()}
            style={({ pressed }) => [styles.sendButton, (pressed || draft.trim().length === 0) && styles.dim]}>
            <Ionicons name="send" size={20} color={colors.textOnPrimary} />
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  photos: { flexDirection: 'row', gap: spacing.sm },
  photoBox: { flex: 1, gap: spacing.xs },
  photoLabel: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  photoFull: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: colors.surface },
  photoHalf: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, backgroundColor: colors.surface },
  badges: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  title: { fontSize: font.title, fontWeight: '700', color: colors.text },
  muted: { fontSize: font.small, color: colors.textMuted, lineHeight: 18 },
  body: { fontSize: font.body, color: colors.text, lineHeight: 21 },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  personName: { fontSize: font.small, fontWeight: '600', color: colors.primaryDark },
  bubble: { maxWidth: '85%', padding: spacing.md, borderRadius: radius.lg, gap: 2 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.primarySoft },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  sender: { fontSize: font.small, fontWeight: '700', color: colors.primaryDark },
  time: { fontSize: 11, color: colors.textMuted, alignSelf: 'flex-end' },
  flag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, alignSelf: 'flex-start' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    fontSize: font.body,
    color: colors.text,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.5 },
});
