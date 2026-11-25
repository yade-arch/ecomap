// Every call the app makes to the backend lives here, so screens stay free of query details.
// Reads go straight to the database (protected by Row Level Security).
// Anything that creates reports, cleanups or points goes through the server function.
import { ApiError } from './errors';
import { supabase } from './supabase';
import type {
  Access,
  AppNotification,
  AppRole,
  ChatMessage,
  CleanupSubmission,
  Department,
  MuniStats,
  LeaderboardEntry,
  Participant,
  Profile,
  Report,
  ReportEvent,
  Severity,
  StaffMember,
  SubmitResult,
} from './types';

const REPORT_COLUMNS =
  'id, reporter_id, photo_path, cleaned_photo_path, latitude, longitude, address, city, description, severity, ' +
  'ai_category, ai_analysis_status, ai_summary, ai_confidence, is_hazardous, report_status, created_at, cleaned_at, ' +
  'public_code, issue_group, issue_type, municipality_id, muni_status, department_id, assignee_id, due_at, resolution_photo_path, supports_count, ' +
  'reporter:profiles!pollution_reports_reporter_id_fkey(id, display_name, avatar_url)';

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw new ApiError(error.message || error.code || 'unknown');
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export async function fetchReports(): Promise<Report[]> {
  const { data, error } = await supabase
    .from('pollution_reports')
    .select(REPORT_COLUMNS)
    .neq('report_status', 'rejected')
    .order('created_at', { ascending: false })
    .limit(1000);
  fail(error);
  return (data ?? []) as unknown as Report[];
}

export async function fetchReport(id: string): Promise<Report | null> {
  const { data, error } = await supabase.from('pollution_reports').select(REPORT_COLUMNS).eq('id', id).maybeSingle();
  fail(error);
  return (data as unknown as Report) ?? null;
}

export async function fetchParticipants(reportId: string): Promise<Participant[]> {
  const { data, error } = await supabase
    .from('cleanup_participants')
    .select('user_id, joined_at, profile:profiles(id, display_name, avatar_url)')
    .eq('report_id', reportId)
    .order('joined_at', { ascending: true });
  fail(error);
  return (data ?? []) as unknown as Participant[];
}

export async function hasOpenSubmission(reportId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('cleanup_submissions')
    .select('id')
    .eq('report_id', reportId)
    .in('verification_status', ['pending', 'manual_review'])
    .limit(1);
  fail(error);
  return (data ?? []).length > 0;
}

async function callServer(body: Record<string, unknown>): Promise<SubmitResult> {
  const { data, error } = await supabase.functions.invoke('ecomap-api', { body });
  if (error) {
    // Non-2xx answers carry a JSON body like { error: 'not_authenticated' }.
    let code = 'network_error';
    try {
      const response = (error as { context?: Response }).context;
      const payload = response && typeof response.json === 'function' ? await response.json() : null;
      if (payload && typeof payload.error === 'string') code = payload.error;
    } catch {
      // keep the default code
    }
    throw new ApiError(code);
  }
  return data as SubmitResult;
}

export function submitReport(input: {
  photoPath: string;
  extraPhotoPaths?: string[];
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  userSeverity: Severity | null;
  force?: boolean;
}): Promise<SubmitResult> {
  return callServer({
    action: 'submit_report',
    photo_path: input.photoPath,
    extra_photo_paths: input.extraPhotoPaths?.length ? input.extraPhotoPaths : undefined,
    latitude: input.latitude,
    longitude: input.longitude,
    address: input.address,
    city: input.city,
    country: input.country,
    description: input.description,
    user_severity: input.userSeverity,
    force: input.force ?? false,
  });
}

export function submitCleanup(input: {
  reportId: string;
  photoPath: string;
  latitude: number;
  longitude: number;
}): Promise<SubmitResult> {
  return callServer({
    action: 'submit_cleanup',
    report_id: input.reportId,
    photo_path: input.photoPath,
    latitude: input.latitude,
    longitude: input.longitude,
  });
}

export function reanalyzePending(): Promise<SubmitResult & { checked?: number }> {
  return callServer({ action: 'reanalyze_pending' });
}

export async function joinCleanup(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('join_cleanup', { p_report_id: reportId });
  fail(error);
}

export async function leaveCleanup(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_cleanup', { p_report_id: reportId });
  fail(error);
}

export async function flagReport(reportId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('content_reports')
    .insert({ reporter_id: userId, target_type: 'report', target_id: reportId, reason: 'flagged_in_app' });
  // 23505 = this user already flagged it: treat as success.
  if (error && error.code !== '23505') fail(error);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export async function fetchRoomId(reportId: string): Promise<string | null> {
  const { data, error } = await supabase.from('report_chat_rooms').select('id').eq('report_id', reportId).maybeSingle();
  fail(error);
  return data?.id ?? null;
}

export async function fetchMessages(roomId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, room_id, sender_id, body, created_at, sender:profiles!chat_messages_sender_id_fkey(id, display_name, avatar_url)')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(200);
  fail(error);
  return (data ?? []) as unknown as ChatMessage[];
}

export async function sendMessage(roomId: string, userId: string, body: string): Promise<void> {
  const { error } = await supabase.from('chat_messages').insert({ room_id: roomId, sender_id: userId, body });
  fail(error);
}

// ---------------------------------------------------------------------------
// Profile, roles, leaderboard
// ---------------------------------------------------------------------------
const PROFILE_COLUMNS =
  'id, display_name, avatar_url, country, city, preferred_language, total_points, reports_count, cleans_count, leaderboard_hidden';

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
  fail(error);
  return (data as Profile) ?? null;
}

export async function fetchAccess(): Promise<Access> {
  const { data, error } = await supabase.rpc('get_my_access');
  fail(error);
  return data as Access;
}

export async function updateProfile(
  userId: string,
  changes: Partial<Pick<Profile, 'display_name' | 'city' | 'country' | 'preferred_language' | 'leaderboard_hidden'>>,
): Promise<void> {
  const { error } = await supabase.from('profiles').update(changes).eq('id', userId);
  fail(error);
}

export async function setMyRoles(roles: AppRole[]): Promise<void> {
  const { error } = await supabase.rpc('set_my_roles', { p_roles: roles });
  fail(error);
}

export async function fetchLeaderboard(city?: string | null, country?: string | null): Promise<LeaderboardEntry[]> {
  let query = supabase
    .from('profiles')
    .select('id, display_name, avatar_url, city, country, total_points, reports_count, cleans_count, user_roles(role)')
    .eq('leaderboard_hidden', false)
    .gt('total_points', 0);
  if (city) query = query.eq('city', city);
  else if (country) query = query.eq('country', country);
  const { data, error } = await query
    .order('total_points', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(50);
  fail(error);
  return (data ?? []) as unknown as LeaderboardEntry[];
}

export async function fetchMyRank(): Promise<number | null> {
  const { data, error } = await supabase.rpc('get_my_rank');
  fail(error);
  return typeof data === 'number' ? data : null;
}

// ---------------------------------------------------------------------------
// Moderation (the database refuses these for anyone who is not staff)
// ---------------------------------------------------------------------------
export async function fetchCleanupQueue(): Promise<CleanupSubmission[]> {
  const { data, error } = await supabase
    .from('cleanup_submissions')
    .select(
      'id, report_id, activist_id, verification_status, ai_confidence, ai_verification_result, distance_m, moderator_note, submitted_at, ' +
        'activist:profiles!cleanup_submissions_activist_id_fkey(id, display_name, avatar_url), ' +
        'after_photo:pollution_photos!cleanup_submissions_after_photo_id_fkey(path), ' +
        'report:pollution_reports(id, photo_path, severity, city, address, ai_category)',
    )
    .in('verification_status', ['pending', 'manual_review'])
    .order('submitted_at', { ascending: true })
    .limit(50);
  fail(error);
  return (data ?? []) as unknown as CleanupSubmission[];
}

export async function fetchReportQueue(): Promise<Report[]> {
  const { data, error } = await supabase
    .from('pollution_reports')
    .select(REPORT_COLUMNS)
    .or('report_status.eq.pending_review,and(ai_analysis_status.eq.needs_review,report_status.neq.rejected)')
    .order('created_at', { ascending: true })
    .limit(50);
  fail(error);
  return (data ?? []) as unknown as Report[];
}

export async function moderateCleanup(submissionId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('moderate_cleanup', { p_submission_id: submissionId, p_approve: approve, p_note: null });
  fail(error);
}

export async function moderateReport(reportId: string, action: 'approve' | 'reject'): Promise<void> {
  const { error } = await supabase.rpc('moderate_report', { p_report_id: reportId, p_action: action, p_note: null });
  fail(error);
}

// ---------------------------------------------------------------------------
// EARTHCARE: categories, supports, timeline, notifications, account
// ---------------------------------------------------------------------------
/** Roads, parks and storm damage: no pollution AI, the reporter's severity is used. */
export async function submitIssue(input: {
  photoPath: string;
  extraPhotoPaths?: string[];
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  userSeverity: Severity | null;
  issueGroup: string;
  issueType: string | null;
  force?: boolean;
}): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc('submit_issue', {
    p_photo_path: input.photoPath,
    p_extra_photo_paths: input.extraPhotoPaths?.length ? input.extraPhotoPaths : null,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_address: input.address,
    p_city: input.city,
    p_country: input.country,
    p_description: input.description,
    p_user_severity: input.userSeverity,
    p_issue_group: input.issueGroup,
    p_issue_type: input.issueType,
    p_force: input.force ?? false,
  });
  fail(error);
  return data as SubmitResult;
}

export async function setReportCategory(reportId: string, group: string, type: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_report_category', { p_report_id: reportId, p_issue_group: group, p_issue_type: type });
  fail(error);
}

export async function supportReport(reportId: string): Promise<number> {
  const { data, error } = await supabase.rpc('support_report', { p_report_id: reportId });
  fail(error);
  return (data as { supports: number })?.supports ?? 0;
}

export async function hasSupported(reportId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('report_supports').select('report_id').eq('report_id', reportId).eq('user_id', userId).limit(1);
  fail(error);
  return (data ?? []).length > 0;
}

export async function fetchEvents(reportId: string): Promise<ReportEvent[]> {
  const { data, error } = await supabase
    .from('report_events')
    .select('id, action, from_status, to_status, note, is_internal, created_at, actor:profiles!report_events_actor_id_fkey(id, display_name, avatar_url)')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
    .limit(100);
  fail(error);
  return (data ?? []) as unknown as ReportEvent[];
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, report_id, data, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  fail(error);
  return (data ?? []) as AppNotification[];
}

export async function countUnread(): Promise<number> {
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  fail(error);
  return count ?? 0;
}

export async function markNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_read');
  fail(error);
}

export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account');
  fail(error);
}

// ---------------------------------------------------------------------------
// Municipality panel (the database checks the caller's municipality and role)
// ---------------------------------------------------------------------------
export async function fetchMuniReports(
  filter: 'open' | 'mine' | 'closed' | 'all',
  userId: string | null,
  city?: string | null,
): Promise<Report[]> {
  let query = supabase.from('pollution_reports').select(REPORT_COLUMNS).not('municipality_id', 'is', null);
  if (filter === 'open') query = query.in('muni_status', ['submitted', 'accepted', 'assigned', 'in_progress', 'resolved', 'reopened']);
  if (filter === 'closed') query = query.in('muni_status', ['verified', 'rejected', 'duplicate']);
  if (filter === 'mine' && userId) query = query.eq('assignee_id', userId);
  if (city) query = query.eq('city', city);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(300);
  fail(error);
  return (data ?? []) as unknown as Report[];
}

export async function fetchMuniStats(): Promise<MuniStats> {
  const { data, error } = await supabase.rpc('muni_stats');
  fail(error);
  return data as MuniStats;
}

export async function fetchDepartments(municipalityId: string): Promise<Department[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('id, municipality_id, name, issue_groups')
    .eq('municipality_id', municipalityId)
    .eq('active', true)
    .order('name');
  fail(error);
  return (data ?? []) as Department[];
}

export async function fetchStaff(municipalityId: string): Promise<StaffMember[]> {
  const { data, error } = await supabase
    .from('municipal_users')
    .select('user_id, role, profile:profiles!municipal_users_user_id_fkey(id, display_name, avatar_url)')
    .eq('municipality_id', municipalityId);
  fail(error);
  return (data ?? []) as unknown as StaffMember[];
}

export async function muniUpdate(
  reportId: string,
  action: 'accept' | 'assign' | 'start' | 'reject' | 'duplicate' | 'reopen' | 'note',
  extra: { note?: string | null; departmentId?: string | null; assigneeId?: string | null; dueAt?: string | null } = {},
): Promise<void> {
  const { error } = await supabase.rpc('muni_update', {
    p_report_id: reportId,
    p_action: action,
    p_note: extra.note ?? null,
    p_department_id: extra.departmentId ?? null,
    p_assignee_id: extra.assigneeId ?? null,
    p_due_at: extra.dueAt ?? null,
  });
  fail(error);
}

export async function muniResolve(reportId: string, photoPath: string, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('muni_resolve', { p_report_id: reportId, p_photo_path: photoPath, p_note: note });
  fail(error);
}

export async function muniVerify(reportId: string, approve: boolean, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('muni_verify', { p_report_id: reportId, p_approve: approve, p_note: note });
  fail(error);
}
