// Municipality admin: live list of citizens and live audit feed.
// RLS lets only admins receive other users' ledger / audit rows; profiles are public.
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

import { fetchAudit, fetchNames, listCitizens } from './api';
import { ecErrorText } from './strings';
import type { AuditEntry, Citizen } from './types';

export function useAdminCitizens(search: string, enabled: boolean) {
  const [citizens, setCitizens] = useState<Citizen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, true>>({});
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  const load = useCallback(async (term?: string) => {
    if (!enabled) return;
    setLoading(true);
    try {
      setCitizens(await listCitizens(term ?? searchRef.current));
      setError(null);
    } catch (e) {
      setError(ecErrorText(e));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    const id = setTimeout(() => void load(search), 250);
    return () => clearTimeout(id);
  }, [search, load]);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel('ec-admin-citizens')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        const row = payload.new as Partial<Citizen> & { id: string };
        setCitizens((prev) =>
          prev.map((c) =>
            c.id === row.id
              ? {
                  ...c,
                  total_points: row.total_points ?? c.total_points,
                  display_name: row.display_name ?? c.display_name,
                  city: row.city ?? c.city,
                  last_change_at: row.total_points !== c.total_points ? new Date().toISOString() : c.last_change_at,
                }
              : c,
          ),
        );
        setFlash((f) => ({ ...f, [row.id]: true }));
        setTimeout(
          () =>
            setFlash((f) => {
              const next = { ...f };
              delete next[row.id];
              return next;
            }),
          4000,
        );
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, () => void load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'profiles' }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (id) setCitizens((prev) => prev.filter((c) => c.id !== id));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, load]);

  return { citizens, loading, error, flash, reload: load, setCitizens };
}

export function useAuditFeed(targetUserId: string | null, enabled: boolean) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveNames = useCallback(async (rows: AuditEntry[]) => {
    const ids = rows.flatMap((r) => [r.actor_id, r.target_user_id]).filter((x): x is string => !!x);
    try {
      const found = await fetchNames(ids);
      setNames((prev) => ({ ...prev, ...found }));
    } catch {
      // names are cosmetic
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetchAudit(targetUserId ?? undefined, 100)
      .then((rows) => {
        if (!active) return;
        setEntries(rows);
        setError(null);
        void resolveNames(rows);
      })
      .catch((e) => active && setError(ecErrorText(e)));

    const channel = supabase
      .channel(`ec-admin-audit-${targetUserId ?? 'all'}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'points_audit_log',
          ...(targetUserId ? { filter: `target_user_id=eq.${targetUserId}` } : {}),
        },
        (payload) => {
          const row = payload.new as AuditEntry;
          setEntries((prev) => (prev.some((x) => x.id === row.id) ? prev : [row, ...prev].slice(0, 200)));
          void resolveNames([row]);
        },
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [targetUserId, enabled, resolveNames]);

  return { entries, names, live, error };
}
