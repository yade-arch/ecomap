# EcoMap

Çevre kirliliğini bildirme ve temizlik organize etme uygulaması.
Fotoğraf + konum → yapay zekâ tür ve şiddet belirler → haritada işaret → sohbet → gönüllüler temizler → "sonra" fotoğrafı → doğrulama → puan → sıralama.

Teknoloji: React Native + Expo (SDK 58) + TypeScript + Supabase (veritabanı, giriş, depolama, canlı güncelleme, sunucu fonksiyonu) + Gemini (fotoğraf analizi).

## Çalıştırma

```
npm install
npx expo start
```

- Android telefon: Play Store'dan **Expo Go** kur, ekrandaki QR kodu Expo Go ile okut (telefon ve bilgisayar aynı Wi-Fi'da olmalı).
- Tarayıcı: `npx expo start --web`

`.env` dosyasındaki iki değer herkese açık değerlerdir (uygulamanın içinde durması güvenlidir).

## Gizli anahtarlar

Gizli anahtarlar **asla** uygulamaya veya bu klasöre yazılmaz. Sadece şuraya girilir:
Supabase paneli → Edge Functions → Secrets

| İsim | Zorunlu mu | Ne işe yarar |
| --- | --- | --- |
| `GEMINI_API_KEY` | Evet (yapay zekâ için) | Google AI Studio'dan alınan anahtar |
| `GEMINI_MODEL` | Hayır | Sırayla denenecek model adları (virgülle) |

Anahtar yoksa ya da ücretsiz kota bittiyse uygulama hata vermez: kullanıcıya şiddeti (az / orta / yüksek) sorar, puanı ona göre verir, yapay zekâ geri gelince bildirimi tekrar kontrol eder.

## Klasörler

| Klasör | İçerik |
| --- | --- |
| `src/app` | Ekranlar (harita, sıralama, profil, bildirim, giriş, moderasyon) |
| `src/lib` | Sunucu çağrıları, fotoğraf, konum, hata metinleri |
| `src/map` | Harita bileşeni (telefon: Google/Apple harita, tarayıcı: OpenStreetMap) |
| `src/i18n` | 5 dil: Türkçe, İngilizce, Almanca, Fransızca, İspanyolca |
| `src/ui` | Renkler ve ortak düğme / kutu bileşenleri |
| `supabase/migrations` | Veritabanı: tablolar, kurallar (RLS), fonksiyonlar |
| `supabase/functions/ecomap-api` | Sunucu fonksiyonu: fotoğrafı yapay zekâya sorar, puanı sunucuda verir |

## Güvenlik kuralları (kısaca)

- Puanı telefon değil **sunucu** verir. Her puan `points_transactions` tablosunda kayıtlıdır.
- Aynı bildirim ya da temizlik için iki kez puan verilemez.
- Kişi kendi bildirdiği yeri temizlerse otomatik onay olmaz, moderatör bakar.
- Moderatör kendi bildirimini ya da kendi temizliğini onaylayamaz.
- Tehlikeli atık (kimyasal, tıbbi vb.) gönüllü temizliğine kapalıdır.

## Moderatör / yönetici yapma

Kullanıcı önce uygulamadan kayıt olur. Sonra Supabase paneli → SQL Editor:

```sql
insert into public.staff_roles (user_id, role)
select id, 'admin' from auth.users where email = 'KULLANICININ-EPOSTASI';
```

Bundan sonra Profil ekranında "Moderasyon" düğmesi görünür.

## Kontrol komutları

```
npm run typecheck
npx expo export --platform android
```
