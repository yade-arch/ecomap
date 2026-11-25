// Municipality admin building blocks: citizen list, points editor, audit log list.
// Shown only to municipality admins; every action is re-checked by muni_adjust_points() (403 otherwise).
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adjustPoints } from '../api';
import { OPERATION_LABEL, REASON_PRESETS, dateTime, ecErrorText, relativeTime } from '../strings';
import { cardShadow, ec, ecRadius, formatPoints } from '../theme';
import type { AuditEntry, Citizen, PointsOperation } from '../types';
import { EcNotice, PrimaryButton } from './ui';

function Initials({ name, size = 40 }: { name: string; size?: number }) {
  const text = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Citizen list
// ---------------------------------------------------------------------------
export function CitizenRow({
  citizen,
  selected,
  flashing,
  onPress,
}: {
  citizen: Citizen;
  selected?: boolean;
  /** true for a few seconds after a live update of this citizen */
  flashing?: boolean;
  onPress: () => void;
}) {
  const recent = !!flashing;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${citizen.display_name}, ${citizen.total_points} EcoPuan`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.citizen,
        selected && styles.citizenSelected,
        recent && styles.citizenFlash,
        pressed && { opacity: 0.88 },
      ]}>
      <Initials name={citizen.display_name} />
      <View style={styles.flex}>
        <Text style={styles.citizenName} numberOfLines={1}>
          {citizen.display_name}
        </Text>
        <Text style={styles.citizenMeta} numberOfLines={1}>
          {citizen.city ?? 'Şehir yok'} · {citizen.reports_count + citizen.cleans_count} katkı
          {citizen.last_change_at ? ` · ${relativeTime(citizen.last_change_at)}` : ''}
        </Text>
      </View>
      <View style={styles.pointsPill}>
        <Text style={styles.pointsText}>{formatPoints(citizen.total_points)}</Text>
        <Text style={styles.pointsUnit}>EC</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={ec.muted} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Points editor
// ---------------------------------------------------------------------------
const QUICK = [10, 50, 100, 250];

export function PointsEditor({ citizen, onApplied }: { citizen: Citizen; onApplied?: (newPoints: number) => void }) {
  const [op, setOp] = useState<PointsOperation>('add');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const amount = Number.parseInt(amountText.replace(/\D/g, ''), 10);
  const valid = Number.isFinite(amount) && (op === 'set' ? amount >= 0 : amount > 0) && amount <= 100000;
  const preview = !valid
    ? null
    : op === 'add'
      ? citizen.total_points + amount
      : op === 'subtract'
        ? citizen.total_points - amount
        : amount;
  const negative = preview != null && preview < 0;
  const canApply = valid && !negative && reason.trim().length >= 3 && !busy;

  const apply = async () => {
    if (!canApply) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await adjustPoints({ userId: citizen.id, operation: op, amount, reason: reason.trim() });
      setNotice({
        tone: 'success',
        text: `${citizen.display_name}: ${formatPoints(res.previous_points)} → ${formatPoints(res.new_points)} EC (${res.delta >= 0 ? '+' : ''}${formatPoints(res.delta)}). İşlem kaydedildi.`,
      });
      setAmountText('');
      setReason('');
      onApplied?.(res.new_points);
    } catch (e) {
      setNotice({ tone: 'danger', text: ecErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.editor}>
      <View style={styles.editorHead}>
        <Initials name={citizen.display_name} size={48} />
        <View style={styles.flex}>
          <Text style={styles.editorName}>{citizen.display_name}</Text>
          <Text style={styles.citizenMeta}>{citizen.city ?? '—'}</Text>
        </View>
        <View style={styles.current}>
          <Text style={styles.currentLabel}>Mevcut</Text>
          <Text style={styles.currentValue}>{formatPoints(citizen.total_points)} EC</Text>
        </View>
      </View>

      <View style={styles.segment} accessibilityRole="tablist">
        {(['add', 'subtract', 'set'] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: op === k }}
            onPress={() => setOp(k)}
            style={[styles.segBtn, op === k && styles.segBtnOn]}>
            <Ionicons
              name={k === 'add' ? 'add-circle-outline' : k === 'subtract' ? 'remove-circle-outline' : 'create-outline'}
              size={16}
              color={op === k ? (k === 'subtract' ? ec.danger : ec.green) : ec.muted}
            />
            <Text style={[styles.segText, op === k && { color: k === 'subtract' ? ec.danger : ec.green, fontWeight: '600' }]}>
              {OPERATION_LABEL[k]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>{op === 'set' ? 'Yeni puan değeri' : 'Puan miktarı'}</Text>
      <TextInput
        value={amountText}
        onChangeText={(v) => setAmountText(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        placeholder={op === 'set' ? 'Örn. 500' : 'Örn. 50'}
        placeholderTextColor="#9AA79E"
        style={styles.input}
        accessibilityLabel="Puan miktarı"
      />
      {op !== 'set' ? (
        <View style={styles.chips}>
          {QUICK.map((q) => (
            <Pressable key={q} onPress={() => setAmountText(String(q))} style={[styles.chip, amount === q && styles.chipOn]}>
              <Text style={[styles.chipText, amount === q && styles.chipTextOn]}>
                {op === 'add' ? '+' : '−'}
                {q}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={styles.label}>İşlem açıklaması / nedeni</Text>
      <TextInput
        value={reason}
        onChangeText={(v) => setReason(v.slice(0, 200))}
        placeholder="Örn. Geri dönüşüm katkısı"
        placeholderTextColor="#9AA79E"
        style={styles.input}
        accessibilityLabel="İşlem nedeni"
      />
      <View style={styles.chips}>
        {REASON_PRESETS.map((r) => (
          <Pressable key={r} onPress={() => setReason(r)} style={[styles.chip, reason === r && styles.chipOn]}>
            <Text style={[styles.chipText, reason === r && styles.chipTextOn]}>{r}</Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.preview, negative && { backgroundColor: ec.dangerSoft }]}>
        <Text style={styles.previewLabel}>Önizleme</Text>
        <Text style={[styles.previewValue, negative && { color: ec.danger }]}>
          {formatPoints(citizen.total_points)} → {preview == null ? '…' : formatPoints(preview)} EC
        </Text>
        {negative ? <Text style={styles.previewWarn}>Bakiye sıfırın altına düşemez.</Text> : null}
      </View>

      {notice ? <EcNotice tone={notice.tone} text={notice.text} /> : null}

      <PrimaryButton
        label={op === 'add' ? 'Puanı Ekle' : op === 'subtract' ? 'Puanı Düş' : 'Değeri Ata'}
        icon="checkmark-circle-outline"
        tone={op === 'subtract' ? 'danger' : 'green'}
        onPress={() => void apply()}
        loading={busy}
        disabled={!canApply}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export function AuditList({
  entries,
  names,
  showTarget = true,
  emptyText = 'Henüz işlem kaydı yok.',
}: {
  entries: AuditEntry[];
  names: Record<string, string>;
  showTarget?: boolean;
  emptyText?: string;
}) {
  if (entries.length === 0) return <Text style={styles.empty}>{emptyText}</Text>;
  return (
    <View style={{ gap: 8 }}>
      {entries.map((e) => (
        <View key={e.id} style={styles.audit}>
          <View style={[styles.auditDelta, { backgroundColor: e.delta > 0 ? ec.mint : e.delta < 0 ? ec.dangerSoft : '#F0F0F0' }]}>
            <Text style={[styles.auditDeltaText, { color: e.delta > 0 ? ec.green : e.delta < 0 ? ec.danger : ec.muted }]}>
              {e.delta > 0 ? '+' : ''}
              {formatPoints(e.delta)}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.auditTitle} numberOfLines={2}>
              {OPERATION_LABEL[e.operation]} · {e.reason}
            </Text>
            <Text style={styles.auditMeta}>
              {showTarget ? `${(e.target_user_id && names[e.target_user_id]) || 'Silinmiş kullanıcı'} · ` : ''}
              {formatPoints(e.previous_points)} → {formatPoints(e.new_points)} EC
            </Text>
            <Text style={styles.auditMeta}>
              Yetkili: {(e.actor_id && names[e.actor_id]) || '—'} · {dateTime(e.created_at)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function Forbidden() {
  return (
    <View style={styles.forbidden}>
      <Ionicons name="lock-closed" size={40} color={ec.danger} />
      <Text style={styles.forbiddenTitle}>403 · Erişim yok</Text>
      <Text style={styles.forbiddenText}>Bu sayfa yalnızca belediye yetkililerine (municipality_admin) açıktır.</Text>
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator color={ec.green} style={{ marginTop: 24 }} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  avatar: { backgroundColor: ec.green, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: ec.white },
  citizen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: ec.card,
    borderRadius: ecRadius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: ec.line,
  },
  citizenSelected: { borderColor: ec.green, borderWidth: 1.5, backgroundColor: '#F6FBF6' },
  citizenFlash: { backgroundColor: '#E3F5E4' },
  citizenName: { fontWeight: '600', color: ec.ink, fontSize: 14.5 },
  citizenMeta: { fontWeight: '400', color: ec.muted, fontSize: 12 },
  pointsPill: { flexDirection: 'row', alignItems: 'baseline', gap: 3, backgroundColor: ec.mint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pointsText: { fontWeight: '700', color: ec.green, fontSize: 14 },
  pointsUnit: { fontWeight: '600', color: ec.green, fontSize: 10 },

  editor: { gap: 10, backgroundColor: ec.card, borderRadius: ecRadius.lg, padding: 16, borderWidth: 1, borderColor: ec.line, ...cardShadow },
  editorHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  editorName: { fontWeight: '700', color: ec.ink, fontSize: 17 },
  current: { alignItems: 'flex-end' },
  currentLabel: { fontWeight: '400', color: ec.muted, fontSize: 11 },
  currentValue: { fontWeight: '800', color: ec.header, fontSize: 20 },
  segment: { flexDirection: 'row', backgroundColor: ec.mint, borderRadius: 12, padding: 4 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, borderRadius: 9 },
  segBtnOn: { backgroundColor: ec.white, ...cardShadow },
  segText: { fontWeight: '500', color: ec.muted, fontSize: 12.5 },
  label: { fontWeight: '600', color: ec.text, fontSize: 13, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: ec.mintBorder,
    borderRadius: ecRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontWeight: '500',
    fontSize: 15,
    color: ec.ink,
    backgroundColor: '#FBFDFB',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: ec.mintBorder, backgroundColor: ec.white },
  chipOn: { backgroundColor: ec.green, borderColor: ec.green },
  chipText: { fontWeight: '500', color: ec.text, fontSize: 12 },
  chipTextOn: { color: ec.white },
  preview: { backgroundColor: ec.mint, borderRadius: ecRadius.md, padding: 12, marginTop: 4 },
  previewLabel: { fontWeight: '500', color: ec.muted, fontSize: 11.5 },
  previewValue: { fontWeight: '700', color: ec.header, fontSize: 18 },
  previewWarn: { fontWeight: '500', color: ec.danger, fontSize: 12 },

  audit: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: ec.card,
    borderRadius: ecRadius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: ec.line,
  },
  auditDelta: { minWidth: 58, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  auditDeltaText: { fontWeight: '700', fontSize: 14 },
  auditTitle: { fontWeight: '600', color: ec.ink, fontSize: 13 },
  auditMeta: { fontWeight: '400', color: ec.muted, fontSize: 11.5 },
  empty: { fontWeight: '400', color: ec.muted, textAlign: 'center', paddingVertical: 12 },

  forbidden: { alignItems: 'center', gap: 8, padding: 32 },
  forbiddenTitle: { fontWeight: '700', color: ec.danger, fontSize: 20 },
  forbiddenText: { fontWeight: '400', color: ec.text, fontSize: 14, textAlign: 'center' },
});
