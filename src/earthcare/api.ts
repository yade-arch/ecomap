// EARTHCARE data access. Reads go through RLS; every write is an RPC that checks the caller's
// role in the database (a refused call comes back as HTTP 403 / SQLSTATE 42501).
import { supabase } from '@/lib/supabase';

import type {
  AdjustResult,
  AuditEntry,
  Citizen,
  EcSummary,
  LedgerEntry,
  PointsOperation,
  RedeemResult,
  Redemption,
  Reward,
} from './types';

/** Error with the server's short code (e.g. 'not_allowed') and the HTTP-level SQLSTATE. */
export class EcError extends Error {
  constructor(
    public readonly code: string,
    public readonly sqlState?: string,
  ) {
    super(code);
    this.name = 'EcError';
  }
  /** true when the database refused the call for lack of permission (HTTP 403). */
  get forbidden(): boolean {
    return this.sqlState === '42501' || this.code === 'not_allowed';
  }
}

function check(error: { message?: string; code?: string } | null): void {
  if (error) throw new EcError(error.message || error.code || 'unknown', error.code);
}

export const LEDGER_COLUMNS = 'id, user_id, transaction_type, points, reason, created_at';
export const AUDIT_COLUMNS =
  'id, actor_id, target_user_id, transaction_id, operation, previous_points, delta, new_points, reason, created_at';
const REWARD_COLUMNS = 'id, slug, title, subtitle, description, partner, cost, icon, accent, sort_order, valid_minutes';

// ---------------------------------------------------------------------------
// Citizen
// ---------------------------------------------------------------------------
export async function fetchSummary(): Promise<EcSummary | null> {
  const { data, error } = await supabase.rpc('get_my_earthcare_summary');
  check(error);
  return (data as EcSummary) ?? null;
}

export async function fetchMyLedger(userId: string, limit = 50): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('points_transactions')
    .select(LEDGER_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  check(error);
  return (data ?? []) as LedgerEntry[];
}

export async function fetchRewards(): Promise<Reward[]> {
  const { data, error } = await supabase
    .from('rewards')
    .select(REWARD_COLUMNS)
    .eq('active', true)
    .order('sort_order', { ascending: true });
  check(error);
  return (data ?? []) as Reward[];
}

export async function redeemReward(rewardId: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('redeem_reward', { p_reward_id: rewardId });
  check(error);
  return data as RedeemResult;
}

export async function fetchRedemption(id: string): Promise<Redemption | null> {
  const { data, error } = await supabase
    .from('reward_redemptions')
    .select(`id, user_id, reward_id, code, points_spent, status, expires_at, used_at, created_at, reward:rewards(${REWARD_COLUMNS})`)
    .eq('id', id)
    .maybeSingle();
  check(error);
  return (data as unknown as Redemption) ?? null;
}

export async function fetchMyRedemptions(userId: string, limit = 20): Promise<Redemption[]> {
  const { data, error } = await supabase
    .from('reward_redemptions')
    .select(`id, user_id, reward_id, code, points_spent, status, expires_at, used_at, created_at, reward:rewards(${REWARD_COLUMNS})`)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  check(error);
  return (data ?? []) as unknown as Redemption[];
}

// ---------------------------------------------------------------------------
// Municipality admin
// ---------------------------------------------------------------------------
export async function listCitizens(search?: string): Promise<Citizen[]> {
  const { data, error } = await supabase.rpc('muni_list_citizens', {
    p_search: search?.trim() || null,
    p_limit: 200,
    p_offset: 0,
  });
  check(error);
  return (data ?? []) as Citizen[];
}

export async function adjustPoints(input: {
  userId: string;
  operation: PointsOperation;
  amount: number;
  reason: string;
}): Promise<AdjustResult> {
  const { data, error } = await supabase.rpc('muni_adjust_points', {
    p_user_id: input.userId,
    p_operation: input.operation,
    p_amount: input.amount,
    p_reason: input.reason,
  });
  check(error);
  return data as AdjustResult;
}

export async function fetchAudit(targetUserId?: string, limit = 100): Promise<AuditEntry[]> {
  let query = supabase.from('points_audit_log').select(AUDIT_COLUMNS).order('created_at', { ascending: false }).limit(limit);
  if (targetUserId) query = query.eq('target_user_id', targetUserId);
  const { data, error } = await query;
  check(error);
  return (data ?? []) as AuditEntry[];
}

export async function fetchNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.from('profiles').select('id, display_name').in('id', unique);
  check(error);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { id: string; display_name: string }[]) out[row.id] = row.display_name;
  return out;
}

export async function markRedemptionUsed(code: string): Promise<{ status: string }> {
  const { data, error } = await supabase.rpc('muni_use_redemption', { p_code: code });
  check(error);
  return data as { status: string };
}
