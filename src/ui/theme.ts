// One place for colours, spacing and type sizes so every screen looks the same.
import type { Severity } from '@/lib/types';

export const colors = {
  primary: '#059669',
  primaryDark: '#047857',
  primarySoft: '#D1FAE5',
  background: '#FFFFFF',
  surface: '#F6F7F9',
  border: '#E5E7EB',
  text: '#111827',
  textMuted: '#6B7280',
  textOnPrimary: '#FFFFFF',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  info: '#1D4ED8',
  infoSoft: '#DBEAFE',
  low: '#EAB308',
  medium: '#F97316',
  high: '#EF4444',
  cleaned: '#10B981',
  pending: '#9CA3AF',
  overlay: 'rgba(17, 24, 39, 0.45)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = { small: 13, body: 15, large: 17, title: 22, hero: 28 } as const;

export const severityColor: Record<Severity, string> = {
  low: colors.low,
  medium: colors.medium,
  high: colors.high,
};

export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
} as const;
