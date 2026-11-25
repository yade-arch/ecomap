// Illustrated scenes used where the references show photos (bay view, park before/after).
// They scale to any box (slice, like `cover`). To use real photos instead, pass `photo`
// to <SceneImage>, e.g. require('@/assets/earthcare/marmaris-bay.jpg').
import { Image, type ImageSource } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useSvgId } from './logos';

export type SceneName = 'bay' | 'parkBefore' | 'parkAfter';

function Bay() {
  const sky = useSvgId('sky');
  const sea = useSvgId('sea');
  const houses = [
    [208, 118], [222, 112], [236, 120], [250, 110], [264, 116], [278, 108], [292, 114], [306, 106],
    [320, 112], [334, 104], [348, 110], [362, 102], [190, 124], [176, 128],
  ];
  const boats = [
    [40, 168, 1], [78, 176, 0.9], [118, 170, 1.1], [160, 180, 0.8], [300, 172, 1], [340, 178, 0.9], [250, 186, 0.7],
  ];
  return (
    <>
      <Defs>
        <LinearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#6FB6E8" />
          <Stop offset="1" stopColor="#D6EEFA" />
        </LinearGradient>
        <LinearGradient id={sea} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1C9BC0" />
          <Stop offset="1" stopColor="#0B6E99" />
        </LinearGradient>
      </Defs>
      <Rect width={400} height={220} fill={`url(#${sky})`} />
      <Ellipse cx={80} cy={40} rx={40} ry={10} fill="#FFFFFF" opacity={0.7} />
      <Ellipse cx={300} cy={30} rx={50} ry={9} fill="#FFFFFF" opacity={0.6} />
      <Path d="M0 110 L60 70 L120 92 L190 58 L260 84 L330 52 L400 80 L400 140 L0 140Z" fill="#5E8F5A" />
      <Path d="M0 124 L70 96 L150 112 L230 88 L310 104 L400 92 L400 150 L0 150Z" fill="#3F7A43" />
      <Path d="M170 138 L400 118 L400 150 L170 150Z" fill="#6E9A64" />
      {houses.map(([x, y], i) => (
        <G key={i}>
          <Rect x={x} y={y + 10} width={11} height={9} fill="#FFFFFF" />
          <Path d={`M${x - 1} ${y + 10} L${x + 5.5} ${y + 5} L${x + 12} ${y + 10}Z`} fill="#D9774B" />
        </G>
      ))}
      <Rect y={140} width={400} height={80} fill={`url(#${sea})`} />
      <Path d="M0 152 Q50 148 100 152 T200 152 T300 152 T400 152" stroke="#FFFFFF" strokeOpacity={0.25} fill="none" />
      <Path d="M0 196 Q50 192 100 196 T200 196 T300 196 T400 196" stroke="#FFFFFF" strokeOpacity={0.2} fill="none" />
      {boats.map(([x, y, s], i) => (
        <G key={i}>
          <Path d={`M${x - 14 * s} ${y} L${x + 14 * s} ${y} L${x + 9 * s} ${y + 6 * s} L${x - 9 * s} ${y + 6 * s}Z`} fill="#FFFFFF" />
          <Rect x={x - 0.6} y={y - 26 * s} width={1.4} height={26 * s} fill="#F5F5F5" />
          <Path d={`M${x + 1} ${y - 24 * s} L${x + 12 * s} ${y - 3} L${x + 1} ${y - 3}Z`} fill="#FFFFFF" opacity={0.85} />
        </G>
      ))}
      <Path d="M0 214 L0 160 Q30 150 40 170 Q48 186 30 214Z" fill="#2F5E2F" opacity={0.85} />
    </>
  );
}

function Park({ litter }: { litter: boolean }) {
  const psky = useSvgId('psky');
  return (
    <>
      <Defs>
        <LinearGradient id={psky} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#CFE8F7" />
          <Stop offset="1" stopColor="#F1F8E9" />
        </LinearGradient>
      </Defs>
      <Rect width={400} height={220} fill={`url(#${psky})`} />
      {[30, 110, 200, 290, 360].map((x, i) => (
        <G key={i}>
          <Rect x={x - 3} y={60} width={6} height={60} fill="#6D4C41" />
          <Circle cx={x} cy={52} r={30 + (i % 2) * 6} fill={i % 2 ? '#4E8B3A' : '#5C9E45'} />
          <Circle cx={x - 14} cy={64} r={18} fill="#3F7A2F" opacity={0.8} />
        </G>
      ))}
      <Rect y={112} width={400} height={108} fill={litter ? '#7DAF4E' : '#86C04F'} />
      <Path d="M150 220 Q190 160 230 112 L250 112 Q220 160 210 220Z" fill="#D8C9A3" opacity={0.7} />
      {[...Array(30)].map((_, i) => (
        <Path key={i} d={`M${(i * 37) % 400} ${130 + ((i * 53) % 85)} l3 -7 l3 7`} stroke="#5E9A3A" strokeWidth={1.4} fill="none" />
      ))}
      {litter ? (
        <G>
          {[[60, 160], [96, 182], [140, 150], [260, 170], [300, 150], [330, 190], [190, 196], [80, 205]].map(([x, y], i) => (
            <G key={i} transform={`rotate(${(i * 47) % 90 - 45} ${x} ${y})`}>
              <Rect x={x - 10} y={y - 4} width={20} height={8} rx={3} fill={i % 3 === 0 ? '#E3F2FD' : '#B3E5FC'} opacity={0.95} />
              <Rect x={x + 10} y={y - 2} width={4} height={4} fill="#1E88E5" />
            </G>
          ))}
          <Path d="M210 150 q14 -10 26 0 q4 14 -12 16 q-16 -2 -14 -16z" fill="#ECEFF1" />
          <Path d="M110 196 q10 -8 20 0 q2 10 -10 12 q-12 -2 -10 -12z" fill="#CFD8DC" />
          <Rect x={276} y={186} width={14} height={9} rx={2} fill="#FFCC80" />
          <Rect x={40} y={180} width={12} height={8} rx={2} fill="#EF9A9A" />
        </G>
      ) : (
        <G>
          <Rect x={300} y={150} width={60} height={6} rx={2} fill="#8D6E63" />
          <Rect x={304} y={156} width={4} height={14} fill="#6D4C41" />
          <Rect x={352} y={156} width={4} height={14} fill="#6D4C41" />
          <Circle cx={70} cy={170} r={4} fill="#FFEB3B" />
          <Circle cx={90} cy={190} r={3} fill="#F48FB1" />
          <Circle cx={250} cy={196} r={3.5} fill="#FFFFFF" />
        </G>
      )}
    </>
  );
}

export function Scene({ name, style }: { name: SceneName; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.fill, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice">
        {name === 'bay' ? <Bay /> : <Park litter={name === 'parkBefore'} />}
      </Svg>
    </View>
  );
}

/** A picture box: real photo when given (uri or require), otherwise the illustrated scene. */
export function SceneImage({
  scene,
  photo,
  style,
  children,
}: {
  scene: SceneName;
  photo?: ImageSource | string | number | null;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <View style={[styles.box, style]}>
      <Scene name={scene} style={StyleSheet.absoluteFill} />
      {photo ? <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  box: { overflow: 'hidden', position: 'relative' },
});
