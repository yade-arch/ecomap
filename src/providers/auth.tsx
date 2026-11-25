// Who is signed in, their profile and what they are allowed to do.
import type { Session } from '@supabase/supabase-js';
import { getLocales } from 'expo-localization';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { isLanguage, useI18n } from '@/i18n';
import { fetchAccess, fetchProfile } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { Access, AppRole, Profile } from '@/lib/types';

const NO_ACCESS: Access = { roles: [], is_admin: false, is_moderator: false, is_staff: false, is_banned: false };

interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  city: string;
  roles: AppRole[];
}

interface AuthValue {
  /** false until the stored session has been read at startup */
  ready: boolean;
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  access: Access;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves to 'signed_in' or 'confirm_email' (when email confirmation is switched on). */
  signUp: (input: SignUpInput) => Promise<'signed_in' | 'confirm_email'>;
  signOut: () => Promise<void>;
  /** Re-reads profile and permissions, e.g. after points were earned. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { language, setLanguage } = useI18n();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [access, setAccess] = useState<Access>(NO_ACCESS);
  const languageRef = useRef(language);
  languageRef.current = language;
  const appliedLanguageFor = useRef<string | null>(null);

  const userId = session?.user.id ?? null;

  const load = useCallback(
    async (uid: string) => {
      try {
        const [nextProfile, nextAccess] = await Promise.all([fetchProfile(uid), fetchAccess()]);
        setProfile(nextProfile);
        setAccess(nextAccess ?? NO_ACCESS);
        // The language saved in the profile wins once per sign-in, so it follows the user to a new phone.
        if (nextProfile && appliedLanguageFor.current !== uid) {
          appliedLanguageFor.current = uid;
          if (isLanguage(nextProfile.preferred_language) && nextProfile.preferred_language !== languageRef.current) {
            setLanguage(nextProfile.preferred_language);
          }
        }
      } catch {
        // Offline or a temporary error: keep what we have, screens show their own retry.
      }
    },
    [setLanguage],
  );

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (userId) {
      void load(userId);
    } else {
      setProfile(null);
      setAccess(NO_ACCESS);
      appliedLanguageFor.current = null;
    }
  }, [userId, load]);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      session,
      userId,
      profile,
      access,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      },
      signUp: async ({ email, password, displayName, city, roles }) => {
        let country: string | null = null;
        try {
          country = getLocales()[0]?.regionCode ?? null;
        } catch {
          country = null;
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: displayName.trim(),
              city: city.trim(),
              country,
              preferred_language: languageRef.current,
              roles,
            },
          },
        });
        if (error) throw error;
        return data.session ? 'signed_in' : 'confirm_email';
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refresh: async () => {
        if (userId) await load(userId);
      },
    }),
    [ready, session, userId, profile, access, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
