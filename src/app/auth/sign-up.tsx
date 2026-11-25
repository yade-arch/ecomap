import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { useI18n } from '@/i18n';
import { TR_CITIES } from '@/lib/config';
import { errorKey } from '@/lib/errors';
import type { AppRole } from '@/lib/types';
import { useAuth } from '@/providers/auth';
import { Button, Chip, Field, Notice, SectionTitle } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

export default function SignUpScreen() {
  const { t } = useI18n();
  const { signUp } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('');
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [observer, setObserver] = useState(true);
  const [activist, setActivist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);

  const submit = async () => {
    const name = displayName.trim();
    const roles: AppRole[] = [...(observer ? (['observer'] as const) : []), ...(activist ? (['activist'] as const) : [])];
    if (name.length < 2 || name.length > 40 || !email.includes('@') || password.length < 8) {
      setError(t('auth.fillAll'));
      return;
    }
    if (roles.length === 0) {
      setError(t('profile.oneRole'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await signUp({ email: email.trim(), password, displayName: name, city: city.trim(), roles });
      if (outcome === 'confirm_email') {
        setConfirmEmail(true);
      } else if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/map');
      }
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  if (confirmEmail) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Notice tone="success" icon="mail" text={t('auth.confirmEmail')} />
        <Button label={t('common.signIn')} onPress={() => router.replace('/auth/sign-in')} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <Text style={styles.title}>{t('auth.signUpTitle')}</Text>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Field
        label={t('profile.displayName')}
        hint={t('auth.nameHint')}
        value={displayName}
        onChangeText={setDisplayName}
        maxLength={40}
        autoCapitalize="words"
      />
      <Text style={styles.fieldLabel}>{t('profile.city')}</Text>
      <TouchableOpacity style={styles.cityBtn} onPress={() => setShowCityPicker((v) => !v)} activeOpacity={0.7}>
        <Text style={[styles.cityBtnText, !city && styles.cityPlaceholder]}>{city || t('profile.chooseCity')}</Text>
        <Ionicons name={showCityPicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {showCityPicker ? (
        <View style={styles.cityGrid}>
          {TR_CITIES.map((c) => (
            <Chip key={c} label={c} selected={city === c} onPress={() => { setCity(c); setShowCityPicker(false); }} />
          ))}
        </View>
      ) : null}
      <Field
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <Field
        label={t('auth.password')}
        hint={t('auth.passwordHint')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />

      <SectionTitle>{t('profile.roles')}</SectionTitle>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('profile.observerDesc')}</Text>
          <Switch value={observer} onValueChange={setObserver} trackColor={{ true: colors.primary }} />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('profile.activistDesc')}</Text>
          <Switch value={activist} onValueChange={setActivist} trackColor={{ true: colors.primary }} />
        </View>
      </View>

      <Button label={t('common.signUp')} onPress={() => void submit()} loading={busy} />
      <Button label={t('auth.haveAccount')} variant="ghost" onPress={() => router.replace('/auth/sign-in')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: font.title, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  card: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  switchLabel: { flex: 1, fontSize: font.body, color: colors.text },
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
