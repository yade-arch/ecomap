// EcoMap server function.
// The app uploads a photo to Storage, then calls this function. The function (never the phone)
// asks the AI, and passes the answer to the database functions that decide status and points.
//
// Actions (POST JSON { action, ... } with the signed-in user's token):
//   submit_report     { photo_path, latitude, longitude, address?, city?, country?, description?, user_severity? }
//   submit_cleanup    { report_id, photo_path, latitude, longitude }
//   reanalyze_pending {}   (moderators) re-checks reports that were saved while the AI was unavailable

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ImageInput, VisionProvider } from "./ai.ts";
import { getProvider } from "./gemini.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
// Statuses after which the uploaded file is of no further use and is removed again.
const DISCARD_REPORT_UPLOAD = new Set([
  "not_pollution", "unclear", "duplicate", "rate_limited", "banned", "observer_role_required",
  "invalid_location", "invalid_photo", "profile_missing", "photo_already_used",
]);
const DISCARD_CLEANUP_UPLOAD = new Set([
  "too_far", "location_required", "report_not_open", "report_not_found", "hazardous_report",
  "already_submitted", "rate_limited", "banned", "activist_role_required", "invalid_photo", "profile_missing",
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function secretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const key = JSON.parse(raw)?.default;
      if (typeof key === "string" && key) return key;
    } catch {
      // fall through to the legacy variable
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

function photoPathOk(path: unknown, userId: string): path is string {
  return typeof path === "string" && new RegExp(`^${userId}/${UUID}\\.(jpg|jpeg|png|webp)$`).test(path);
}

async function loadImage(admin: SupabaseClient, bucket: string, path: string): Promise<ImageInput | null> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return null;
  if (data.size === 0 || data.size > MAX_IMAGE_BYTES) return null;
  const mimeType = ["image/jpeg", "image/png", "image/webp"].includes(data.type) ? data.type : "image/jpeg";
  return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType };
}

async function discard(admin: SupabaseClient, bucket: string, path: string): Promise<void> {
  const { error } = await admin.storage.from(bucket).remove([path]);
  if (error) console.warn(`[storage] could not remove ${bucket}/${path}: ${error.message}`);
}

async function safely<T>(label: string, work: () => Promise<T | null>): Promise<T | null> {
  try {
    return await work();
  } catch (err) {
    console.error(`[ai] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Re-checks up to `limit` reports that were saved while the AI was unavailable. */
async function reanalyzePending(admin: SupabaseClient, ai: VisionProvider, limit: number) {
  const { data: rows, error } = await admin
    .from("pollution_reports")
    .select("id, photo_path")
    .eq("ai_analysis_status", "unavailable")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  let updated = 0;
  let needsReview = 0;
  for (const row of rows ?? []) {
    const image = await loadImage(admin, "report-photos", row.photo_path);
    if (!image) continue;
    const analysis = await safely("reanalysis", () => ai.analyzeReport(image));
    if (!analysis) break; // AI unavailable again: stop, try another time
    const { data: result, error: rpcError } = await admin.rpc("apply_report_reanalysis", {
      p_report_id: row.id,
      p_ai: analysis,
    });
    if (rpcError) {
      console.error(`[reanalysis] ${row.id}: ${rpcError.message}`);
      continue;
    }
    if (result?.status === "updated") updated++;
    if (result?.status === "needs_review") needsReview++;
  }
  return { checked: rows?.length ?? 0, updated, needs_review: needsReview };
}

async function submitReport(admin: SupabaseClient, ai: VisionProvider | null, userId: string, body: Record<string, unknown>) {
  const latitude = num(body.latitude);
  const longitude = num(body.longitude);
  if (!photoPathOk(body.photo_path, userId)) return json({ status: "invalid_photo" });
  const photoPath = body.photo_path;
  if (latitude === null || longitude === null) {
    await discard(admin, "report-photos", photoPath);
    return json({ status: "invalid_location" });
  }

  // 1. Cheap checks first, so an AI request is not wasted on duplicates or banned users.
  const pre = await admin.rpc("report_precheck", { p_user: userId, p_latitude: latitude, p_longitude: longitude });
  if (pre.error) throw new Error(pre.error.message);
  if (pre.data?.status !== "ok") {
    await discard(admin, "report-photos", photoPath);
    return json(pre.data);
  }

  // 2. The photo must really exist in the reporter's folder.
  const image = await loadImage(admin, "report-photos", photoPath);
  if (!image) return json({ status: "photo_missing" });

  // 3. Ask the AI. null = unavailable (no key, quota used up, outage).
  const analysis = ai ? await safely("report analysis", () => ai.analyzeReport(image)) : null;

  // 4. The database decides: publish, send to review, refuse, or ask the user for a severity.
  const { data, error } = await admin.rpc("submit_report", {
    p_reporter: userId,
    p_photo_path: photoPath,
    p_photo_bytes: image.bytes.length,
    p_photo_mime: image.mimeType,
    p_latitude: latitude,
    p_longitude: longitude,
    p_address: text(body.address, 300),
    p_city: text(body.city, 80),
    p_country: text(body.country, 60),
    p_description: text(body.description, 500),
    p_user_severity: text(body.user_severity, 10),
    p_ai: analysis,
  });
  if (error) throw new Error(error.message);
  if (DISCARD_REPORT_UPLOAD.has(data?.status)) await discard(admin, "report-photos", photoPath);

  // While the AI is answering, quietly catch up on reports that were saved without it.
  if (ai && analysis) {
    const background = reanalyzePending(admin, ai, 2).catch((err) => console.warn(`[reanalysis] ${err}`));
    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(background);
  }

  return json({ ...data, ai_available: analysis !== null });
}

async function submitCleanup(admin: SupabaseClient, ai: VisionProvider | null, userId: string, body: Record<string, unknown>) {
  const latitude = num(body.latitude);
  const longitude = num(body.longitude);
  const reportId = typeof body.report_id === "string" && UUID_RE.test(body.report_id) ? body.report_id : null;
  if (!photoPathOk(body.photo_path, userId)) return json({ status: "invalid_photo" });
  const photoPath = body.photo_path;
  if (!reportId) {
    await discard(admin, "cleanup-photos", photoPath);
    return json({ status: "report_not_found" });
  }

  const pre = await admin.rpc("cleanup_precheck", {
    p_user: userId, p_report_id: reportId, p_latitude: latitude, p_longitude: longitude,
  });
  if (pre.error) throw new Error(pre.error.message);
  if (pre.data?.status !== "ok") {
    await discard(admin, "cleanup-photos", photoPath);
    return json(pre.data);
  }

  const after = await loadImage(admin, "cleanup-photos", photoPath);
  if (!after) return json({ status: "photo_missing" });
  const before = await loadImage(admin, "report-photos", pre.data.before_photo_path);

  // Without a usable before-photo or without AI, a moderator decides.
  const verification = ai && before
    ? await safely("cleanup verification", () => ai.verifyCleanup(before, after))
    : null;

  const { data, error } = await admin.rpc("submit_cleanup", {
    p_user: userId,
    p_report_id: reportId,
    p_after_path: photoPath,
    p_after_bytes: after.bytes.length,
    p_after_mime: after.mimeType,
    p_latitude: latitude,
    p_longitude: longitude,
    p_ai: verification,
  });
  if (error) throw new Error(error.message);
  if (DISCARD_CLEANUP_UPLOAD.has(data?.status)) await discard(admin, "cleanup-photos", photoPath);

  return json({ ...data, ai_available: verification !== null });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = secretKey();
    if (!url || !key) return json({ error: "server_not_configured" }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // Who is calling? The token is checked with the Auth server; nothing in the body is trusted for identity.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "not_authenticated" }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth?.user) return json({ error: "not_authenticated" }, 401);
    const userId = auth.user.id;

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const ai = getProvider();

    switch (body.action) {
      case "submit_report":
        return await submitReport(admin, ai, userId, body);
      case "submit_cleanup":
        return await submitCleanup(admin, ai, userId, body);
      case "reanalyze_pending": {
        const { data: staff } = await admin
          .from("staff_roles").select("role").eq("user_id", userId).limit(1);
        if (!staff || staff.length === 0) return json({ error: "not_allowed" }, 403);
        if (!ai) return json({ status: "ai_not_configured" });
        return json({ status: "done", ...(await reanalyzePending(admin, ai, 5)) });
      }
      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (err) {
    console.error(`[ecomap-api] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return json({ error: "server_error" }, 500);
  }
});
