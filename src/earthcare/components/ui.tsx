// Shared EARTHCARE building blocks (header, cards, balance, buttons, reward glyphs).
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { type Href, useRouter } from 'expo-router';
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cardShadow, ec, ecRadius, ecSpace, formatPoints, liftShadow, MAX_CONTENT_WIDTH, rewardTints } from '../theme';
import { EarthcareWordmark, HeaderLeaves, LeafMark } from './logos';

export type IonName = ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function EcScroll({
  children,
  refreshControl,
  maxWidth = MAX_CONTENT_WIDTH,
  contentStyle,
}: {
  children: ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  maxWidth?: number;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.scrollContent, { maxWidth }, contentStyle]}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

const MENU: { label: string; icon: IonName; href: Href }[] = [
  { label: 'Harita', icon: 'map-outline', href: '/map' },
  { label: 'Sıralama', icon: 'trophy-outline', href: '/leaderboard' },
  { label: 'EcoPuan', icon: 'leaf-outline', href: '/ecopuan' },
  { label: 'Katkı Sağla', icon: 'camera-outline', href: '/ecopuan/contribute' },
  { label: 'Ödüller', icon: 'gift-outline', href: '/ecopuan/rewards' },
  { label: 'Puan Geçmişi', icon: 'time-outline', href: '/ecopuan/history' },
  { label: 'Bildirimler', icon: 'notifications-outline', href: '/notifications' },
  { label: 'Profil', icon: 'person-outline', href: '/profile' },
];

/** EcoMap menu (opened from the ≡ button): the main app's sections plus the EcoPuan screens. */
function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuBackdrop} onPress={onClose} accessibilityLabel="Menüyü kapat">
        <Pressable style={[styles.menuPanel, { paddingTop: insets.top + 16 }]} onPress={() => {}}>
          <View style={styles.menuHead}>
            <LeafMark size={28} />
            <Text style={styles.menuTitle}>EcoMap</Text>
          </View>
          {MENU.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                router.navigate(item.href);
              }}
              style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: ec.mint }]}>
              <Ionicons name={item.icon} size={21} color={ec.green} />
              <Text style={styles.menuLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Green EARTHCARE header (EcoMap primary colours) with decorative leaves. */
export function EcHeader({
  variant,
  showBell = true,
  bellDot = false,
}: {
  variant: 'home' | 'sub';
  showBell?: boolean;
  bellDot?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
      <View style={styles.leavesRight} pointerEvents="none">
        <HeaderLeaves width={130} height={80} />
      </View>
      <View style={[styles.headerRow, { maxWidth: MAX_CONTENT_WIDTH }]}>
        {variant === 'home' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Menü"
            onPress={() => setMenuOpen(true)}
            hitSlop={10}
            style={styles.headerBtn}>
            <Ionicons name="menu" size={26} color={ec.white} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Geri"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/ecopuan'))}
            hitSlop={10}
            style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={26} color={ec.white} />
          </Pressable>
        )}
        <View style={styles.headerCenter}>
          <EarthcareWordmark tone="light" tagline={variant === 'sub'} />
        </View>
        {showBell ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Bildirimler"
            onPress={() => router.push('/notifications')}
            hitSlop={10}
            style={styles.headerBtn}>
            <Ionicons name="notifications-outline" size={24} color={ec.white} />
            {bellDot ? <View style={styles.bellDot} /> : null}
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>
      <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------
export function BalanceCard({
  balance,
  compact = false,
  unit = 'EC',
  flash,
  onInfo,
  footer,
}: {
  balance: number | null;
  compact?: boolean;
  unit?: 'Puan' | 'EC';
  flash?: { delta: number; at: number } | null;
  onInfo?: () => void;
  footer?: ReactNode;
}) {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!flash) return;
    pulse.setValue(1);
    Animated.timing(pulse, { toValue: 0, duration: 2200, useNativeDriver: false }).start();
  }, [flash, pulse]);
  const bg = pulse.interpolate({ inputRange: [0, 1], outputRange: [ec.mint, flash && flash.delta < 0 ? '#FFE3E0' : '#C8EBC9'] });

  return (
    <Animated.View style={[styles.balance, compact && styles.balanceCompact, { backgroundColor: bg }]}>
      <View style={[styles.balanceLeaf, compact && { width: 54, height: 54 }]}>
        <LeafMark size={compact ? 32 : 40} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.balanceLabel}>EcoPuan Bakiyeniz:</Text>
        <View style={styles.balanceRow}>
          <Text style={[styles.balanceValue, compact && { fontSize: 28, lineHeight: 36 }]} accessibilityLiveRegion="polite">
            {formatPoints(balance)} {unit}
          </Text>
          {flash ? (
            <Animated.Text style={[styles.flash, { opacity: pulse, color: flash.delta < 0 ? ec.danger : ec.green }]}>
              {flash.delta > 0 ? '+' : ''}
              {formatPoints(flash.delta)}
            </Animated.Text>
          ) : null}
        </View>
        {footer}
      </View>
      {onInfo ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Bilgi" onPress={onInfo} hitSlop={10} style={styles.infoBtn}>
          <Ionicons name="information-circle-outline" size={22} color={ec.green} />
        </Pressable>
      ) : (
        <View pointerEvents="none" style={styles.sparkle}>
          <Ionicons name="sparkles" size={18} color={ec.greenBright} />
        </View>
      )}
    </Animated.View>
  );
}

export function StatTile({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statTop}>
        {icon}
        <Text style={styles.statValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
export function PrimaryButton({
  label,
  icon,
  onPress,
  loading,
  disabled,
  style,
  tone = 'green',
}: {
  label: string;
  icon?: IonName;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  tone?: 'green' | 'danger' | 'outline';
}) {
  const inactive = !!(disabled || loading);
  const fg = tone === 'outline' ? ec.green : ec.white;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        tone === 'green' && liftShadow,
        tone === 'danger' && { backgroundColor: ec.danger },
        tone === 'outline' && styles.outline,
        inactive && { opacity: 0.55 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={22} color={fg} /> : null}
          <Text style={[styles.primaryLabel, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------
export function RewardGlyph({ icon, size = 26, color }: { icon: string; size?: number; color?: string }) {
  const tint = rewardTints[icon] ?? rewardTints.bicycle;
  const c = color ?? tint.fg;
  if (icon === 'bread') return <MaterialCommunityIcons name="baguette" size={size} color={c} />;
  if (icon === 'bicycle') return <MaterialCommunityIcons name="bicycle" size={size + 2} color={c} />;
  if (icon === 'cafe') return <MaterialCommunityIcons name="coffee-outline" size={size} color={c} />;
  if (icon === 'car') return <MaterialCommunityIcons name="car-outline" size={size} color={c} />;
  return <Ionicons name="gift-outline" size={size} color={c} />;
}

export function SectionHeader({ icon, title, action, onAction }: { icon?: IonName; title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionRow}>
      <View style={styles.sectionLeft}>
        {icon ? <Ionicons name={icon} size={20} color={ec.green} /> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={8} style={styles.sectionAction}>
          <Text style={styles.sectionActionText}>{action}</Text>
          <Ionicons name="chevron-forward" size={14} color={ec.green} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function EcNotice({ tone, text }: { tone: 'success' | 'danger' | 'info'; text: string }) {
  const map = {
    success: { bg: ec.mint, fg: ec.green, icon: 'checkmark-circle' as IonName },
    danger: { bg: ec.dangerSoft, fg: ec.danger, icon: 'alert-circle' as IonName },
    info: { bg: '#EEF4FB', fg: ec.info, icon: 'information-circle' as IonName },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: map.bg }]} accessibilityRole="alert">
      <Ionicons name={map.icon} size={20} color={map.fg} />
      <Text style={[styles.noticeText, { color: map.fg }]}>{text}</Text>
    </View>
  );
}

export function LiveBadge({ live }: { live: boolean }) {
  return (
    <View style={[styles.live, { backgroundColor: live ? ec.mint : '#F1F1F1' }]}>
      <View style={[styles.liveDot, { backgroundColor: live ? ec.greenBright : '#9E9E9E' }]} />
      <Text style={[styles.liveText, { color: live ? ec.green : ec.muted }]}>{live ? 'Canlı' : 'Bağlanıyor'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ec.bg },
  scrollContent: { width: '100%', alignSelf: 'center', padding: ecSpace.lg, paddingBottom: 32, gap: ecSpace.lg },

  header: {
    backgroundColor: ec.header,
    paddingBottom: 16,
    paddingHorizontal: ecSpace.lg,
    overflow: 'hidden',
  },
  leavesRight: { position: 'absolute', right: 34, top: 0, opacity: 0.45 },
  headerRow: { width: '100%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: ec.notifyDot,
    borderWidth: 1.5,
    borderColor: ec.header,
  },

  card: { backgroundColor: ec.card, borderRadius: ecRadius.lg, padding: ecSpace.lg, ...cardShadow },

  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: ecRadius.xl,
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: ec.mintBorder,
    ...cardShadow,
  },
  balanceCompact: { paddingVertical: 14 },
  balanceLeaf: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: ec.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ec.mintBorder,
  },
  balanceLabel: { fontWeight: '600', color: ec.text, fontSize: 14 },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  balanceValue: { fontWeight: '800', color: ec.header, fontSize: 32, lineHeight: 42 },
  flash: { fontWeight: '700', fontSize: 16 },
  infoBtn: { alignSelf: 'flex-start' },
  sparkle: { alignSelf: 'flex-start' },

  stat: {
    flex: 1,
    backgroundColor: ec.card,
    borderRadius: ecRadius.md,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: ec.line,
    ...cardShadow,
  },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statValue: { fontWeight: '700', color: ec.ink, fontSize: 18 },
  statLabel: { fontWeight: '400', color: ec.muted, fontSize: 11, lineHeight: 14, marginTop: 2 },

  primary: {
    minHeight: 54,
    borderRadius: ecRadius.md,
    backgroundColor: ec.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18,
  },
  outline: { backgroundColor: ec.white, borderWidth: 1.5, borderColor: ec.green },
  primaryLabel: { fontWeight: '600', fontSize: 17 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontWeight: '700', color: ec.ink, fontSize: 17 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionActionText: { fontWeight: '500', color: ec.green, fontSize: 12.5 },

  notice: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: ecRadius.md },
  noticeText: { flex: 1, fontWeight: '500', fontSize: 13.5 },

  menuBackdrop: { flex: 1, backgroundColor: ec.overlay, flexDirection: 'row' },
  menuPanel: { width: 280, maxWidth: '82%', backgroundColor: ec.card, paddingHorizontal: 12, gap: 2 },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingBottom: 14 },
  menuTitle: { fontWeight: '800', fontSize: 20, color: ec.ink },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 8, borderRadius: ecRadius.md },
  menuLabel: { fontWeight: '600', fontSize: 15, color: ec.ink },

  live: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontWeight: '600', fontSize: 11.5 },
});
