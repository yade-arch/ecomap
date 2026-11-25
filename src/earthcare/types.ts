// Rows and RPC answers of the EARTHCARE points system (see migration 20261125090100).

export type PointsOperation = 'add' | 'subtract' | 'set';

export type LedgerType =
  | 'report_reward'
  | 'cleanup_reward'
  | 'adjustment'
  | 'reversal'
  | 'municipal_adjustment'
  | 'municipal_set'
  | 'reward_redeem';

export interface LedgerEntry {
  id: string;
  user_id: string | null;
  transaction_type: LedgerType;
  points: number;
  reason: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  target_user_id: string | null;
  transaction_id: string | null;
  operation: PointsOperation;
  previous_points: number;
  delta: number;
  new_points: number;
  reason: string;
  created_at: string;
}

export interface Reward {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  partner: string;
  cost: number;
  icon: 'bicycle' | 'cafe' | 'car' | 'bread' | string;
  accent: string;
  sort_order: number;
  valid_minutes: number;
}

export interface Redemption {
  id: string;
  user_id: string | null;
  reward_id: string;
  code: string;
  points_spent: number;
  status: 'issued' | 'used' | 'expired' | 'cancelled';
  expires_at: string;
  used_at: string | null;
  created_at: string;
  reward?: Reward | null;
}

export interface EcSummary {
  total_points: number;
  rank: number | null;
  contributions: number;
  waste_kg: number;
  rewards_used: number;
}

export interface Citizen {
  id: string;
  display_name: string;
  avatar_url: string | null;
  city: string | null;
  total_points: number;
  reports_count: number;
  cleans_count: number;
  last_change_at: string | null;
  created_at: string;
}

export interface AdjustResult {
  status: 'ok';
  audit_id: number;
  transaction_id: string | null;
  previous_points: number;
  delta: number;
  new_points: number;
}

export interface RedeemResult {
  status: 'ok';
  redemption_id: string;
  code: string;
  points_spent: number;
  remaining: number;
  expires_at: string;
}
