// Logos drawn as SVG (no bitmap assets needed): EARTHCARE leaf, İTK High Voltage,
// Marmaris Belediyesi sun-and-sea mark.
import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { ec } from '../theme';

/** The EARTHCARE two-tone leaf. */
/** SVG ids must be unique per page on web (all <svg> elements share one DOM). */
export function useSvgId(prefix: string): string {
  return prefix + useId().replace(/[^A-Za-z0-9_-]/g, '');
}

export function LeafMark({ size = 32, light = false }: { size?: number; light?: boolean }) {
  const id = useSvgId(light ? 'leafL' : 'leafD');
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={light ? '#BFE89A' : ec.green} />
          <Stop offset="1" stopColor={light ? '#FFFFFF' : ec.leaf} />
        </LinearGradient>
      </Defs>
      <Path d="M8 56C8 30 24 10 58 6c-2 30-18 50-44 50-2 0-4 0-6 0z" fill={`url(#${id})`} />
      <Path
        d="M10 54C22 40 34 28 50 14"
        stroke={light ? ec.header : '#FFFFFF'}
        strokeWidth={3.2}
        strokeLinecap="round"
        fill="none"
        opacity={0.9}
      />
      <Path d="M24 40c6 0 12-1 16-4M32 30c4 0 8-1 11-3" stroke={light ? ec.header : '#FFFFFF'} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.7} />
    </Svg>
  );
}

/** Large translucent leaves that decorate the green headers (top corners in the references). */
export function HeaderLeaves({ width = 140, height = 90, flip = false }: { width?: number; height?: number; flip?: boolean }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 140 90" style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
      <Path d="M140 0C96 4 70 30 72 70c34-2 62-28 68-70z" fill={ec.leaf} opacity={0.55} />
      <Path d="M140 0C110 22 92 44 72 70" stroke="#FFFFFF" strokeWidth={2} opacity={0.4} fill="none" />
      <Path d="M140 26c-26 2-40 18-40 40 22-2 36-16 40-40z" fill={ec.greenBright} opacity={0.6} />
      <Path d="M110 0c-18 4-28 14-30 30 14-4 26-14 30-30z" fill="#A5D86E" opacity={0.5} />
    </Svg>
  );
}

/** "EARTHCARE" + tagline, white on the green header or green on white. */
export function EarthcareWordmark({
  tone = 'light',
  size = 'md',
  tagline = true,
}: {
  tone?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  tagline?: boolean;
}) {
  const scale = size === 'lg' ? 1.25 : size === 'sm' ? 0.8 : 1;
  const color = tone === 'light' ? ec.white : ec.header;
  return (
    <View style={styles.wordRow}>
      <LeafMark size={30 * scale} light={tone === 'light'} />
      <View>
        <Text style={[styles.word, { color, fontSize: 22 * scale, lineHeight: 26 * scale }]}>EARTHCARE</Text>
        {tagline ? (
          <Text style={[styles.tagline, { color: tone === 'light' ? '#E3F4E1' : ec.muted, fontSize: 10.5 * scale }]}>
            Çevreye Katkı, Marmaris&apos;e Değer
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** İTK High Voltage: bolt in a ring + two-line name. */
export function ItkLogo({ size = 26, tone = 'dark' }: { size?: number; tone?: 'dark' | 'light' }) {
  const text = tone === 'dark' ? '#1D2733' : ec.white;
  return (
    <View style={styles.wordRow}>
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Circle cx={20} cy={20} r={18} fill="none" stroke={ec.sun} strokeWidth={3} />
        <Path d="M22 6L11 23h8l-3 11 13-18h-8l1-10z" fill={ec.sun} />
      </Svg>
      <View>
        <Text style={[styles.itkTop, { color: text, fontSize: size * 0.52 }]}>İTK</Text>
        <Text style={[styles.itkBottom, { color: text, fontSize: size * 0.34 }]}>HIGH VOLTAGE</Text>
      </View>
    </View>
  );
}

/** Marmaris Belediyesi: sun rising over the sea, in a circle. */
export function MarmarisMark({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Circle cx={20} cy={20} r={19} fill="#FFFFFF" stroke={ec.info} strokeWidth={1.5} />
      <Path d="M8 21a12 12 0 0 1 24 0z" fill={ec.sun} />
      <G fill="none" stroke={ec.info} strokeWidth={2.4} strokeLinecap="round">
        <Path d="M7 25c3-2 5-2 8 0s5 2 8 0 5-2 8 0 4 1 3 1" />
        <Path d="M9 30c3-2 5-2 7 0s5 2 7 0 5-2 7 0" />
      </G>
    </Svg>
  );
}

export function MarmarisBelediyesiLogo({ size = 30, tone = 'dark' }: { size?: number; tone?: 'dark' | 'light' }) {
  const text = tone === 'dark' ? ec.infoDark : ec.white;
  return (
    <View style={styles.wordRow}>
      <MarmarisMark size={size} />
      <View>
        <Text style={[styles.belTop, { color: text, fontSize: size * 0.42 }]}>MARMARİS</Text>
        <Text style={[styles.belBottom, { color: text, fontSize: size * 0.34 }]}>BELEDİYESİ</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: { fontWeight: '800', letterSpacing: 0.6 },
  tagline: { fontWeight: '500', marginTop: -1 },
  itkTop: { fontWeight: '800', lineHeight: undefined },
  itkBottom: { fontWeight: '700', letterSpacing: 0.4, marginTop: -3 },
  belTop: { fontWeight: '700', letterSpacing: 0.5 },
  belBottom: { fontWeight: '600', letterSpacing: 0.6, marginTop: -3 },
});
