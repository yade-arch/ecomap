import type { StringKey } from '@/i18n';

/** Error that carries a short machine-readable code from the server (e.g. 'too_far'). */
export class ApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ApiError';
  }
}

const KNOWN: Record<string, StringKey> = {
  not_authenticated: 'err.notAuthenticated',
  banned: 'err.banned',
  observer_role_required: 'err.observerRole',
  activist_role_required: 'err.activistRole',
  rate_limited: 'err.rateLimited',
  invalid_location: 'err.locationRequired',
  location_required: 'err.locationRequired',
  too_far: 'err.tooFar',
  hazardous_report: 'err.hazardous',
  report_not_open: 'err.reportNotOpen',
  already_submitted: 'err.alreadySubmitted',
  cleanup_awaiting_verification: 'err.alreadySubmitted',
  photo_missing: 'err.photoUpload',
  invalid_photo: 'err.photoUpload',
  photo_already_used: 'err.photoUpload',
  not_allowed: 'err.notAllowed',
  cannot_verify_own_cleanup: 'err.ownCleanup',
  cannot_approve_own_report: 'err.ownReport',
  submission_already_decided: 'err.alreadyDecided',
  nothing_to_approve: 'err.alreadyDecided',
  report_already_closed: 'err.alreadyDecided',
  network_error: 'err.network',
  own_report: 'err.ownSupport',
  invalid_category: 'err.invalidCategory',
  report_not_found: 'err.reportNotOpen',
  invalid_action: 'err.generic',
  camera_denied: 'err.cameraDenied',
  invalid_credentials: 'err.invalidCredentials',
  user_already_exists: 'err.emailTaken',
  email_exists: 'err.emailTaken',
  weak_password: 'err.weakPassword',
  email_not_confirmed: 'err.emailNotConfirmed',
  over_email_send_rate_limit: 'err.rateLimited',
  email_address_invalid: 'err.invalidEmail',
  validation_failed: 'err.invalidEmail',
};

/** Turns anything thrown into a translation key the screen can show. */
export function errorKey(error: unknown): StringKey {
  const candidates: string[] = [];
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    if (typeof e.code === 'string') candidates.push(e.code);
    if (typeof e.message === 'string') candidates.push(e.message);
  } else if (typeof error === 'string') {
    candidates.push(error);
  }
  for (const candidate of candidates) {
    if (KNOWN[candidate]) return KNOWN[candidate];
    const lower = candidate.toLowerCase();
    if (lower.includes('network request failed') || lower.includes('failed to fetch')) return 'err.network';
    if (lower.includes('rate_limited')) return 'err.rateLimited';
    if (lower.includes('invalid login credentials')) return 'err.invalidCredentials';
  }
  return 'err.generic';
}
