// Shared building blocks. Screens are assembled from these so spacing, colours and
// touch targets stay consistent everywhere.
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import type { Translate } from '@/i18n';
import type { ReportStatus, Severity } from '@/lib/types';

import { colors, font, radius, severityColor, spacing } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, style }: ButtonProps) {
  const inactive = disabled || loading;
  const foreground =
    variant === 'primary' || variant === 'danger' ? colors.textOnPrimary : variant === 'ghost' ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'ghost' && styles.buttonGhost,
        inactive && styles.buttonDisabled,
        pressed && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={foreground} /> : null}
          <Text style={[styles.buttonLabel, { color: foreground }]} numberOfLines={2}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, style, ...input }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, style]}
        {...input}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, color, textColor }: { label: string; color: string; textColor?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={[styles.badgeLabel, textColor ? { color: textColor } : null]}>{label}</Text>
    </View>
  );
}

export function SeverityBadge({ severity, t }: { severity: Severity; t: Translate }) {
  return <Badge label={t(`severity.${severity}`)} color={severityColor[severity]} />;
}

export function StatusBadge({ status, t }: { status: ReportStatus; t: Translate }) {
  const tone =
    status === 'cleaned'
      ? { bg: colors.primarySoft, fg: colors.primaryDark }
      : status === 'rejected'
        ? { bg: colors.dangerSoft, fg: colors.danger }
        : status === 'active'
          ? { bg: colors.surface, fg: colors.text }
          : { bg: colors.warningSoft, fg: colors.warning };
  return <Badge label={t(`status.${status}`)} color={tone.bg} textColor={tone.fg} />;
}

export function Notice({
  tone = 'info',
  text,
  icon,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  text: string;
  icon?: IconName;
}) {
  const palette = {
    info: { bg: colors.infoSoft, fg: colors.info, icon: 'information-circle' as IconName },
    success: { bg: colors.primarySoft, fg: colors.primaryDark, icon: 'checkmark-circle' as IconName },
    warning: { bg: colors.warningSoft, fg: colors.warning, icon: 'warning' as IconName },
    danger: { bg: colors.dangerSoft, fg: colors.danger, icon: 'alert-circle' as IconName },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]} accessibilityRole="alert">
      <Ionicons name={icon ?? palette.icon} size={20} color={palette.fg} />
      <Text style={[styles.noticeText, { color: palette.fg }]}>{text}</Text>
    </View>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function LoadingView({ label }: { label?: string }) {
  return (
    <Centered>
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? <Text style={styles.muted}>{label}</Text> : null}
    </Centered>
  );
}

export function EmptyView({ icon, text, action }: { icon: IconName; text: string; action?: ReactNode }) {
  return (
    <Centered>
      <Ionicons name={icon} size={44} color={colors.pending} />
      <Text style={[styles.muted, styles.emptyText]}>{text}</Text>
      {action}
    </Centered>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/** Yes/no question that works on phones and in the browser. */
export function confirm(message: string, okLabel: string, cancelLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false);
  }
  return new Promise((resolve) => {
    Alert.alert('', message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, onPress: () => resolve(true) },
    ]);
  });
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.danger },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { fontSize: font.body, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: 0.75 },
  field: { gap: spacing.xs },
  fieldLabel: { fontSize: font.small, fontWeight: '600', color: colors.text },
  fieldHint: { fontSize: font.small, color: colors.textMuted },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: font.small, fontWeight: '600', color: colors.text },
  chipLabelSelected: { color: colors.textOnPrimary },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeLabel: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  notice: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontSize: font.small, lineHeight: 19, fontWeight: '500' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  muted: { fontSize: font.body, color: colors.textMuted },
  emptyText: { textAlign: 'center' },
  sectionTitle: { fontSize: font.large, fontWeight: '700', color: colors.text },
});
