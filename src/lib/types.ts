import type { IssueGroup, MuniStatus } from './categories';

// Shapes of the database rows the app reads. Kept by hand and small on purpose:
// only the columns the screens actually use.

export type Severity = 'low' | 'medium' | 'high';
export type AppRole = 'observer' | 'activist';
export type ReportStatus =
  | 'pending_review'
  | 'active'
  | 'cleanup_in_progress'
  | 'pending_verification'
  | 'cleaned'
  | 'rejected';
export type AiStatus = 'completed' | 'unavailable' | 'needs_review' | 'failed';
export type Category =
  | 'household_waste'
  | 'plastic'
  | 'construction_debris'
  | 'bulky_waste'
  | 'organic'
  | 'e_waste'
  | 'hazardous'
  | 'water_pollution'
  | 'burning'
  | 'other';
export type VerificationStatus = 'pending' | 'ai_approved' | 'manual_review' | 'moderator_approved' | 'rejected';

export interface PublicProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface Profile extends PublicProfile {
  country: string | null;
  city: string | null;
  preferred_language: string;
  total_points: number;
  reports_count: number;
  cleans_count: number;
  leaderboard_hidden: boolean;
}

export interface LeaderboardEntry extends PublicProfile {
  city: string | null;
  country: string | null;
  total_points: number;
  reports_count: number;
  cleans_count: number;
  user_roles: { role: AppRole }[];
}

export interface Access {
  roles: AppRole[];
  is_admin: boolean;
  is_moderator: boolean;
  is_staff: boolean;
  /** municipal manager or platform admin: may change citizens' EcoPuan (checked again in the database) */
  is_municipality_admin?: boolean;
  is_banned: boolean;
  municipality_ids?: string[];
}

export interface Report {
  id: string;
  reporter_id: string | null;
  photo_path: string;
  cleaned_photo_path: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  description: string | null;
  severity: Severity;
  ai_category: Category | null;
  ai_analysis_status: AiStatus;
  ai_summary: string | null;
  ai_confidence: number | null;
  is_hazardous: boolean;
  report_status: ReportStatus;
  created_at: string;
  cleaned_at: string | null;
  reporter: PublicProfile | null;
  public_code: string | null;
  issue_group: IssueGroup;
  issue_type: string | null;
  municipality_id: string | null;
  muni_status: MuniStatus | null;
  department_id: string | null;
  assignee_id: string | null;
  due_at: string | null;
  resolution_photo_path: string | null;
  supports_count: number;
}

export interface Department {
  id: string;
  municipality_id: string;
  name: string;
  issue_groups: string[];
}

export interface StaffMember {
  user_id: string;
  role: 'operator' | 'manager' | 'field' | 'verifier';
  profile: PublicProfile | null;
}

export interface ReportEvent {
  id: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  is_internal: boolean;
  created_at: string;
  actor: PublicProfile | null;
}

export interface AppNotification {
  id: string;
  type: string;
  report_id: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface MuniStats {
  total: number;
  by_status: Record<string, number>;
  by_group: Record<string, number>;
  median_first_response_h: number | null;
  median_resolution_h: number | null;
  overdue: number;
}

export interface Participant {
  user_id: string;
  joined_at: string;
  profile: PublicProfile | null;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
  sender: PublicProfile | null;
}

export interface CleanupSubmission {
  id: string;
  report_id: string;
  activist_id: string | null;
  verification_status: VerificationStatus;
  ai_confidence: number | null;
  ai_verification_result: { summary?: string; is_clean?: boolean; same_location?: boolean } | null;
  distance_m: number | null;
  moderator_note: string | null;
  submitted_at: string;
  activist: PublicProfile | null;
  after_photo: { path: string } | null;
  report: Pick<Report, 'id' | 'photo_path' | 'severity' | 'city' | 'address' | 'ai_category'> | null;
}

/** What the server function answers after a report or cleanup is submitted. */
export interface SubmitResult {
  status: string;
  report_id?: string;
  submission_id?: string;
  points?: number;
  severity?: Severity;
  category?: Category | null;
  hazardous?: boolean;
  reason?: string;
  distance_m?: number;
  max_distance_m?: number;
  limit?: number;
  ai_available?: boolean;
}
