// One live view of the signed-in citizen's EcoPuan, shared by every EARTHCARE screen.
// Initial values are read once; after that Supabase Realtime pushes every change
// (an admin adjustment, a reward, a redemption) so no screen needs a reload.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth';

import { fetchAudit, fetchMyLedger, fetchSummary } from './api';
import { ecErrorText } from './strings';
import type { AuditEntry, EcSummary, LedgerEntry } from './types';

interface PointsValue {
  /** null until loaded (or when signed out) */
  balance: number | null;
  summary: EcSummary | null;
  ledger: LedgerEntry[];
  audit: AuditEntry[];
  /** last change pushed by Realtime, for the "+50 EC" flash on the balance card */
  lastChange: { delta: number; reason: string; at: number } | null;
  live: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const PointsContext = createContext<PointsValue | null>(null);

export function EcPointsProvider({ children }: { children: ReactNode }) {
  const { userId, profile, refresh } = useAuth();
  // Starts from the cached profile total so the first paint already shows a number.
  const [balance, setBalance] = useState<number | null>(() => (userId ? (profile?.total_points ?? null) : null));
  const [summary, setSummary] = useState<EcSummary | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [lastChange, setLastChange] = useState<PointsValue['lastChange']>(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(!!userId);
  const [error, setError] = useState<string | null>(null);
  const summaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const next = await fetchSummary();
      if (next) {
        setSummary(next);
        setBalance(next.total_points);
      }
    } catch (e) {
      setError(ecErrorText(e));
    }
  }, []);

  const fetchLists = useCallback(async () => {
    if (!userId) return;
    try {
      const [l, a] = await Promise.all([fetchMyLedger(userId), fetchAudit(userId, 50)]);
      setLedger(l);
      setAudit(a);
      setError(null);
    } catch (e) {
      setError(ecErrorText(e));
    }
    await loadSummary();
    setLoading(false);
  }, [userId, loadSummary]);

  const reload = useCallback(async () => {
    setLoading(true);
    await fetchLists();
  }, [fetchLists]);

  // The summary has derived numbers (rank, counts); refresh it shortly after a burst of changes.
  const scheduleSummary = useCallback(() => {
    if (summaryTimer.current) clearTimeout(summaryTimer.current);
    summaryTimer.current = setTimeout(() => void loadSummary(), 400);
  }, [loadSummary]);

  // The provider is keyed by user id (see EcPointsRoot below), so a new user starts fresh.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    Promise.all([fetchMyLedger(userId), fetchAudit(userId, 50), fetchSummary()])
      .then(([l, a, sum]) => {
        if (!active) return;
        setLedger(l);
        setAudit(a);
        if (sum) {
          setSummary(sum);
          setBalance(sum.total_points);
        }
        setError(null);
      })
      .catch((e: unknown) => active && setError(ecErrorText(e)))
      .finally(() => active && setLoading(false));

    const channel: RealtimeChannel = supabase
      .channel(`ec-points-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, (payload) => {
        const next = (payload.new as { total_points?: number }).total_points;
        if (typeof next === 'number') setBalance(next);
        scheduleSummary();
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'points_transactions', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as LedgerEntry;
          setLedger((prev) => (prev.some((x) => x.id === row.id) ? prev : [row, ...prev]));
          setLastChange({ delta: row.points, reason: row.reason ?? '', at: Date.now() });
          scheduleSummary();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'points_audit_log', filter: `target_user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as AuditEntry;
          setAudit((prev) => (prev.some((x) => x.id === row.id) ? prev : [row, ...prev]));
          setBalance(row.new_points);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reward_redemptions', filter: `user_id=eq.${userId}` },
        () => scheduleSummary(),
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    return () => {
      active = false;
      if (summaryTimer.current) clearTimeout(summaryTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [userId, scheduleSummary]);

  // Keep the shared auth profile (used by older EcoMap screens) in step too.
  useEffect(() => {
    if (lastChange) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastChange?.at]);

  // Until the EARTHCARE summary arrives (or if it cannot be read), show the signed-in user's
  // profile numbers, so a signed-in user never sees "— EC".
  const effectiveBalance = balance ?? (userId ? (profile?.total_points ?? null) : null);
  const effectiveSummary = useMemo<EcSummary | null>(() => {
    if (summary) return summary;
    if (!userId || !profile) return null;
    return {
      total_points: profile.total_points,
      rank: null,
      contributions: profile.reports_count + profile.cleans_count,
      waste_kg: 0,
      rewards_used: 0,
    };
  }, [summary, userId, profile]);

  const value = useMemo<PointsValue>(
    () => ({ balance: effectiveBalance, summary: effectiveSummary, ledger, audit, lastChange, live, loading, error, reload }),
    [effectiveBalance, effectiveSummary, ledger, audit, lastChange, live, loading, error, reload],
  );
  return <PointsContext.Provider value={value}>{children}</PointsContext.Provider>;
}

export function useEcPoints(): PointsValue {
  const value = useContext(PointsContext);
  if (!value) throw new Error('useEcPoints must be used inside <EcPointsProvider>');
  return value;
}


/**
 * App-wide mount point (root layout): one live EcoPuan subscription for the whole app, so the
 * map's points badge, the EcoPuan tab and every EARTHCARE screen show the same live number.
 * Keyed by user id, so signing in as someone else starts from a clean state.
 */
export function EcPointsRoot({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  return <EcPointsProvider key={userId ?? 'guest'}>{children}</EcPointsProvider>;
}
