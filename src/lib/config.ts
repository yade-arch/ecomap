// Public configuration read from .env (see .env.example). Nothing secret belongs here.
export const SUPABASE_URL = 'https://mfrefgdqcivrxugkwikg.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mcmVmZ2RxY2l2cnh1Z2t3aWtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyMjMyODEsImV4cCI6MjEwOTc5OTI4MX0.REdkCngD4HXjH19shnTT0YUTWCa8kyL0e4PJCTNetVE';
export const isConfigured = SUPABASE_URL.startsWith('http') && SUPABASE_PUBLISHABLE_KEY.length > 10;

export const LANGUAGES = ['tr', 'en', 'de', 'fr', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Longest side of an uploaded photo, in pixels. Keeps uploads small on mobile data. */
export const MAX_PHOTO_SIDE = 1600;
export const PHOTO_QUALITY = 0.75;

/** Turkish cities for profile city picker. */
export const TR_CITIES = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya',
  'Ardahan', 'Artvin', 'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik',
  'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum',
  'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir',
  'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul',
  'İzmir', 'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kilis',
  'Kırıkkale', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa',
  'Mardin', 'Mersin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye', 'Rize',
  'Sakarya', 'Samsun', 'Şanlıurfa', 'Siirt', 'Sinop', 'Şırnak', 'Sivas', 'Tekirdağ',
  'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak',
] as const;

export type TrCity = (typeof TR_CITIES)[number];
