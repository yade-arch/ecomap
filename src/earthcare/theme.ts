// EARTHCARE design tokens — built on the EcoMap theme (src/ui/theme.ts) so the EcoPuan screens
// share the main app's greens, greys, borders and system font. Change colours in src/ui/theme.ts.
import { Platform, type ViewStyle } from 'react-native';

import { colors } from '@/ui/theme';

export const ec = {
  // greens (EcoMap primary family)
  forest: '#065F46',
  header: colors.primaryDark, // header / hero background
  green: colors.primary, // primary buttons, active states
  greenBright: colors.cleaned, // leaf highlight, progress ring
  leaf: '#6EE7B7', // light leaf in logo / header decoration
  mint: '#ECFDF5', // soft card background
  mintBorder: '#A7F3D0',
  mintDeep: colors.primarySoft,
  // neutrals
  bg: colors.surface,
  card: colors.background,
  ink: colors.text, // titles
  text: '#374151', // body
  muted: colors.textMuted,
  line: colors.border,
  dashed: '#6EE7B7',
  white: '#FFFFFF',
  // informational blue (admin), sun accent (logos)
  infoDark: '#1E3A8A',
  info: colors.info,
  infoSoft: colors.infoSoft,
  sun: '#F59E0B',
  // states
  danger: colors.danger,
  dangerSoft: colors.dangerSoft,
  warning: '#EA580C',
  warningSoft: '#FFEDD5',
  notifyDot: colors.danger,
  overlay: colors.overlay,
} as const;

/** Reward accents (icon colour + soft tile background) */
export const rewardTints: Record<string, { fg: string; bg: string; btn: string }> = {
  bicycle: { fg: colors.primaryDark, bg: '#ECFDF5', btn: colors.primary },
  cafe: { fg: '#EA580C', bg: '#FFF7ED', btn: '#EA580C' },
  car: { fg: colors.info, bg: '#EFF6FF', btn: '#2563EB' },
  bread: { fg: '#92400E', bg: '#FEF3C7', btn: '#D97706' },
};

export const ecRadius = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 } as const;
export const ecSpace = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/** Soft card shadow used on every white card in the references. */
export const cardShadow: ViewStyle = Platform.select<ViewStyle>({
  web: { boxShadow: '0 1px 4px rgba(17, 24, 39, 0.08)' } as ViewStyle,
  default: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
})!;

/** Stronger shadow for primary buttons and the floating tab bar. */
export const liftShadow: ViewStyle = Platform.select<ViewStyle>({
  web: { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)' } as ViewStyle,
  default: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
})!;

/** Content is capped and centred on wide (web / tablet) screens, like a phone column. */
export const MAX_CONTENT_WIDTH = 560;
export const MAX_ADMIN_WIDTH = 1180;

/** 1250 -> "1.250" (Turkish thousands separator, as in the references). */
export function formatPoints(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + Math.abs(Math.trunc(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatKg(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
}
