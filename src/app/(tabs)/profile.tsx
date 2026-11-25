import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { LANGUAGE_NAMES, useI18n } from '@/i18n';
import { countUnread, deleteMyAccount, setMyRoles, updateProfile } from '@/lib/api';
import { LANGUAGES, type Language, TR_CITIES } from '@/lib/config';
import { errorKey } from '@/lib/errors';
import type { AppRole } from '@/lib/types';
import { useAuth } from '@/providers/auth';
import { Button, Chip, EmptyView, Field, Notice, SectionTitle, confirm } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

export default function ProfileScreen() {
  const { t, language, setLanguage } = useI18n();
  const { userId, profile, access, session, signOut, refresh } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (userId) void countUnread().then(setUnread).catch(() => {});
    }, [userId]),
  );

  useEffect(() => {
    setName(profile?.display_name ?? '');
    setCity(profile?.city ?? '');
  }, [profile?.display_name, profile?.city]);

  const chooseLanguage = (next: Language) => {
    setLanguage(next);
    if (userId) void updateProfile(userId, { preferred_language: next }).catch(() => {});
  };

  const languagePicker = (
    <View style={styles.chips}>
      {LANGUAGES.map((code) => (
        <Chip key={code} label={LANGUAGE_NAMES[code]} selected={language === code} onPress={() => chooseLanguage(code)} />
      ))}
    </View>
  );

  if (!userId || !profile) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <EmptyView
          icon="leaf-outline"
          text={`${t('profile.guestTitle')}\n${t('profile.guestBody')}`}
          action={
            <View style={styles.guestActions}>
              <Button label={t('common.signUp')} onPress={() => router.push('/auth/sign-up')} />
              <Button label={t('common.signIn')} variant="secondary" onPress={() => router.push('/auth/sign-in')} />
            </View>
          }
        />
        <SectionTitle>{t('profile.language')}</SectionTitle>
        {languagePicker}
      </ScrollView>
    );
  }

  const run = async (work: () => Promise<void>) => {
    setSaving(true);
    setNotice(null);
    try {
      await work();
      await refresh();
      setNotice({ tone: 'success', text: t('profile.saved') });
    } catch (error) {
      setNotice({ tone: 'danger', text: t(errorKey(error)) });
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 40) {
      setNotice({ tone: 'warning', text: t('auth.nameHint') });
      return;
    }
    void run(() => updateProfile(userId, { display_name: cleanName, city: city.trim() || null }));
  };

  const toggleRole = (role: AppRole) => {
    const has = access.roles.includes(role);
    const next = has ? access.roles.filter((r) => r !== role) : [...access.roles, role];
    if (next.length === 0) {
      setNotice({ tone: 'warning', text: t('profile.oneRole') });
      return;
    }
    void run(() => setMyRoles(next));
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <View style={styles.header}>
        <Text style={styles.name}>{profile.display_name}</Text>
        <Text style={styles.muted}>{session?.user.email}</Text>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{profile.total_points}</Text>
          <Text style={styles.muted}>{t('common.points', { n: '' }).trim()}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{profile.reports_count}</Text>
          <Text style={styles.muted}>{t('board.reports', { n: '' }).trim()}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{profile.cleans_count}</Text>
          <Text style={styles.muted}>{t('board.cleans', { n: '' }).trim()}</Text>
        </View>
      </View>

      {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}
      {access.is_banned ? <Notice tone="danger" text={t('err.banned')} /> : null}

      <Button
        label={t('profile.notifications', { n: unread })}
        icon={unread > 0 ? 'notifications' : 'notifications-outline'}
        variant="secondary"
        onPress={() => router.push('/notifications')}
      />
      {access.is_municipality_admin ? (
        <Button
          label={t('panel.sectionPoints')}
          icon="people"
          variant="secondary"
          onPress={() => router.push({ pathname: '/municipality', params: { section: 'points' } })}
        />
      ) : null}
      {access.is_staff ? (
        <Button label={t('profile.panel')} icon="business" onPress={() => router.push('/municipality')} />
      ) : null}
      {access.is_moderator ? (
        <Button label={t('profile.moderation')} icon="shield-checkmark" variant="secondary" onPress={() => router.push('/moderation')} />
      ) : null}

      <SectionTitle>{t('profile.roles')}</SectionTitle>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('profile.observerDesc')}</Text>
          <Switch
            value={access.roles.includes('observer')}
            onValueChange={() => toggleRole('observer')}
            disabled={saving}
            trackColor={{ true: colors.primary }}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('profile.activistDesc')}</Text>
          <Switch
            value={access.roles.includes('activist')}
            onValueChange={() => toggleRole('activist')}
            disabled={saving}
            trackColor={{ true: colors.primary }}
          />
        </View>
      </View>

      <SectionTitle>{t('tabs.profile')}</SectionTitle>
      <Field label={t('profile.displayName')} value={name} onChangeText={setName} maxLength={40} autoCapitalize="words" />

      {/* City picker */}
      <Text style={styles.fieldLabel}>{t('profile.city')}</Text>
      <TouchableOpacity style={styles.cityBtn} onPress={() => setShowCityPicker((v) => !v)} activeOpacity={0.7}>
        <Text style={[styles.cityBtnText, !city && styles.cityPlaceholder]}>{city || t('profile.chooseCity')}</Text>
        <Ionicons name={showCityPicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {showCityPicker ? (
        <View style={styles.cityGrid}>
          {TR_CITIES.map((c) => (
            <Chip
              key={c}
              label={c}
              selected={city === c}
              onPress={() => { setCity(c); setShowCityPicker(false); }}
            />
          ))}
        </View>
      ) : null}

      <Button label={t('common.save')} onPress={save} loading={saving} />

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('profile.hide')}</Text>
          <Switch
            value={profile.leaderboard_hidden}
            onValueChange={(value) => void run(() => updateProfile(userId, { leaderboard_hidden: value }))}
            disabled={saving}
            trackColor={{ true: colors.primary }}
          />
        </View>
      </View>

      <SectionTitle>{t('profile.language')}</SectionTitle>
      {languagePicker}

      {Platform.OS !== 'web' ? (
        <Button
          label={t('profile.locationSettings')}
          icon="location-outline"
          variant="ghost"
          onPress={() => void Linking.openSettings().catch(() => {})}
        />
      ) : null}
      <Button label={t('common.signOut')} icon="log-out-outline" variant="secondary" onPress={() => void signOut()} />
      <Button
        label={t('profile.delete')}
        icon="trash-outline"
        variant="ghost"
        onPress={() =>
          void (async () => {
            if (!(await confirm(t('profile.deleteConfirm'), t('profile.delete'), t('common.cancel')))) return;
            try {
              await deleteMyAccount();
              await signOut();
            } catch (error) {
              setNotice({ tone: 'danger', text: t(errorKey(error)) });
            }
          })()
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  guestActions: { gap: spacing.sm, alignSelf: 'stretch', marginTop: spacing.md },
  header: { gap: 2 },
  name: { fontSize: font.title, fontWeight: '700', color: colors.text },
  muted: { fontSize: font.small, color: colors.textMuted },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { fontSize: font.title, fontWeight: '700', color: colors.primaryDark },
  card: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  switchLabel: { flex: 1, fontSize: font.body, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fieldLabel: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  cityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cityBtnText: { fontSize: font.body, color: colors.text, fontWeight: '600' },
  cityPlaceholder: { color: colors.textMuted, fontWeight: '400' },
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
