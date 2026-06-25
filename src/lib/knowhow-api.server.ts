// Server-only helpers for the Know-how MVP backend.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export function adminClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function publishableClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function getBearerUser(request: Request) {
  const auth = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (!token) return null;
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token };
}

export async function requireUser(request: Request) {
  const result = await getBearerUser(request);
  if (!result) throw json({ message: "Unauthorized" }, 401);
  return result;
}

export async function requireAdmin(request: Request) {
  const { user, token } = await requireUser(request);
  const admin = adminClient();
  const { data } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!data) throw json({ message: "Admin only" }, 403);
  return { user, token, admin };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Build the user payload that the frontend's normalizeBackendUser expects.
export function shapeUser(profile: any) {
  return {
    _id: profile.id,
    id: profile.id,
    fullName: profile.full_name,
    username: profile.username,
    email: profile.email,
    role: profile.raw_role,
    profile: profile.profile || {},
    learningProfile: profile.learning_profile || {},
    teachingProfile: profile.teaching_profile || {},
    subjectLevels: profile.subject_levels || [],
    badges: profile.badges || [],
    xp: profile.xp || 0,
    dailyStreak: profile.daily_streak || 0,
    twoFactorEnabled: profile.two_factor_enabled || false,
  };
}

export function shapeWallet(w: any) {
  if (!w) return null;
  return {
    currentCredits: Number(w.current_credits),
    earnedCredits: Number(w.earned_credits),
    spentCredits: Number(w.spent_credits),
    loanOutstanding: Number(w.loan_outstanding),
    loanDueDate: w.loan_due_date || "",
    purchasedCredits: Number(w.purchased_credits),
    lectureAccess: Number(w.lecture_access),
  };
}

export function shapeApplication(a: any) {
  return {
    _id: a.id,
    id: a.id,
    user: a.user
      ? { _id: a.user.id, fullName: a.user.full_name, username: a.user.username, email: a.user.email }
      : undefined,
    subject: a.subject,
    requestedRole: a.requested_role,
    learnerLevel: a.learner_level,
    teacherLevelClaim: a.teacher_level_claim,
    linkedInUrl: a.linked_in_url,
    cvUrl: a.cv_url,
    licenseUrl: a.license_url,
    authorityName: a.authority_name,
    note: a.note,
    status: a.status,
    adminNote: a.admin_note,
    reviewedAt: a.reviewed_at,
    createdAt: a.created_at,
  };
}
