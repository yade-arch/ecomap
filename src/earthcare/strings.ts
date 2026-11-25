// EARTHCARE is a Marmaris (Turkish) module, so its copy is Turkish, as in the references.
import type { LedgerType, PointsOperation } from './types';

const ERRORS: Record<string, string> = {
  not_authenticated: 'Lütfen önce giriş yapın.',
  not_allowed: 'Bu işlem için yetkiniz yok (403).',
  cannot_adjust_own_points: 'Kendi puanınızı değiştiremezsiniz.',
  invalid_operation: 'Geçersiz işlem türü.',
  invalid_amount: 'Lütfen geçerli bir puan miktarı girin.',
  reason_required: 'Lütfen işlem açıklaması / nedeni girin (en az 3 karakter).',
  user_not_found: 'Kullanıcı bulunamadı.',
  insufficient_points: 'Yetersiz EcoPuan bakiyesi.',
  reward_not_found: 'Bu ödül artık kullanılamıyor.',
  rate_limited: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.',
  banned: 'Hesabınız bu işlem için engellendi.',
  code_not_found: 'Kod bulunamadı.',
  too_far: 'Bildirim konumuna çok uzaksınız.',
  activist_role_required: 'Katkı göndermek için profilinizde Aktivist rolünü açın.',
  observer_role_required: 'Bildirim göndermek için profilinizde Gözlemci rolünü açın.',
  photo_missing: 'Fotoğraf yüklenemedi. Lütfen tekrar deneyin.',
  network_error: 'Bağlantı yok. İnternetinizi kontrol edin.',
  camera_denied: 'Kamera izni kapalı. Ayarlardan açabilirsiniz.',
  invalid_reward: 'Geçersiz ödül: çarpan 1,5–5x, sabit bonus 5–500 EC olmalı.',
  invalid_duration: 'Süre 1 ile 168 saat arasında olmalı.',
  drop_not_active: 'Bu bölge zaten sona ermiş.',
  invalid_bike_code: 'Geçerli bir bisiklet numarası girin (ör. MRM-042).',
  ride_not_active: 'Bu sürüş artık aktif değil.',
  invalid_steps: 'Adım sayısı okunamadı.',
};

export function ecErrorText(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; sqlState?: unknown };
  const keys = [e.code, e.message, e.sqlState].filter((x): x is string => typeof x === 'string');
  for (const k of keys) if (ERRORS[k]) return ERRORS[k];
  if (e.sqlState === '42501') return ERRORS.not_allowed;
  const text = keys.join(' ').toLowerCase();
  if (text.includes('network') || text.includes('failed to fetch')) return ERRORS.network_error;
  if (
    text.includes('does not exist') ||
    text.includes('could not find the function') ||
    text.includes('could not find the table') ||
    text.includes('pgrst202') ||
    text.includes('pgrst205')
  )
    return 'Sunucuda EARTHCARE puan modülü henüz kurulu değil (migration uygulanmalı).';
  return 'Bir şeyler ters gitti. Lütfen tekrar deneyin.';
}

export const OPERATION_LABEL: Record<PointsOperation, string> = {
  add: 'Puan Ekle',
  subtract: 'Puan Düş',
  set: 'Değer Ata',
};

export const LEDGER_LABEL: Record<LedgerType, string> = {
  report_reward: 'Çevresel bildirim ödülü',
  cleanup_reward: 'Temizlik katkısı ödülü',
  adjustment: 'Puan düzeltmesi',
  reversal: 'Puan iadesi / iptal',
  municipal_adjustment: 'Belediye puan işlemi',
  municipal_set: 'Belediye puan ataması',
  reward_redeem: 'Ödül kullanımı',
};

/** Ready-made reasons for the admin editor (free text is also allowed). */
export const REASON_PRESETS = [
  'Geri dönüşüm katkısı',
  'Etkinlik katılımı',
  'Sahil temizliği',
  'Ağaçlandırma gönüllülüğü',
  'Hatalı kayıt düzeltmesi',
] as const;

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'şimdi';
  if (min < 60) return `${min} dk önce`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
