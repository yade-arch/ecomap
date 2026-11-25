# EcoMap — App Store ve Google Play Yayın Kılavuzu

Proje mağaza derlemesine hazır. Geliştirici hesaplarını aldığınızda **kod değişikliği gerekmez**; aşağıdaki komutlar yeterli.

## 0. Bir kerelik hazırlık (bilgisayarınızda)

```powershell
npm install -g eas-cli
```
```powershell
eas login
```
Expo hesabı: `high_voltage` (app.json → `owner`). EAS proje kimliği zaten bağlı.

## 1. Google Play (`.aab`)

1. **Paketi derleyin** (bulutta derlenir, 10–20 dk):
   ```powershell
   eas build --platform android --profile production
   ```
   İlk seferde imza anahtarı sorulur. İki seçenek var:
   - **Önerilen:** "Generate new keystore" → EAS saklar, kaybolma riski yok.
   - Mevcut `credentials/ecomap-release.jks` anahtarınızı kullanmak isterseniz önce `eas credentials` → Android → production → keystore yükle.
2. **Play Console** → Uygulama oluştur → paket adı `com.ecomap.app`.
3. **İlk `.aab`'yi elle yükleyin** (Google ilk sürümün API ile yüklenmesine izin vermez): Test → Dahili test → Yeni sürüm → EAS'in verdiği `.aab` dosyası.
4. Sonraki sürümler için otomatik gönderim: Play Console → Kurulum → API erişimi → hizmet hesabı oluşturup JSON anahtarını proje köküne **`google-play-service-account.json`** adıyla koyun (git'e girmez), sonra:
   ```powershell
   eas submit --platform android --profile production --latest
   ```
   Gönderim "dahili test / taslak" olarak gider; üretime Play Console'dan siz yükseltirsiniz.

## 2. Apple App Store (`.ipa`)

1. **Paketi derleyin** — Apple ID ile giriş istenir; sertifika ve provisioning profilini EAS otomatik oluşturur:
   ```powershell
   eas build --platform ios --profile production
   ```
2. **App Store Connect'e gönderin** (uygulama kaydı yoksa EAS oluşturmayı teklif eder, bundle id `com.ecomap.app`):
   ```powershell
   eas submit --platform ios --profile production --latest
   ```
3. Derleme ~15 dk sonra **TestFlight**'ta görünür → test edin → App Store Connect'te sürümü incelemeye gönderin.

> Tek komutla ikisi birden: `eas build --platform all --profile production --auto-submit`

## 3. Test derlemeleri (hesap almadan da çalışır)

| Amaç | Komut |
|---|---|
| Telefona kurulabilir test APK'sı | `eas build -p android --profile preview` |
| Geliştirme sürümü (canlı kod yenileme) | `eas build -p android --profile development` |
| iOS simülatör geliştirme sürümü | `eas build -p ios --profile development-simulator` |

## 4. Mağaza formlarında sizden istenecekler (kodla çözülemez)

- **Gizlilik politikası URL'si** — iki mağaza da zorunlu tutar (uygulama konum, fotoğraf ve e-posta topluyor).
- **Google Play "Veri güvenliği"** ve **Apple "Uygulama Gizliliği"** formları: konum (yaklaşık + hassas), fotoğraflar, e-posta, kullanıcı kimliği; hepsi uygulama işlevi için, reklam/izleme yok.
- **Hesap silme:** uygulamada var (Profil → hesabı sil). Google ayrıca bir **web bağlantısı** ister (ör. `public/` altında basit bir sayfa veya e-posta adresi).
- **Apple inceleme hesabı:** giriş gerektiren özellikler için çalışan bir demo e-posta/şifre verin.
- Ekran görüntüleri: iPhone 6.9" (1320×2868) ve Android telefon (en az 2 adet).

## 5. Bu projede yapılan mağaza hazırlıkları

- **İkonlar:** Expo şablon ikonları (mavi "A") EcoMap ikonuyla değiştirildi — `icon.png` 1024×1024 şeffaflıksız (Apple şartı), Android uyarlanabilir ön/arka/monokrom katmanlar, açılış ekranı ve favicon. Şablondaki `assets/expo.icon` kaldırıldı.
- **İzin metinleri:** Türkçe (varsayılan) + İngilizce (`locales/tr.json`, `locales/en.json`); konum, kamera, galeri. "Her zaman konum" anahtarları Apple'ın "eksik amaç metni" hatasını önlemek için gerçek davranışı açıklıyor (konum yalnızca uygulama açıkken).
- **Gereksiz izinler engellendi:** mikrofon, arka plan konumu, hareket sensörü, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_VIDEO/AUDIO`.
  `READ_MEDIA_IMAGES` **bilerek eklenmedi:** Android 13+ sistem fotoğraf seçicisi izin istemez; bu izni bildirmek Google Play'in fotoğraf izni politikası beyanını tetikler ve red sebebidir.
- **Şifreleme beyanı:** `ITSAppUsesNonExemptEncryption = false` (her yüklemede sorulan ihracat sorusu çıkmaz).
- **Sürüm numaraları:** `version` = `1.0.0` (app.json). `buildNumber`/`versionCode` **EAS sunucusunda** tutulur ve her production derlemede otomatik artar (`appVersionSource: remote` + `autoIncrement`) — elle değiştirmenize gerek yok. Yeni mağaza sürümünde yalnızca `version`'ı artırın (ör. `1.0.1`).
- **eas.json:** `development`, `development-simulator`, `preview` (APK / iOS ad-hoc), `production` (`.aab` + App Store) ve `submit.production`.
- **Mobil uyumluluk:** web'e özel kod yok (tüm `window` kullanımları web korumalı veya harita WebView'ının içinde); `localStorage` mobilde SQLite tabanlı Expo uygulamasıyla çalışır. Harita Google Maps anahtarı gerektirmez (WebView + OpenStreetMap).
- **UX:** form ekranlarında iOS klavyesi alanları kapatmaz (`automaticallyAdjustKeyboardInsets`), Android'de `resize`; yeşil başlıklı EcoPuan ekranlarında durum çubuğu ikonları beyaz.
- **Doğrulama:** `expo-doctor` 20/20 · `tsc` 0 hata · iOS, Android ve web paketleri derlendi · `npm run test:db` 41/41.

## 6. Bilmeniz gerekenler

- **Paket adı `com.ecomap.app`** (önceki APK derlemeleriyle aynı). Farklı bir ad isterseniz (ör. `com.itkhighvoltage.ecomap`) **ilk mağaza yüklemesinden önce** `app.json`'da `ios.bundleIdentifier` ve `android.package`'ı değiştirin; yüklemeden sonra değiştirilemez. Google Play'de adın başka bir uygulamada kullanılmadığı ilk yüklemede doğrulanır.
- **Harita karoları** OpenStreetMap'in genel sunucusundan geliyor; OSM yüksek trafikli uygulamalar için kendi karo sağlayıcınızı (ör. MapTiler, Stadia) önerir. Yayın sonrası kullanıcı sayısı artarsa `src/map/PollutionMap.tsx` içindeki karo adresi değiştirilmeli.
- **Bu bilgisayarda gerçek cihaz testi yapılmadı** (iOS/Android emülatörü yok). Kamera, konum ve QR akışları kodda mobil yollarıyla doğru; `preview` APK'sı ile bir Android telefonda ve TestFlight ile bir iPhone'da mutlaka deneyin.
