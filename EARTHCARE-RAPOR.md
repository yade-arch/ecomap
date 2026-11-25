# EARTHCARE · Anlık Puan Yönetim Sistemi — Teslim Raporu

Tarih: 25.11.2026 · Hiçbir şey uzak Supabase'e gönderilmedi, git commit'i yapılmadı.

## 000. Gizli Hazine, Eko-Ulaşım ve yalnızca kamera (son tur)

**Veritabanı** — `20261126090000_mystery_eco_enums.sql`, `20261126090100_mystery_drops_eco_mobility.sql` (yerelde test edildi, **uzak Supabase'e henüz uygulanmadı**):
- `mystery_drops` (merkez, yarıçap 50–5000 m, `multiplier` 1,5–5x veya `bonus` 5–500 EC, başlangıç/bitiş, erken sonlandırma). RPC: `muni_create_mystery_drop`, `muni_end_mystery_drop` (yalnızca municipality_admin, aksi 403). Açılışta o şehirdeki kullanıcılara uygulama içi bildirim.
- Bonus **trigger** ile: `report_reward` / `cleanup_reward` yazıldığında, katkı anında (rapor gönderimi / temizlik gönderimi) bölge içindeyse `mystery_bonus` defter kaydı ("Gizli Hazine 2x Bonusu: …"); ödül iptal edilirse bonus da iptal.
- `eco_mobility_logs` (gün × yürüyüş/bisiklet), `bike_rides`. RPC: `sync_walk_steps` (3.000 adım = +20 EC, günde ≤100 EC, zamana göre makul olmayan adım artışı kırpılır), `start_bike_ride` / `finish_bike_ride` / `cancel_bike_ride` (15 dk veya 3 km = +30 EC, günde ≤120 EC, süre sunucu saatinden, mesafe 35 km/s hızla sınırlı, 1 dk altı sayılmaz), `record_municipal_bike_ride` (belediye kiralama sistemi için, yalnızca sunucu anahtarı).
- `photo_captures`: her fotoğraf için çekim GPS'i, doğruluk, cihaz saati ve **sunucu zaman damgası** (`record_photo_capture`). Yalnızca yükleyen ve belediye personeli görür.
- Kurallar `app_config`'te (`eco.*`); realtime: `mystery_drops`, `bike_rides`, `eco_mobility_logs`.

**Uygulama**
- Harita: aktif bölgeler altın daire + ★2x simgesi; üstte "2x EcoPuan Bölgesi • Kalan Süre: 23s 45d" şeridi (dokununca bölgeye gider), canlı güncellenir.
- Belediye Paneli → **Gizli Hazine** sekmesi: haritaya dokunarak / "Konumumu kullan" ile merkez, yarıçap, çarpan veya sabit bonus, 6/12/24/48 saat, aktif & geçmiş listesi, erken sonlandırma.
- Yakındaki telefonlara yerel bildirim (`expo-notifications`): yeni bölge açıldığında cihazın son konumu bölgeye ≤3 km ise.
- EcoPuan → **Eko-Ulaşım** (menü + ana sayfa kartı): adım, km, CO₂ tasarrufu, sonraki ödüle ilerleme çubuğu, tek dokunuş izin kartı; belediye bisikleti başlat/bitir, canlı süre-mesafe, son sürüşler.
- **Yalnızca kamera:** galeri seçeneği her yerden kaldırıldı (`pickPhoto()` sadece `launchCameraAsync`); fotoğrafa çekim anındaki GPS eklenir, yüklemede sunucu zamanı kaydedilir; rapor detayında personel "Fotoğraf doğrulaması" kutusunu görür (bildirim noktasına uzaklık 300 m'yi aşarsa uyarı rengi).
- İzinler: + `NSMotionUsageDescription` / `ACTIVITY_RECOGNITION`; galeri okuma (`READ_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED`) engellendi. iOS'ta `NSPhotoLibraryUsageDescription` metni "galeriye erişmez" diye güncellendi (anahtar, App Store'un eksik amaç metni hatasını önlemek için duruyor).

**Bilinen sınırlar:** Android'de adımlar yalnızca EcoMap açıkken sayılır (Expo'nun Android adım sayarı geçmiş okuyamaz). Uygulama kapalıyken gelen gerçek push için ayrıca push token + sunucu fonksiyonu gerekir; şu an uygulama içi bildirim + uygulama açıkken/arka plandayken yerel bildirim var. Web'de kamera yerine dosya seçici açılır (tarayıcı kısıtı).

**Doğrulama:** `tsc` 0 hata · `expo-doctor` 20/20 · iOS/Android/web paketleri derlendi · `npm run test:db` **75/75** (34 yeni kontrol) · yeni dosyalarda lint 0 hata.

## 00. Arayüz temizliği + sunucu kurulumu

- **Uzak Supabase (`ecomap`, `mfrefgdqcivrxugkwikg`)**: iki EARTHCARE migration'ı uygulandı (`earthcare_points_enums`, `earthcare_points`). Doğrulama: 4 ödül, 5 RPC kurulu, puan tabloları realtime yayınında, anon puan değiştiremiyor. **`seed.sql` uzağa gönderilmedi** (bilinen şifreli test hesapları açar). Uzakta zaten 1 `manager` (municipality_admin) var.
- **Marmaris App portalı kaldırıldı** (`src/app/marmaris.tsx` silindi, hiçbir buton yönlendirmiyor). Başlıktaki "Marmaris App" alt yazısı kaldırıldı.
- **≡ (hamburger)** artık EcoMap menüsünü açıyor: Harita, Sıralama, EcoPuan, Katkı Sağla, Ödüller, Puan Geçmişi, Bildirimler, Profil.
- **Tek alt çubuk**: EARTHCARE'in ayrı sekme çubuğu kaldırıldı. Tüm EcoPuan ekranları `src/app/(tabs)/ecopuan/` altında (`index`, `contribute`, `rewards`, `history`, `redeem/[id]`); Harita · Sıralama · EcoPuan · Profil çubuğu her ekranda görünür. Yönetici detay ekranı `/points/[userId]` (Belediye Paneli başlığıyla).
- **Tasarım dili**: EARTHCARE renkleri artık `src/ui/theme.ts` (EcoMap) renklerinden türüyor; Poppins kaldırıldı, sistem yazı tipi kullanılıyor; gölgeler EcoMap kartlarıyla aynı hafiflikte.
- **Banner**: sabit yükseklik yerine çizimin kendi oranı (1.9:1, en az 150 px), metin kutusu içeriğe göre büyüyor, kesilme yok.
- **Boş daire**: web'de aynı SVG gradient id'si birden çok ekranda kullanıldığı için yaprak görünmüyordu; her SVG artık benzersiz id alıyor.
- **Bakiye senkronu**: giriş yapmış kullanıcıda bakiye/katkı sayısı EARTHCARE özeti gelene kadar `profiles` verisinden gösteriliyor; hiçbir zaman "— EC" kalmıyor. Özet ve realtime gelince canlı değerle değişiyor.

Doğrulama: `tsc` 0 hata · EARTHCARE dosyalarında lint 0 hata · web + Android derlemesi başarılı · `npm run test:db` 41/41 · tarayıcıda EcoPuan, menü, Puan Geçmişi ve Ödüller (sunucudan 4 ödül) kontrol edildi.

## 0. Birleştirme güncellemesi (EcoMap + EARTHCARE tek uygulama)

**Eski özellikler hiç silinmedi.** `map.tsx`, `leaderboard.tsx`, `municipality.tsx`, `src/municipal/MuniSection.tsx`, `report/*` ve `moderation.tsx` dosyalarının değişiklik tarihleri 11–12 Kasım; açılış rotası (`src/app/index.tsx`) hâlâ `/map`'e yönlendiriyor. Önizlemede yalnızca EARTHCARE görünmesinin sebebi, önizlemenin doğrudan `/marmaris` adresinde açılmasıydı. Bu turda iki tarafı birbirine bağladım:

| Bağlantı | Dosya |
|---|---|
| Alt sekmeler: **Harita · Sıralama · EcoPuan · Profil**. EcoPuan sekmesi EARTHCARE Ana Sayfa'sını (bakiye, istatistikler, ödüller) gösterir. | `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/ecopuan.tsx` |
| Haritadaki puan rozeti artık **canlı** EcoPuan'ı gösteriyor ve dokununca EARTHCARE modülünü açıyor | `src/app/(tabs)/map.tsx` (yalnızca rozet bloğu) |
| Orijinal **Belediye Paneli**: yöneticiler için üstte iki sekme var: **İhbar Yönetimi** (orijinal panel, aynen) ve **Vatandaş Puan Yönetimi** (canlı puan + audit log + kod doğrulama). `/municipality?section=points` ile doğrudan açılır. | `src/app/municipality.tsx`, `src/earthcare/components/points-admin-panel.tsx` |
| Canlı puan aboneliği tüm uygulamaya taşındı; harita, EcoPuan sekmesi ve EARTHCARE ekranları aynı sayıyı gösterir | `src/app/_layout.tsx` (`EcPointsRoot`) |
| Profil'deki yönetici butonu Belediye Paneli'nin puan sekmesine gider | `src/app/(tabs)/profile.tsx` |

Doğrulama: `tsc` 0 hata · web ve Android derlemesi başarılı · `npm run test:db` 41/41 · tarayıcıda `/` → Harita açılıyor, EcoPuan sekmesi çalışıyor, `/municipality` orijinal panel (giriş yapılmadığı için orijinal kilit ekranı).

## 1. Ne yapıldı

| Alan | Durum |
|---|---|
| `git init` (dal: `main`) | ✅ Commit yok. `.env`, `.netlify/` `.gitignore`'a eklendi; `credentials.json`, `credentials/`, `expo-token.txt` zaten hariç. |
| Paketler | ✅ `@expo-google-fonts/poppins`, `react-native-svg@15.16.0` (SDK 58 uyumlu, `expo install` ile), `react-native-qrcode-svg`. Geliştirme: `eslint`, `eslint-config-expo` (Expo lint kurdu), `@electric-sql/pglite` (DB testi). Sürüm çakışması çıkmadı. |
| Veritabanı | ✅ 2 migration + `supabase/seed.sql` (1 yönetici + 3 vatandaş) |
| Arayüz | ✅ Marmaris App giriş ekranı + EARTHCARE modülü (Ana Sayfa, Katkı Sağla, Ödüller, QR Kullan, Profil) + Belediye Puan Yönetim Paneli |
| Realtime | ✅ Vatandaş ve yönetici ekranları Supabase Realtime ile sayfa yenilemeden güncellenir |

## 2. Oluşturulan / değişen dosyalar

**Veritabanı**
- `supabase/migrations/20261125090000_earthcare_points_enums.sql` — yeni puan defteri türleri (`municipal_adjustment`, `municipal_set`, `reward_redeem`). Ayrı dosya, çünkü Postgres yeni enum değerini aynı transaction'da kullanmaya izin vermiyor.
- `supabase/migrations/20261125090100_earthcare_points.sql`
  - `private.is_points_admin()` → `municipal_users.role = 'manager'` veya platform admini = **municipality_admin**
  - `get_my_access()` artık `is_municipality_admin` döndürüyor
  - `points_audit_log`: yetkili ID, hedef kullanıcı ID, önceki puan, değişim (+/−), yeni puan, neden, zaman damgası. **Yalnızca eklenebilir**: trigger UPDATE/DELETE'i süper kullanıcı için bile engelliyor (yalnızca hesap silinince ID'nin `null` olmasına izin var).
  - `rewards` (4 ödül: Bisiklet 200, Halk Cafe 100, Otopark 100, Halk Ekmek 100 EC) ve `reward_redemptions` (tek kullanımlık `EC-XXXX-XXXX` kodu)
  - RPC'ler (hepsi `SECURITY DEFINER`, yetkiyi veritabanında kontrol ediyor):
    - `muni_adjust_points(user, 'add'|'subtract'|'set', amount, reason)`: satırı `FOR UPDATE` ile kilitler, defter kaydı + audit kaydı + bildirim aynı transaction'da yazılır, bakiye 0'ın altına düşemez, yönetici kendi puanını değiştiremez
    - `muni_list_citizens`, `muni_use_redemption`, `redeem_reward`, `get_my_earthcare_summary`
  - Yetkisiz çağrı → `SQLSTATE 42501` → PostgREST bunu giriş yapmış kullanıcıya **HTTP 403** olarak döner
  - RLS: vatandaş yalnızca kendi defter/audit/kod satırlarını görür, yönetici hepsini görür; istemciye hiçbir tabloda yazma izni yok
  - Realtime yayınına eklenenler: `profiles`, `points_transactions`, `points_audit_log`, `reward_redemptions`
- `supabase/seed.sql` — test hesapları (şifre dosyanın başındaki yorumda), başlangıç bakiyeleri gerçek RPC üzerinden yönetici olarak atanır, bu yüzden audit geçmişi de oluşur
- `supabase/tests/points.test.mjs` — tüm migration'ları + seed'i bellekte çalışan bir Postgres'te (PGlite) koşturup 41 kuralı test eder

**Uygulama** (`src/`)
- `app/marmaris.tsx` — Marmaris App ana ekranı (lacivert başlık, kaydırmalı görsel, 8'li servis ızgarası, EARTHCARE kartı, logolar, alt sekmeler)
- `app/earthcare/_layout.tsx` — Poppins yükleme + kullanıcıya bağlı tek bir canlı puan aboneliği
- `app/earthcare/(tabs)/` — `index` (Ana Sayfa), `contribute` (Katkı Sağla), `rewards` (Ödüller), `profile` (salt okunur Profil: rozetler, puan geçmişi, belediye işlemleri)
- `app/earthcare/redeem/[id].tsx` — QR ile ödül kullanımı (kod kullanılınca ekran canlı güncellenir)
- `app/earthcare/admin/index.tsx`, `admin/[userId].tsx` — Belediye Puan Yönetimi. 900 px üstü ekranda iki sütun (liste | düzenleyici + audit log), telefonda liste → detay. Ayrıca ödül kodu doğrulama.
- `earthcare/` — `theme.ts` (renk, radius, gölge belirteçleri), `fonts.ts`, `api.ts`, `points-context.tsx` (vatandaş realtime), `use-admin-live.ts` (yönetici realtime), `use-rewards.ts`, `strings.ts`, `types.ts`, `components/` (logolar, sahneler, ui, sekme çubuğu, admin)
- Küçük değişiklikler: `app/_layout.tsx` (2 rota), `app/(tabs)/profile.tsx` (EARTHCARE ve Belediye Puan Yönetimi butonları), `lib/types.ts` (`is_municipality_admin`), `i18n/locales/en.ts` + `tr.ts` (eksik `new.reportAnyway` anahtarı, önceden kalan tip hatası), `components/app-tabs.web.tsx` (önceden kalan tip hatası)
- `.claude/launch.json` — web önizleme sunucusu

## 3. Test sonuçları

| Kontrol | Sonuç |
|---|---|
| `npx tsc --noEmit` | ✅ 0 hata (önceden kalan 2 hata da düzeltildi) |
| `npx eslint` — EARTHCARE dosyaları | ✅ 0 hata, 0 uyarı |
| `npx eslint src` — tüm proje | ⚠️ 13 hata, 3 uyarı; **hepsi dokunulmamış eski EcoMap dosyalarında** (`providers/auth.tsx`, `map/*`, `report/*`, `municipal/MuniSection.tsx`, `(tabs)/profile.tsx:34`, `hooks/use-color-scheme.web.ts`). Projede daha önce ESLint yapılandırması yoktu; `expo lint` ilk kez kurdu ve React Compiler kuralları bu eski kalıpları işaretliyor. Davranışı değiştirme riski yüzünden bunlara dokunmadım. |
| Web derleme (`expo export --platform web`) | ✅ Başarılı |
| Android derleme (`expo export --platform android`) | ✅ Başarılı (Hermes bundle 5,3 MB) |
| `npm run test:db` (PGlite) | ✅ **41/41**: vatandaş → 403 (kendi ve başkasının puanı, liste, kod doğrulama), doğrudan UPDATE/INSERT reddi, anon reddi, ekle/düş/ata, eksiye düşmeme, zorunlu neden, kendine işlem yasağı, audit içeriği, audit'in süper kullanıcıya karşı bile değiştirilemezliği, ödül harcama/yetersiz bakiye/kod kullanımı, RLS satır izolasyonu, realtime yayın listesi, hesap silmede audit'in korunması |
| Tarayıcı (mobil 375×812) | ✅ Marmaris App, Ana Sayfa, Katkı Sağla, Ödüller ve yönetici 403 ekranı görsel olarak kontrol edildi |

### Doğrulanamayanlar (dürüst not)
- **İki ekran arası uçtan uca canlı senkronizasyon gerçek bir Supabase üzerinde test edilmedi.** Uygulama koddaki uzak projeye bağlı (`src/lib/config.ts`), migration'ı oraya göndermemem istendi, Docker/Supabase CLI de kurulu değil. SQL tarafı (yetki, audit, RLS, yayın) PGlite'ta test edildi; istemci tarafındaki realtime abonelikleri derleniyor ama canlı bir sunucuya karşı çalıştırılmadı.
- Giriş yapılmış ekranlar (bakiye, geçmiş, yönetici paneli) gerçek veriyle görüntülenmedi; aynı sebep.
- **Görseller:** Stok fotoğrafların lisanslı ve doğrudan erişilebilir dosya adreslerini güvenilir şekilde doğrulayamadım. Marmaris koyu ve park öncesi/sonrası görselleri **SVG illüstrasyon** olarak çizildi. Gerçek fotoğrafa geçmek için dosyayı `assets/earthcare/` altına koyup `<SceneImage photo={require(...)} />` vermeniz yeterli (`src/earthcare/components/scenes.tsx`).
- Renkler sıkıştırılmış ekran görüntülerinden göz kararı alındı; kesin HEX değerleri gelirse yalnızca `src/earthcare/theme.ts` değişir.
- "Toplanan Atık (kg)" gerçekten tartılmış bir değer değil; doğrulanmış temizliklerin şiddetine göre **tahmin** (`app_config` → `earthcare.kg_per_cleanup.*`).
- EARTHCARE metinleri (referanslar gibi) yalnızca Türkçe; diğer EcoMap ekranlarının çoklu dil sistemine bağlanmadı.

## 4. Çalıştırma

```powershell
npm install
```
```powershell
npm run test:db
```
```powershell
npx expo start --web
```
Tarayıcıda: `http://localhost:8081/marmaris` (giriş ekranı), `/earthcare`, `/earthcare/admin`.

**Gerçek realtime testi için** (Docker + Supabase CLI gerekir):
```powershell
npx supabase start
```
```powershell
npx supabase db reset
```
Ardından `src/lib/config.ts` içindeki URL ve anahtarı yerel değerlerle değiştirin (`npx supabase status` gösterir). Bir pencerede `yonetici@earthcare.test`, diğerinde `ayse@earthcare.test` ile giriş yapın. Yönetici panelinden puan değiştirildiğinde vatandaşın bakiyesi ve geçmişi yenilemeden güncellenir.

**Uzak projeye göndermeden önce:** `seed.sql` **yalnızca yerel içindir** (bilinen şifreli hesaplar açar). Uzakta yönetici atamak için:
`insert into municipal_users (municipality_id, user_id, role) select id, '<kullanıcı-uuid>', 'manager' from municipalities where code = 'MRM';`

## 5. Commit öncesi notlar
- Kök dizindeki `ecomap/` klasörü (eski bir kopya, `node_modules` dahil) takip edilmeyen dosyalar arasında; `git add .` yapmadan önce gerekip gerekmediğine karar verin.
- `src/lib/config.ts` içinde Supabase publishable (anon) anahtarı var; bu anahtar herkese açık olacak şekilde tasarlanmıştır, sır değildir.
