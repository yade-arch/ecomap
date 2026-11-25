// Minimal translation layer: five dictionaries, one hook.
// The chosen language is remembered on the device and, for signed-in users, in their profile.
// Native localStorage (SQLite-backed) must exist before the stored language is read.
import 'expo-sqlite/localStorage/install';

import { getLocales } from 'expo-localization';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { type Language, LANGUAGES } from '@/lib/config';

import { de } from './locales/de';
import { en, type StringKey, type Strings } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { tr } from './locales/tr';

export type { StringKey } from './locales/en';

const DICTIONARIES: Record<Language, Partial<Strings>> = { tr, en, de, fr, es };
const STORAGE_KEY = 'ecomap.language';

export const LANGUAGE_NAMES: Record<Language, string> = {
  tr: 'Türkçe',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // storage not available: fall through to the device language
  }
  try {
    const device = getLocales()[0]?.languageCode;
    if (isLanguage(device)) return device;
  } catch {
    // ignore
  }
  return 'en';
}

export type Translate = (key: StringKey, params?: Record<string, string | number>) => string;

interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not fatal: the choice simply is not remembered
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dictionary = DICTIONARIES[language];
    const t: Translate = (key, params) => {
      let text: string = dictionary[key] ?? en[key] ?? key;
      if (params) {
        for (const [name, replacement] of Object.entries(params)) {
          text = text.replace(`{${name}}`, String(replacement));
        }
      }
      return text;
    };
    return { language, setLanguage, t };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}

/** Formats a date in the user's language, e.g. "10 Kas 2026 14:05". */
export function formatDateTime(iso: string, language: Language): string {
  const date = new Date(iso);
  try {
    return date.toLocaleString(language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}
