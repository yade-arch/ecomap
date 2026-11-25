// Municipality part of a report's detail screen: status, public timeline and, for staff of the
// report's municipality, the workflow actions (accept, assign, start, resolve, verify, reject).
// Every action is checked again by the database; this screen only hides buttons for convenience.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatDateTime, type StringKey, useI18n } from '@/i18n';
import { fetchDepartments, fetchEvents, fetchStaff, muniResolve, muniUpdate, muniVerify } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { pickPhoto, uploadPhoto } from '@/lib/photo';
import type { Department, Report, ReportEvent, StaffMember } from '@/lib/types';
import { useAuth } from '@/providers/auth';
import { Badge, Button, Chip, Field, Notice, SectionTitle } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

import { CaptureProof } from './CaptureProof';

export function muniColor(status: string | null): { bg: string; fg: string } {
  switch (status) {
    case 'verified':
      return { bg: colors.primarySoft, fg: colors.primaryDark };
    case 'in_progress':
    case 'assigned':
      return { bg: '#DBEAFE', fg: '#1D4ED8' };
    case 'resolved':
      return { bg: '#FEF9C3', fg: '#854D0E' };
    case 'rejected':
    case 'duplicate':
      return { bg: colors.surface, fg: colors.textMuted };
    default:
      return { bg: colors.warningSoft, fg: colors.warning };
  }
}

export function MuniBadge({ status }: { status: string | null }) {
  const { t } = useI18n();
  if (!status) return null;
  const c = muniColor(status);
  return <Badge label={t(`muni.${status}` as StringKey)} color={c.bg} textColor={c.fg} />;
}

const DUE_DAYS = [1, 3, 7];

export function MuniSection({ report, onChanged }: { report: Report; onChanged: () => Promise<void> | void }) {
  const { t, language } = useI18n();
  const { userId, access } = useAuth();
  const [events, setEvents] = useState<ReportEvent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [dept, setDept] = useState<string | null>(report.department_id);
  const [assignee, setAssignee] = useState<string | null>(report.assignee_id);
  const [due, setDue] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const isStaff =
    !!report.municipality_id &&
    (access.is_moderator || (access.municipality_ids ?? []).includes(report.municipality_id));

  const loadEvents = useCallback(async () => {
    try {
      setEvents(await fetchEvents(report.id));
    } catch {
      // timeline stays empty
    }
  }, [report.id]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents, report.muni_status]);

  useEffect(() => {
    if (!isStaff || !report.municipality_id) return;
    void Promise.all([fetchDepartments(report.municipality_id), fetchStaff(report.municipality_id)])
      .then(([d, s]) => {
        setDepartments(d);
        setStaff(s);
        if (!report.department_id) {
          const suggested = d.find((x) => x.issue_groups.includes(report.issue_group));
          if (suggested) setDept(suggested.id);
        }
      })
      .catch(() => {});
  }, [isStaff, report.municipality_id, report.department_id, report.issue_group]);

  if (!report.municipality_id) return null;

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setNotice(null);
    try {
      await work();
      setNote('');
      setNotice({ tone: 'success', text: t('staff.done') });
      await onChanged();
      await loadEvents();
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    } finally {
      setBusy(null);
    }
  };

  const noteOrNull = note.trim() || null;
  const s = report.muni_status;
  const open = s !== 'verified' && s !== 'rejected' && s !== 'duplicate';
  const workable = report.report_status === 'active' || report.report_status === 'cleanup_in_progress';

  const resolve = async () => {
    if (!userId) return;
    let photo;
    try {
      photo = await pickPhoto();
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
      return;
    }
    if (!photo) return;
    await run('resolve', async () => {
      const path = await uploadPhoto(photo, 'cleanup-photos', userId);
      await muniResolve(report.id, path, noteOrNull);
    });
  };

  const visibleEvents = events.filter((e) => isStaff || !e.is_internal);
  const deptName = departments.find((d) => d.id === report.department_id)?.name;
  const assigneeName = staff.find((m) => m.user_id === report.assignee_id)?.profile?.display_name;

  return (
    <View style={styles.wrap}>
      <SectionTitle>{t('detail.municipality')}</SectionTitle>
      <View style={styles.row}>
        <MuniBadge status={s} />
        {report.due_at && open ? (
          <Text style={[styles.muted, new Date(report.due_at) < new Date() && styles.overdue]}>
            {t('staff.dueAt', { d: formatDateTime(report.due_at, language) })}
          </Text>
        ) : null}
      </View>
      {isStaff && (deptName || assigneeName) ? (
        <Text style={styles.muted}>{[deptName, assigneeName].filter(Boolean).join(' · ')}</Text>
      ) : null}

      {visibleEvents.length > 0 ? (
        <View style={styles.timeline}>
          {visibleEvents.map((e) => (
            <View key={e.id} style={styles.event}>
              <Ionicons
                name={e.is_internal ? 'lock-closed' : 'ellipse'}
                size={e.is_internal ? 12 : 8}
                color={e.is_internal ? colors.textMuted : colors.primary}
                style={styles.dot}
              />
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle}>
                  {e.action === 'note'
                    ? t('staff.internal')
                    : e.to_status
                      ? t(`muni.${e.to_status}` as StringKey)
                      : e.action}
                </Text>
                {e.note ? <Text style={styles.body}>{e.note}</Text> : null}
                <Text style={styles.muted}>
                  {[isStaff ? e.actor?.display_name : null, formatDateTime(e.created_at, language)].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {isStaff ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('staff.title')}</Text>
          <CaptureProof report={report} />
          {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}

          {s === 'resolved' ? (
            <View style={styles.actions}>
              <Button
                label={t('staff.verify')}
                icon="checkmark-done"
                style={styles.action}
                loading={busy === 'verify'}
                disabled={busy !== null}
                onPress={() => void run('verify', () => muniVerify(report.id, true, noteOrNull))}
              />
              <Button
                label={t('staff.reopen')}
                icon="arrow-undo"
                variant="secondary"
                style={styles.action}
                disabled={busy !== null}
                onPress={() => void run('reopen', () => muniVerify(report.id, false, noteOrNull))}
              />
            </View>
          ) : null}

          {open && s !== 'resolved' ? (
            <>
              {s === 'submitted' || s === 'reopened' ? (
                <Button
                  label={t('staff.accept')}
                  icon="checkmark"
                  loading={busy === 'accept'}
                  disabled={busy !== null}
                  onPress={() => void run('accept', () => muniUpdate(report.id, 'accept', { note: noteOrNull }))}
                />
              ) : null}

              <Text style={styles.label}>{t('staff.department')}</Text>
              <View style={styles.chips}>
                {departments.map((d) => (
                  <Chip key={d.id} label={d.name} selected={dept === d.id} onPress={() => setDept(d.id)} />
                ))}
              </View>
              <Text style={styles.label}>{t('staff.assignee')}</Text>
              <View style={styles.chips}>
                {staff.map((m) => (
                  <Chip
                    key={m.user_id}
                    label={`${m.profile?.display_name ?? '?'} · ${t(`staff.role.${m.role}` as StringKey)}`}
                    selected={assignee === m.user_id}
                    onPress={() => setAssignee(m.user_id)}
                  />
                ))}
              </View>
              <Text style={styles.label}>{t('staff.due')}</Text>
              <View style={styles.chips}>
                {DUE_DAYS.map((n) => (
                  <Chip key={n} label={t('staff.days', { n })} selected={due === n} onPress={() => setDue(n)} />
                ))}
              </View>
              <Button
                label={t('staff.assign')}
                icon="people"
                variant="secondary"
                loading={busy === 'assign'}
                disabled={busy !== null || (!dept && !assignee)}
                onPress={() =>
                  void run('assign', () =>
                    muniUpdate(report.id, 'assign', {
                      note: noteOrNull,
                      departmentId: dept,
                      assigneeId: assignee,
                      dueAt: due ? new Date(Date.now() + due * 86400000).toISOString() : null,
                    }),
                  )
                }
              />

              {workable && (s === 'assigned' || s === 'accepted' || s === 'reopened') ? (
                <Button
                  label={t('staff.start')}
                  icon="play"
                  variant="secondary"
                  loading={busy === 'start'}
                  disabled={busy !== null}
                  onPress={() => void run('start', () => muniUpdate(report.id, 'start', { note: noteOrNull }))}
                />
              ) : null}
              {workable ? (
                <Button
                  label={t('staff.resolve')}
                  icon="camera"
                  loading={busy === 'resolve'}
                  disabled={busy !== null}
                  onPress={() => void resolve()}
                />
              ) : null}

              <View style={styles.actions}>
                <Button
                  label={t('staff.duplicate')}
                  variant="ghost"
                  style={styles.action}
                  disabled={busy !== null}
                  onPress={() => void run('duplicate', () => muniUpdate(report.id, 'duplicate', { note: noteOrNull }))}
                />
                <Button
                  label={t('staff.reject')}
                  variant="danger"
                  style={styles.action}
                  disabled={busy !== null}
                  onPress={() => void run('reject', () => muniUpdate(report.id, 'reject', { note: noteOrNull }))}
                />
              </View>
            </>
          ) : null}

          <Field label={t('staff.note')} value={note} onChangeText={setNote} maxLength={500} multiline />
          <Button
            label={t('staff.addNote')}
            icon="lock-closed-outline"
            variant="ghost"
            disabled={busy !== null || !noteOrNull}
            onPress={() => void run('note', () => muniUpdate(report.id, 'note', { note: noteOrNull }))}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  muted: { fontSize: font.small, color: colors.textMuted },
  overdue: { color: colors.danger, fontWeight: '700' },
  body: { fontSize: font.body, color: colors.text },
  timeline: { gap: spacing.sm, paddingLeft: spacing.xs },
  event: { flexDirection: 'row', gap: spacing.sm },
  dot: { marginTop: 6 },
  eventBody: { flex: 1, gap: 2 },
  eventTitle: { fontSize: font.body, fontWeight: '600', color: colors.text },
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardTitle: { fontSize: font.large, fontWeight: '700', color: colors.text },
  label: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
