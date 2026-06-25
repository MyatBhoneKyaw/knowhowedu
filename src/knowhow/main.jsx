import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import knowhowLogo from './knowhow-logo.png';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable';
import { NotificationBell, notify } from './notifications.jsx';


// Lovable Cloud (Supabase) backend — replaces the legacy MongoDB API.
// The helpers below preserve the original apiRequest/adminApiRequest call shape
// so the rest of the app needs no changes.
const API_BASE = '/__lovable_cloud__';

function getInitials(name = 'User') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';
}

function roleLabel(role = 'learner') {
  const labels = {
    admin: 'Administrator',
    user: 'Learner',
    learner: 'Learner',
    assistant_teacher: 'Teacher',
    teacher: 'Teacher',
    community_mentor: 'Community Mentor',
    corporate_partner: 'Corporate Partner',
    administrator: 'Administrator',
  };
  return labels[role] || 'Learner';
}

function normalizeBackendUser(apiUser, wallet) {
  if (!apiUser) return DEFAULT_USER;
  return {
    id: apiUser._id || apiUser.id,
    fullName: apiUser.fullName || 'Know-how User',
    username: apiUser.username || 'user',
    email: apiUser.email || '',
    avatar: getInitials(apiUser.fullName || apiUser.username),
    bio: apiUser.profile?.bio || '',
    region: apiUser.profile?.region || '',
    age: apiUser.profile?.age || '',
    languages: apiUser.profile?.languages?.length ? apiUser.profile.languages : ['English'],
    interests: apiUser.profile?.interests?.length ? apiUser.profile.interests : ['English Speaking', 'UI/UX Design'],
    education: apiUser.profile?.education?.map((item) => [item.degree, item.school, item.year].filter(Boolean).join(' - ')).join(', ') || '',
    work: apiUser.profile?.workExperience?.map((item) => [item.role, item.company, item.years].filter(Boolean).join(' - ')).join(', ') || '',
    portfolio: apiUser.profile?.portfolioLinks?.[0] || '',
    social: apiUser.profile?.socialLinks?.[0] || '',
    role: roleLabel(apiUser.role),
    rawRole: apiUser.role || 'learner',
    learnerLevel: apiUser.learningProfile?.level || 'N5 / Beginner',
    teacherLevel: apiUser.teachingProfile?.level || 'Not eligible yet',
    licenseStatus: apiUser.teachingProfile?.licenseStatus || 'Not submitted',
    teacherPath: apiUser.teachingProfile?.applicationStatus || 'learner_first',
    subjectLevels: apiUser.subjectLevels?.length ? apiUser.subjectLevels : [{ subject: 'Japanese', learnerLevel: 'N5', teacherLevel: 'N1 required' }],
    theme: apiUser.profile?.theme || 'light',
    privacy: apiUser.profile?.privacy?.showRegion === false ? 'Private' : 'Community visible',
    notifications: apiUser.profile?.notifications?.sessionReminders ?? true,
    twoFactor: apiUser.twoFactorEnabled || false,
    xp: apiUser.xp || 0,
    streak: apiUser.dailyStreak || 0,
    wallet: normalizeWallet({
      current: wallet?.currentCredits ?? 3,
      earned: wallet?.earnedCredits ?? 0,
      spent: wallet?.spentCredits ?? 0,
      loanOutstanding: wallet?.loanOutstanding ?? 0,
      loanDueDate: wallet?.loanDueDate ? String(wallet.loanDueDate).slice(0, 10) : '',
      purchased: wallet?.purchasedCredits ?? 0,
      lectureAccess: wallet?.lectureAccess ?? 0,
    }),
    skillsOffered: [],
    skillsWanted: [],
    badges: apiUser.badges || [],
  };
}

// ---------- Lovable Cloud backend bridge ----------

function profileRowToApiUser(row, roleRow) {
  if (!row) return null;
  const profile = row.profile || {};
  const sysRole = roleRow?.role;
  const teachingProfile = row.teaching_profile || {};
  const hasApprovedTeaching = teachingProfile.applicationStatus === 'approved' || teachingProfile.licenseStatus === 'Approved';
  const rawRole = hasApprovedTeaching && (!row.raw_role || row.raw_role === 'learner') ? 'teacher' : row.raw_role;
  // Admin from user_roles always wins. Otherwise prefer the granular raw_role
  // (e.g. teacher, assistant_teacher) over the basic 'user' enum value.
  let role;
  if (sysRole === 'admin') role = 'admin';
  else if (rawRole && rawRole !== 'learner') role = rawRole;
  else role = sysRole || rawRole || 'learner';
  return {
    _id: row.id,
    id: row.id,
    fullName: row.full_name,
    username: row.username,
    email: row.email,
    role,
    rawRole: rawRole || 'learner',
    profile,
    learningProfile: row.learning_profile || {},
    teachingProfile,
    subjectLevels: row.subject_levels || [],
    badges: row.badges || [],
    xp: row.xp || 0,
    dailyStreak: row.daily_streak || 0,
    twoFactorEnabled: row.two_factor_enabled || false,
  };
}

function walletRowToApiWallet(row) {
  if (!row) return null;
  return {
    currentCredits: Number(row.current_credits ?? 3),
    earnedCredits: Number(row.earned_credits ?? 0),
    spentCredits: Number(row.spent_credits ?? 0),
    loanOutstanding: Number(row.loan_outstanding ?? 0),
    loanDueDate: row.loan_due_date,
    purchasedCredits: Number(row.purchased_credits ?? 0),
    lectureAccess: Number(row.lecture_access ?? 0),
  };
}

async function fetchMeFromCloud() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');
  const [profileRes, walletRes, roleRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('wallets').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
  ]);
  if (profileRes.error) throw new Error(profileRes.error.message);
  return {
    user: profileRowToApiUser(profileRes.data, roleRes.data),
    wallet: walletRowToApiWallet(walletRes.data),
  };
}

async function cloudSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const me = await fetchMeFromCloud();
  return { token: data.session.access_token, user: me.user, wallet: me.wallet };
}

async function cloudSignUp(payload) {
  const { email, password, fullName, username, region, age, languages, interests } = payload;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/`,
      data: {
        full_name: fullName,
        username,
        profile: {
          region: region || '',
          age: age ? Number(age) : undefined,
          languages: languages || [],
          interests: interests || [],
        },
      },
    },
  });
  if (error) throw new Error(error.message);
  // If email confirmation is off (default for Lovable Cloud), session exists immediately.
  if (!data.session) {
    throw new Error('Account created. Please check your email to confirm, then log in.');
  }
  const me = await fetchMeFromCloud();
  return { token: data.session.access_token, user: me.user, wallet: me.wallet };
}

async function cloudUpdateProfile(body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');
  const patch = {};
  if (body.fullName !== undefined) patch.full_name = body.fullName;
  if (body.username !== undefined) patch.username = body.username;
  if (body.email !== undefined) patch.email = body.email;
  if (body.profile !== undefined) patch.profile = body.profile;
  if (body.learningProfile !== undefined) patch.learning_profile = body.learningProfile;
  if (body.teachingProfile !== undefined) patch.teaching_profile = body.teachingProfile;
  if (body.subjectLevels !== undefined) patch.subject_levels = body.subjectLevels;
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  const { data: roleRow } = await supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle();
  return { user: profileRowToApiUser(data, roleRow) };
}

async function cloudSubmitTeacherApplication(body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await supabase.from('teacher_applications').insert({
    user_id: userId,
    subject: body.subject,
    requested_role: body.requestedRole,
    learner_level: body.learnerLevel,
    teacher_level_claim: body.teacherLevelClaim,
    linked_in_url: body.linkedInUrl,
    cv_url: body.cvUrl,
    license_url: body.licenseUrl,
    authority_name: body.authorityName,
    note: body.note,
  }).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function applicationRowToApi(row, profile) {
  return {
    _id: row.id,
    id: row.id,
    user: profile ? { _id: profile.id, fullName: profile.full_name, username: profile.username, email: profile.email } : row.user_id,
    subject: row.subject,
    requestedRole: row.requested_role,
    learnerLevel: row.learner_level,
    teacherLevelClaim: row.teacher_level_claim,
    linkedInUrl: row.linked_in_url,
    cvUrl: row.cv_url,
    licenseUrl: row.license_url,
    authorityName: row.authority_name,
    note: row.note,
    status: row.status,
    adminNote: row.admin_note,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

async function cloudListAdminApplications() {
  const { data: apps, error } = await supabase
    .from('teacher_applications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const userIds = [...new Set((apps || []).map((a) => a.user_id))];
  let profilesById = {};
  if (userIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name, username, email').in('id', userIds);
    profilesById = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
  }
  return (apps || []).map((row) => applicationRowToApi(row, profilesById[row.user_id]));
}

async function cloudReviewApplication(id, body) {
  const normalizedStatus = String(body.status || '').toLowerCase();
  const { data, error } = await supabase
    .from('teacher_applications')
    .update({
      status: normalizedStatus,
      admin_note: body.adminNote,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  // On approval, promote the applicant's role on their profile so the app
  // recognizes them as a teacher (raw_role stores the granular role string),
  // and reflect the approval in teaching_profile so UI gates flip immediately.
  if (data && normalizedStatus === 'approved') {
    const nextRole = data.requested_role === 'teacher' ? 'teacher' : (data.requested_role || 'assistant_teacher');
    const niceLabel = nextRole === 'teacher' ? 'Teacher' : nextRole === 'assistant_teacher' ? 'Assistant Teacher' : nextRole;
    const { data: existing } = await supabase.from('profiles').select('teaching_profile').eq('id', data.user_id).maybeSingle();
    const nextTeaching = { ...(existing?.teaching_profile || {}), level: niceLabel, applicationStatus: 'approved', licenseStatus: 'Approved' };
    const { error: roleErr } = await supabase
      .from('profiles')
      .update({ raw_role: nextRole, teaching_profile: nextTeaching })
      .eq('id', data.user_id);
    if (roleErr) throw new Error(roleErr.message);
  }
  const { data: profile } = await supabase.from('profiles').select('id, full_name, username, email').eq('id', data.user_id).maybeSingle();
  return applicationRowToApi(data, profile);
}

async function cloudAdminLogin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const userId = data.session.user.id;
  const { data: roleRow, error: roleErr } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();
  if (roleErr) throw new Error(roleErr.message);
  if (!roleRow) {
    await supabase.auth.signOut();
    const err = new Error('This account exists but does not have admin access. Ask an existing admin to grant you the admin role.');
    err.status = 403;
    throw err;
  }
  return { token: data.session.access_token, user: { id: userId, email } };
}

// ---- helpers shared by dispatchers ----
async function requireUid() {
  const { data } = await supabase.auth.getSession();
  const uid = data?.session?.user?.id;
  if (!uid) throw new Error('Not authenticated');
  return uid;
}
function ok(data, error) { if (error) throw new Error(error.message); return data; }
function snake(obj) {
  // shallow camel->snake for known fields
  const map = {
    userId: 'user_id', sessionId: 'session_id', recipientId: 'recipient_id', senderId: 'sender_id',
    skillTopic: 'skill_topic', skillCategory: 'skill_category', teacherId: 'teacher_id',
    learnerId: 'learner_id', requestedBy: 'requested_by', durationHours: 'duration_hours',
    roomId: 'room_id', meetingLink: 'meeting_link', meetingProvider: 'meeting_provider',
    meetingSpaceName: 'meeting_space_name', creditAmount: 'credit_amount',
    teacherLevel: 'teacher_level', studentLimit: 'student_limit', seatsAvailable: 'seats_available',
    experienceLevel: 'experience_level', sessionDuration: 'session_duration',
    teachingLanguage: 'teaching_language', locationMode: 'location_mode',
    learningGoals: 'learning_goals', targetProficiency: 'target_proficiency',
    preferredLanguage: 'preferred_language', messageType: 'message_type',
    fileUrl: 'file_url', groupName: 'group_name', postId: 'post_id', commentId: 'comment_id',
    fromUser: 'from_user', toUser: 'to_user', skillOfferedId: 'skill_offered_id',
    skillWantedId: 'skill_wanted_id', matchPercentage: 'match_percentage',
    compatibilityScore: 'compatibility_score', isMutual: 'is_mutual',
    productType: 'product_type', amountPaid: 'amount_paid', dueDate: 'due_date',
    badgeRequested: 'badge_requested', evidenceUrl: 'evidence_url', isRead: 'is_read',
    rewardCredits: 'reward_credits', linkedPostId: 'linked_post_id', tutorId: 'tutor_id',
    solutionNote: 'solution_note',
  };
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[map[k] || k] = v;
  return out;
}
function camel(row) {
  if (!row || typeof row !== 'object') return row;
  if (Array.isArray(row)) return row.map(camel);
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[ck] = v;
    if (k === 'id') out._id = v;
  }
  return out;
}

// ----- Skills -----
async function listSkills(table) { return camel(ok(...(await supabase.from(table).select('*').order('created_at', { ascending: false }).then(r => [r.data, r.error])))); }
async function createSkill(table, body) {
  const uid = await requireUid();
  const { data, error } = await supabase.from(table).insert({ ...snake(body), user_id: uid }).select('*').maybeSingle();
  return camel(ok(data, error));
}
async function updateSkill(table, id, body) {
  const { data, error } = await supabase.from(table).update(snake(body)).eq('id', id).select('*').maybeSingle();
  return camel(ok(data, error));
}
async function deleteSkill(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ----- Sessions -----
function localToCloudSession(local) {
  // Combine date + time into a single timestamp for the date column.
  let when = local.date || null;
  if (when && local.time) when = `${local.date}T${local.time}:00`;
  const durationHours = Number(local.duration || (Number(local.durationMinutes || 0) / 60).toFixed(2)) || 0;
  return {
    id: local.id,
    skill_topic: local.topic || null,
    date: when,
    duration_hours: durationHours,
    room_id: local.roomId || null,
    meeting_link: local.meetingLink || null,
    meeting_provider: local.meetingProvider || null,
    meeting_space_name: local.meetingSpaceName || null,
    notes: local.notes || null,
    credit_amount: Number(local.credits || 0) || 0,
    credit_rate_per_minute: local.creditRatePerMinute || null,
    teacher_level: local.teacherLevel || null,
    student_limit: Number(local.studentLimit || 1),
    seats_available: Number(local.seatsAvailable ?? local.studentLimit ?? 1),
    status: local.status || 'Pending',
    learning_summary: {
      topic: local.topic,
      teacher: local.teacher,
      learner: local.learner,
      date: local.date,
      time: local.time,
      durationMinutes: local.durationMinutes,
      teacherLevelLabel: local.teacherLevel,
      teacherRating: local.teacherRating,
      teacherLevelNumber: local.teacherLevelNumber,
      language: local.language,
      joinedSeats: local.joinedSeats || [],
      attendance: local.attendance || [],
      notes: local.notes,
      createdByRole: local.createdByRole,
      creatorOnly: local.creatorOnly,
    },
  };
}
function cloudToLocalSession(row) {
  if (!row) return null;
  const summary = (row.learning_summary && typeof row.learning_summary === 'object') ? row.learning_summary : {};
  const isoDate = row.date ? new Date(row.date) : null;
  const dateStr = summary.date || (isoDate ? isoDate.toISOString().slice(0, 10) : '');
  const timeStr = summary.time || (isoDate ? isoDate.toISOString().slice(11, 16) : '');
  const durationMinutes = summary.durationMinutes || Math.round(Number(row.duration_hours || 0) * 60);
  return {
    id: row.id,
    cloudId: row.id,
    topic: summary.topic || row.skill_topic || 'Teaching session',
    teacher: summary.teacher || '',
    learner: summary.learner || 'Learner pending',
    date: dateStr,
    time: timeStr,
    duration: Number(row.duration_hours || 0),
    durationMinutes,
    credits: Number(row.credit_amount || 0),
    creditRatePerMinute: row.credit_rate_per_minute,
    studentLimit: row.student_limit,
    seatsAvailable: row.seats_available,
    teacherLevel: row.teacher_level || summary.teacherLevelLabel || 'Approved Teacher',
    teacherRating: summary.teacherRating,
    teacherLevelNumber: summary.teacherLevelNumber,
    language: summary.language,
    status: row.status || 'Pending',
    roomId: row.room_id,
    meetingLink: row.meeting_link,
    meetingProvider: row.meeting_provider,
    meetingSpaceName: row.meeting_space_name,
    notes: row.notes || summary.notes || '',
    joinedSeats: summary.joinedSeats || [],
    attendance: summary.attendance || [],
    createdByRole: summary.createdByRole,
    creatorOnly: summary.creatorOnly,
    teacherId: row.teacher_id,
    learnerId: row.learner_id,
    requestedBy: row.requested_by,
    completedAt: row.completed_at,
    fromCloud: true,
  };
}
async function listMySessions() {
  const uid = await requireUid();
  const { data, error } = await supabase.from('sessions').select('*')
    .or(`teacher_id.eq.${uid},learner_id.eq.${uid},requested_by.eq.${uid}`)
    .order('date', { ascending: false });
  return camel(ok(data, error));
}
async function listActiveSessions() {
  const { data, error } = await supabase.from('sessions').select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data || [])
    .filter((r) => !['completed','cancelled'].includes(String(r.status || '').toLowerCase()))
    .map(cloudToLocalSession);
}
async function deleteSession(id) {
  const { error } = await supabase.from('sessions').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { id, deleted: true };
}
async function rescheduleSession(id, body) {
  const patch = {};
  if (body.date) {
    patch.date = body.time ? `${body.date}T${body.time}:00` : body.date;
  }
  if (body.durationMinutes) patch.duration_hours = Number((Number(body.durationMinutes) / 60).toFixed(2));
  patch.status = 'Rescheduled';
  // Merge into learning_summary so client display picks up the new date/time strings.
  const { data: existing } = await supabase.from('sessions').select('learning_summary').eq('id', id).maybeSingle();
  const nextSummary = { ...((existing && existing.learning_summary) || {}) };
  if (body.date) nextSummary.date = body.date;
  if (body.time) nextSummary.time = body.time;
  if (body.durationMinutes) nextSummary.durationMinutes = Number(body.durationMinutes);
  patch.learning_summary = nextSummary;
  const { data, error } = await supabase.from('sessions').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return cloudToLocalSession(data);
}
async function createSession(body) {
  const uid = await requireUid();
  const row = localToCloudSession(body);
  row.requested_by = uid;
  if (!row.room_id) row.room_id = `kh-${Math.random().toString(36).slice(2, 10)}`;
  if (!row.teacher_id) row.teacher_id = uid;
  const { data, error } = await supabase.from('sessions').insert(row).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return cloudToLocalSession(data);
}
async function updateSessionStatus(id, body) {
  if (body.status === 'completed') {
    const { data, error } = await supabase.rpc('session_complete', { _session_id: id });
    if (error) throw new Error(error.message);
    return cloudToLocalSession(data);
  }
  const patch = { status: body.status };
  if (body.learningSummary) patch.learning_summary = body.learningSummary;
  if (body.seatsAvailable !== undefined) patch.seats_available = body.seatsAvailable;
  const { data, error } = await supabase.from('sessions').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return cloudToLocalSession(data);
}
async function joinSessionSeat(id, body = {}) {
  const { data, error } = await supabase.rpc('session_join_seat_v2', { _session_id: id, _user_name: body.userName || '' });
  if (error) throw new Error(error.message);
  return cloudToLocalSession(data);
}

// ----- Messages -----
async function listMessageThreads() {
  const uid = await requireUid();
  const { data, error } = await supabase.from('messages').select('*')
    .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
    .order('created_at', { ascending: false }).limit(500);
  return camel(ok(data, error));
}
async function listMessagesWith(otherId) {
  const uid = await requireUid();
  const { data, error } = await supabase.from('messages').select('*')
    .or(`and(sender_id.eq.${uid},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${uid})`)
    .order('created_at', { ascending: true });
  return camel(ok(data, error));
}
async function sendMessage(body) {
  const uid = await requireUid();
  const row = snake(body); row.sender_id = uid;
  const { data, error } = await supabase.from('messages').insert(row).select('*').maybeSingle();
  return camel(ok(data, error));
}

// ----- Community -----
async function listCommunityPosts(community) {
  let q = supabase.from('community_posts').select('*, community_comments(*)').order('created_at', { ascending: false });
  if (community) q = q.eq('community', community);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data || [];
  const authorIds = Array.from(new Set(rows.map((r) => r.author_id).filter(Boolean)));
  let authorsMap = {};
  if (authorIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, username, full_name').in('id', authorIds);
    (profs || []).forEach((p) => { authorsMap[p.id] = p.full_name || p.username || 'Member'; });
  }
  return rows.map((r) => ({
    id: r.id,
    community: r.community,
    title: r.title,
    body: r.body,
    author: authorsMap[r.author_id] || 'Member',
    authorId: r.author_id,
    votes: r.votes || 0,
    likes: 0,
    dislikes: 0,
    comments: (r.community_comments || []).map((c) => ({ id: c.id, body: c.body, author: authorsMap[c.user_id] || 'Member', createdAt: c.created_at })),
    tags: [r.community].filter(Boolean),
    createdAt: r.created_at,
  }));
}
async function createCommunityPost(body) {
  const uid = await requireUid();
  const row = { community: body.community, title: body.title, body: body.body, author_id: uid };
  const { data, error } = await supabase.from('community_posts').insert(row).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return { id: data.id, community: data.community, title: data.title, body: data.body, votes: 0, likes: 0, dislikes: 0, comments: [], tags: [data.community], createdAt: data.created_at };
}

async function voteCommunity(postId) {
  const uid = await requireUid();
  await supabase.from('community_reactions').upsert({ post_id: postId, user_id: uid, value: 1 }, { onConflict: 'post_id,user_id' });
  const { data, error } = await supabase.from('community_reactions').select('value').eq('post_id', postId);
  if (error) throw new Error(error.message);
  const votes = (data || []).reduce((s, r) => s + (r.value || 0), 0);
  await supabase.from('community_posts').update({ votes }).eq('id', postId);
  return { votes };
}
async function addCommunityComment(postId, body) {
  const uid = await requireUid();
  const { data, error } = await supabase.from('community_comments').insert({ post_id: postId, user_id: uid, body: body.body }).select('*').maybeSingle();
  return camel(ok(data, error));
}

// ----- Wallet -----
async function getMyWallet() {
  const uid = await requireUid();
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', uid).maybeSingle();
  return walletRowToApiWallet(ok(data, error));
}
async function getWalletHistory() {
  const uid = await requireUid();
  const { data, error } = await supabase.from('credit_transactions').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  return camel(ok(data, error));
}
async function walletLoan(body) { return walletRowToApiWallet(ok(...(await supabase.rpc('wallet_take_loan', { _amount: body.amount, _due: body.dueDate || new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }).then(r => [r.data, r.error])))); }
async function walletRepay(body) { return walletRowToApiWallet(ok(...(await supabase.rpc('wallet_repay_loan', { _amount: body.amount }).then(r => [r.data, r.error])))); }
async function walletPurchase(body) {
  if (body.productType === 'lecture_video') {
    return walletRowToApiWallet(ok(...(await supabase.rpc('wallet_purchase_lecture', { _amount: body.amountPaid || 0, _currency: body.currency || 'USD', _title: body.title || 'Lecture' }).then(r => [r.data, r.error]))));
  }
  return walletRowToApiWallet(ok(...(await supabase.rpc('wallet_purchase_credits', { _credits: body.credits || 0, _amount: body.amountPaid || 0, _currency: body.currency || 'USD', _title: body.title || 'Credits' }).then(r => [r.data, r.error]))));
}

// ----- Reviews -----
async function createReview(body) {
  const uid = await requireUid();
  const row = snake(body); row.reviewer_id = uid;
  const { data, error } = await supabase.from('reviews').insert(row).select('*').maybeSingle();
  return camel(ok(data, error));
}
async function listUserReviews(userId) {
  const { data, error } = await supabase.from('reviews').select('*').eq('reviewee_id', userId).order('created_at', { ascending: false });
  return camel(ok(data, error));
}

// ----- Notifications -----
async function listNotifications() {
  const uid = await requireUid();
  const { data, error } = await supabase.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  return camel(ok(data, error));
}
async function markNotificationRead(id) {
  const { data, error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id).select('*').maybeSingle();
  return camel(ok(data, error));
}

// ----- Matches -----
async function recordSwipe(body) {
  const uid = await requireUid();
  const row = snake(body); row.from_user = uid;
  const { data, error } = await supabase.from('matches').upsert(row, { onConflict: 'from_user,to_user' }).select('*').maybeSingle();
  return camel(ok(data, error));
}

// ----- Quests -----
async function listQuests() { return camel(ok(...(await supabase.from('quests').select('*').order('created_at', { ascending: false }).then(r => [r.data, r.error])))); }
async function createQuest(body) {
  const uid = await requireUid();
  const row = snake(body); row.requester_id = uid;
  const { data, error } = await supabase.from('quests').insert(row).select('*').maybeSingle();
  return camel(ok(data, error));
}
async function acceptQuest(id) {
  const uid = await requireUid();
  const { data, error } = await supabase.from('quests').update({ tutor_id: uid, status: 'accepted' }).eq('id', id).select('*').maybeSingle();
  return camel(ok(data, error));
}
async function completeQuest(id, body) {
  const { data, error } = await supabase.from('quests').update({ status: 'completed', solution_note: body?.solutionNote, completed_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
  return camel(ok(data, error));
}

// ----- Search / Users -----
async function searchUsers(q) {
  let query = supabase.from('profiles').select('id, full_name, username, email, raw_role, profile, learning_profile, teaching_profile, subject_levels, badges, xp, average_rating, hours_shared').limit(50);
  if (q) query = query.or(`username.ilike.%${q}%,full_name.ilike.%${q}%`);
  const { data, error } = await query;
  return camel(ok(data, error));
}
async function getUserByUsername(username) {
  const { data, error } = await supabase.from('profiles').select('*').eq('username', username).maybeSingle();
  return camel(ok(data, error));
}

// =====================================================================
// DISPATCHER
// =====================================================================
async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body
    ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body)
    : undefined;
  const m = (re) => path.match(re);

  // Auth
  if (path === '/auth/login' && method === 'POST') return cloudSignIn(body.email, body.password);
  if (path === '/auth/register' && method === 'POST') return cloudSignUp(body);
  if (path === '/auth/me' && method === 'GET') return fetchMeFromCloud();

  // Users / Profile
  if (path === '/users/me/profile' && method === 'PATCH') return cloudUpdateProfile(body);
  if (path === '/users' && method === 'GET') return searchUsers(options.query);
  let r;
  if (path === '/users/report' && method === 'POST') {
    const uid = await requireUid();
    const { data, error } = await supabase.from('user_reports').insert({
      reporter_id: uid,
      reported_user_id: body.reportedUserId || null,
      reported_username: body.reportedUsername || null,
      reported_full_name: body.reportedFullName || null,
      reason: body.reason,
      details: body.details,
    }).select('*').maybeSingle();
    return camel(ok(data, error));
  }
  if ((r = m(/^\/users\/([^/]+)$/)) && method === 'GET') return getUserByUsername(r[1]);

  // Skills
  if (path === '/skills/offered' && method === 'GET') return listSkills('skills_offered');
  if (path === '/skills/offered' && method === 'POST') return createSkill('skills_offered', body);
  if ((r = m(/^\/skills\/offered\/([^/]+)$/)) && method === 'PATCH') return updateSkill('skills_offered', r[1], body);
  if ((r = m(/^\/skills\/offered\/([^/]+)$/)) && method === 'DELETE') return deleteSkill('skills_offered', r[1]);
  if (path === '/skills/wanted' && method === 'GET') return listSkills('skills_wanted');
  if (path === '/skills/wanted' && method === 'POST') return createSkill('skills_wanted', body);
  if ((r = m(/^\/skills\/wanted\/([^/]+)$/)) && method === 'PATCH') return updateSkill('skills_wanted', r[1], body);
  if ((r = m(/^\/skills\/wanted\/([^/]+)$/)) && method === 'DELETE') return deleteSkill('skills_wanted', r[1]);

  // Sessions
  if (path === '/sessions/request' && method === 'POST') return createSession(body);
  if (path === '/sessions/my' && method === 'GET') return listMySessions();
  if (path === '/sessions/feed' && method === 'GET') return listActiveSessions();
  if ((r = m(/^\/sessions\/([^/]+)\/status$/)) && method === 'PATCH') return updateSessionStatus(r[1], body);
  if ((r = m(/^\/sessions\/([^/]+)\/reschedule$/)) && method === 'PATCH') return rescheduleSession(r[1], body);
  if ((r = m(/^\/sessions\/([^/]+)\/meeting\/join$/)) && method === 'POST') return joinSessionSeat(r[1], body);
  if ((r = m(/^\/sessions\/([^/]+)$/)) && method === 'DELETE') return deleteSession(r[1]);
  if ((r = m(/^\/sessions\/([^/]+)$/)) && method === 'GET') {
    const { data, error } = await supabase.from('sessions').select('*').eq('id', r[1]).maybeSingle();
    return camel(ok(data, error));
  }

  // Messages
  if (path === '/messages/threads' && method === 'GET') return listMessageThreads();
  if (path === '/messages' && method === 'POST') return sendMessage(body);
  if ((r = m(/^\/messages\/([^/]+)$/)) && method === 'GET') return listMessagesWith(r[1]);
  if ((r = m(/^\/messages\/([^/]+)\/read$/)) && method === 'PATCH') {
    const { data, error } = await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('id', r[1]).select('*').maybeSingle();
    return camel(ok(data, error));
  }

  // Community
  if (path === '/community' && method === 'GET') return listCommunityPosts(options.query);
  if (path === '/community' && method === 'POST') return createCommunityPost(body);
  if ((r = m(/^\/community\/([^/]+)\/vote$/)) && method === 'POST') return voteCommunity(r[1]);
  if ((r = m(/^\/community\/([^/]+)\/comments$/)) && method === 'POST') return addCommunityComment(r[1], body);

  // Wallet
  if (path === '/wallet/me' && method === 'GET') return getMyWallet();
  if (path === '/wallet/history' && method === 'GET') return getWalletHistory();
  if (path === '/wallet/loan' && method === 'POST') return walletLoan(body);
  if (path === '/wallet/loan/repay' && method === 'POST') return walletRepay(body);
  if (path === '/wallet/purchase' && method === 'POST') return walletPurchase(body);

  // Reviews
  if (path === '/reviews' && method === 'POST') return createReview(body);
  if ((r = m(/^\/reviews\/user\/([^/]+)$/)) && method === 'GET') return listUserReviews(r[1]);

  // Notifications
  if (path === '/notifications' && method === 'GET') return listNotifications();
  if ((r = m(/^\/notifications\/([^/]+)\/read$/)) && method === 'PATCH') return markNotificationRead(r[1]);

  // Matches
  if (path === '/match/swipe' && method === 'POST') return recordSwipe(body);

  // Quests
  if (path === '/quests' && method === 'GET') return listQuests();
  if (path === '/quests' && method === 'POST') return createQuest(body);
  if ((r = m(/^\/quests\/([^/]+)\/accept$/)) && method === 'PATCH') return acceptQuest(r[1]);
  if ((r = m(/^\/quests\/([^/]+)\/complete$/)) && method === 'PATCH') return completeQuest(r[1], body);

  // Qualification (teacher applications)
  if (path === '/qualifications/teacher-applications' && method === 'POST') return cloudSubmitTeacherApplication(body);
  if (path === '/qualifications/teacher-applications/me' && method === 'GET') {
    const uid = await requireUid();
    const { data, error } = await supabase.from('teacher_applications').select('*').eq('user_id', uid).order('created_at', { ascending: false });
    return camel(ok(data, error));
  }

  // Verification
  if (path === '/verifications' && method === 'POST') {
    const uid = await requireUid();
    const row = snake(body); row.user_id = uid;
    const { data, error } = await supabase.from('verification_requests').insert(row).select('*').maybeSingle();
    return camel(ok(data, error));
  }
  if (path === '/verifications/me' && method === 'GET') {
    const uid = await requireUid();
    const { data, error } = await supabase.from('verification_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false });
    return camel(ok(data, error));
  }

  throw new Error(`Unsupported API route: ${method} ${path}`);
}

async function adminApiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(options.body) : undefined;
  const m = (re) => path.match(re);

  // Ensure the current session belongs to an admin.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Admin session expired. Please log in again.');
  const { data: roleRow } = await supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
  if (!roleRow) throw new Error('Admin privileges required.');

  let r;
  if (path === '/admin/teacher-applications' && method === 'GET') return cloudListAdminApplications();
  if ((r = m(/^\/admin\/teacher-applications\/([^/]+)$/)) && method === 'PATCH') return cloudReviewApplication(r[1], body);

  if (path === '/admin/stats' && method === 'GET') {
    const [u, s, t, ap] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('sessions').select('id', { count: 'exact', head: true }),
      supabase.from('credit_transactions').select('id', { count: 'exact', head: true }),
      supabase.from('teacher_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    return { users: u.count || 0, sessions: s.count || 0, transactions: t.count || 0, pendingApplications: ap.count || 0 };
  }
  if (path === '/admin/users' && method === 'GET') {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(200);
    return camel(ok(data, error));
  }
  if ((r = m(/^\/admin\/users\/([^/]+)\/suspend$/)) && method === 'PATCH') {
    const token = sessionData?.session?.access_token;
    const res = await fetch(`/api/admin/users/${r[1]}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ suspend: !!body?.suspend }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to suspend');
    return res.json();
  }
  if ((r = m(/^\/admin\/users\/([^/]+)$/)) && method === 'DELETE') {
    const token = sessionData?.session?.access_token;
    const res = await fetch(`/api/admin/users/${r[1]}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to delete');
    return res.json();
  }
  if (path === '/admin/sessions' && method === 'GET') {
    const { data, error } = await supabase.from('sessions').select('*').order('created_at', { ascending: false }).limit(200);
    return camel(ok(data, error));
  }
  if (path === '/admin/transactions' && method === 'GET') {
    const { data, error } = await supabase.from('credit_transactions').select('*').order('created_at', { ascending: false }).limit(200);
    return camel(ok(data, error));
  }
  if (path === '/admin/reports' && method === 'GET') {
    const { data, error } = await supabase.from('user_reports').select('*').order('created_at', { ascending: false }).limit(200);
    return camel(ok(data, error));
  }
  if ((r = m(/^\/admin\/reports\/([^/]+)$/)) && method === 'PATCH') {
    const { data, error } = await supabase
      .from('user_reports')
      .update({
        status: body?.status,
        admin_note: body?.adminNote,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', r[1])
      .select('*')
      .maybeSingle();
    return camel(ok(data, error));
  }

  throw new Error(`Unsupported admin API route: ${method} ${path}`);
}

function statusToApi(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('approve')) return 'approved';
  if (value.includes('reject')) return 'rejected';
  if (value.includes('info')) return 'needs_more_info';
  return 'pending';
}

function statusToLabel(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  if (value === 'needs_more_info') return 'Needs More Info';
  if (value === 'pending') return 'Pending';
  return status || 'Pending';
}

function normalizeTeacherApplicationFromApi(item) {
  return {
    id: item._id || item.id,
    source: 'backend',
    userId: item.user?._id || item.user,
    userName: item.user?.fullName || item.userName || 'Applicant',
    username: item.user?.username || item.username || 'applicant',
    email: item.user?.email || item.email || '',
    subject: item.subject,
    requestedRole: item.requestedRole,
    learnerLevel: item.learnerLevel,
    teacherLevelClaim: item.teacherLevelClaim,
    linkedInUrl: item.linkedInUrl,
    cvUrl: item.cvUrl,
    licenseUrl: item.licenseUrl,
    authorityName: item.authorityName,
    note: item.note,
    status: statusToLabel(item.status),
    submittedAt: item.createdAt || item.submittedAt,
    adminNote: item.adminNote,
    reviewedAt: item.reviewedAt,
    reviewTrail: item.reviewedAt ? [{ at: item.reviewedAt, action: statusToLabel(item.status), by: 'Admin', note: item.adminNote }] : [],
  };
}
const CATEGORIES = [
  'All',
  'Design',
  'Development',
  'Language',
  'Business',
  'Marketing',
  'Academic',
  'Creative',
];

const LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced', 'Expert'];

const LANGUAGE_OPTIONS = [
  'Myanmar', 'English', 'Japanese', 'Korean', 'Chinese', 'Thai', 'Hindi', 'Spanish', 'French', 'German', 'Other'
];

const REGION_OPTIONS = [
  'Yangon, Myanmar', 'Mandalay, Myanmar', 'Naypyidaw, Myanmar', 'Bago, Myanmar', 'Taunggyi, Myanmar', 'Mawlamyine, Myanmar', 'Pathein, Myanmar', 'Sittwe, Myanmar', 'Myitkyina, Myanmar', 'Remote / Online', 'Other'
];

const XP_LEVELS = [
  { name: 'Beginner', min: 0, next: 100 },
  { name: 'Explorer', min: 100, next: 250 },
  { name: 'Learner', min: 250, next: 500 },
  { name: 'Contributor', min: 500, next: 900 },
  { name: 'Mentor', min: 900, next: 1400 },
  { name: 'Expert', min: 1400, next: 2200 },
  { name: 'Master', min: 2200, next: 3200 },
];

const DEFAULT_USER = {
  id: 'u001',
  fullName: 'Aung Min Thu',
  username: 'aungmin',
  email: 'aung@example.com',
  avatar: 'AM',
  bio: 'Frontend learner and part-time mentor interested in UI/UX, English speaking, and web development.',
  region: 'Yangon, Myanmar',
  age: 22,
  languages: ['Myanmar', 'English'],
  interests: ['UI/UX Design', 'English Speaking', 'Web Development'],
  education: 'BSc Computing Student',
  work: 'Freelance Web Designer',
  portfolio: 'https://portfolio.example.com',
  social: 'https://linkedin.com/in/aungmin',
  role: 'Learner',
  rawRole: 'learner',
  learnerLevel: 'Japanese N5 / Beginner',
  teacherLevel: 'Not eligible yet',
  licenseStatus: 'Not submitted',
  teacherPath: 'Learner first → Assistant Teacher → Teacher',
  subjectLevels: [
    { subject: 'Japanese', learnerLevel: 'N5', teacherLevel: 'N1 required' },
    { subject: 'English Speaking', learnerLevel: 'Intermediate', teacherLevel: 'Advanced required' },
  ],
  theme: 'light',
  privacy: 'Community visible',
  notifications: true,
  twoFactor: false,
  xp: 160,
  streak: 5,
  wallet: {
    current: 6.5,
    earned: 13.5,
    spent: 7,
    loanOutstanding: 0,
    loanDueDate: '',
    purchased: 0,
    lectureAccess: 0,
  },
  skillsOffered: [
    {
      id: 's001',
      name: 'UI/UX Design',
      category: 'Design',
      description: 'Wireframes, design thinking, simple portfolio reviews.',
      level: 'Intermediate',
      availability: 'Weekends',
      duration: 1.5,
    },
    {
      id: 's002',
      name: 'Web Development',
      category: 'Development',
      description: 'HTML, CSS, React basics and responsive layouts.',
      level: 'Intermediate',
      availability: 'Evenings',
      duration: 2,
    },
  ],
  skillsWanted: [
    {
      id: 'w001',
      name: 'English Speaking',
      category: 'Language',
      goal: 'Improve presentation confidence.',
      target: 'Advanced',
    },
    {
      id: 'w002',
      name: 'Digital Marketing',
      category: 'Marketing',
      goal: 'Learn social media campaign planning.',
      target: 'Intermediate',
    },
  ],
  badges: ['First Exchange', 'First Skill Shared', 'Community Helper'],
};

const PEOPLE = [
  {
    id: 'u002',
    fullName: 'May Thet Hnin',
    username: 'maythet',
    avatar: 'MT',
    bio: 'English speaking coach helping students with confidence and interview practice.',
    region: 'Mandalay, Myanmar',
    languages: ['Myanmar', 'English'],
    interests: ['English Speaking', 'Public Speaking', 'Interview Practice'],
    reputation: 94,
    rating: 4.9,
    completion: 98,
    hoursShared: 86,
    studentLimit: 8,
    offered: [
      { name: 'English Speaking', category: 'Language', level: 'Expert', certificate: 'TESOL demo certificate', creditRatePerMinute: 0.0167, duration: 1 },
      { name: 'Public Speaking', category: 'Business', level: 'Advanced', certificate: 'Public Speaking Coach Level 2', creditRatePerMinute: 0.0167, duration: 1.5 },
    ],
    wanted: [
      { name: 'UI/UX Design', category: 'Design', target: 'Intermediate' },
      { name: 'Video Editing', category: 'Creative', target: 'Beginner' },
    ],
  },
  {
    id: 'u003',
    fullName: 'Ko Hein Htet',
    username: 'heinhtetdev',
    avatar: 'HH',
    bio: 'Full-stack developer sharing Laravel, React, and database design sessions.',
    region: 'Yangon, Myanmar',
    languages: ['Myanmar', 'English'],
    interests: ['Web Development', 'Database Design', 'React'],
    reputation: 88,
    rating: 4.7,
    completion: 92,
    hoursShared: 64,
    studentLimit: 6,
    offered: [
      { name: 'Web Development', category: 'Development', level: 'Advanced', certificate: 'Full-stack project portfolio verified', creditRatePerMinute: 0.0167, duration: 2 },
      { name: 'Database Design', category: 'Development', level: 'Intermediate', certificate: 'Database fundamentals certificate', creditRatePerMinute: 0.0167, duration: 1.5 },
    ],
    wanted: [
      { name: 'Digital Marketing', category: 'Marketing', target: 'Intermediate' },
      { name: 'Graphic Design', category: 'Design', target: 'Beginner' },
    ],
  },
  {
    id: 'u004',
    fullName: 'Su Myat Noe',
    username: 'sumyatcreative',
    avatar: 'SN',
    bio: 'Graphic designer and video editor who wants to learn web development.',
    region: 'Naypyidaw, Myanmar',
    languages: ['Myanmar'],
    interests: ['Graphic Design', 'Video Editing', 'Creative'],
    reputation: 82,
    rating: 4.6,
    completion: 89,
    hoursShared: 43,
    studentLimit: 5,
    offered: [
      { name: 'Graphic Design', category: 'Design', level: 'Advanced', certificate: 'Adobe portfolio verified', creditRatePerMinute: 0.0167, duration: 1.5 },
      { name: 'Video Editing', category: 'Creative', level: 'Intermediate', certificate: 'Editing project portfolio', creditRatePerMinute: 0.0167, duration: 2 },
    ],
    wanted: [
      { name: 'Web Development', category: 'Development', target: 'Beginner' },
      { name: 'English Speaking', category: 'Language', target: 'Intermediate' },
    ],
  },
  {
    id: 'u005',
    fullName: 'David Chan',
    username: 'davidbiz',
    avatar: 'DC',
    bio: 'Digital marketer teaching content strategy, SEO basics, and startup growth.',
    region: 'Yangon, Myanmar',
    languages: ['English', 'Myanmar'],
    interests: ['Digital Marketing', 'Startup Planning', 'Business'],
    reputation: 91,
    rating: 4.8,
    completion: 96,
    hoursShared: 72,
    studentLimit: 6,
    offered: [
      { name: 'Digital Marketing', category: 'Marketing', level: 'Advanced', certificate: 'Google Ads / SEO portfolio verified', creditRatePerMinute: 0.0167, duration: 1.5 },
      { name: 'Startup Planning', category: 'Business', level: 'Intermediate', certificate: 'Startup mentor portfolio', creditRatePerMinute: 0.0167, duration: 1 },
    ],
    wanted: [
      { name: 'UI/UX Design', category: 'Design', target: 'Intermediate' },
      { name: 'Mathematics', category: 'Academic', target: 'Beginner' },
    ],
  },
];

const INITIAL_SESSIONS = [
  {
    id: 'ss001',
    topic: 'English Speaking Practice',
    teacher: 'May Thet Hnin',
    learner: 'Aung Min Thu',
    date: '2026-06-25',
    time: '19:00',
    duration: 1,
    credits: 1,
    creditRatePerMinute: 0.0167,
    studentLimit: 8,
    seatsAvailable: 7,
    status: 'Accepted',
    roomId: '2f3f3a5a-cf10-4421-a9c4-e36f6a0a1111',
    meetingLink: '/meeting/2f3f3a5a-cf10-4421-a9c4-e36f6a0a1111',
    meetingProvider: 'Know-how Room',
    attendance: [],
    actualDurationMinutes: 0,
    verifiedDurationMinutes: 0,
    mentorJoinedAt: '',
    mentorLeftAt: '',
    learnerJoinedAt: '',
    learnerLeftAt: '',
    notes: 'Practice interview introduction and confidence.',
  },
  {
    id: 'ss002',
    topic: 'UI Portfolio Review',
    teacher: 'Aung Min Thu',
    learner: 'David Chan',
    date: '2026-06-28',
    time: '15:00',
    duration: 1.5,
    credits: 1.5,
    creditRatePerMinute: 0.0167,
    studentLimit: 6,
    seatsAvailable: 5,
    status: 'Pending',
    roomId: '7d886553-414d-4cb5-98d5-06b2cbf62222',
    meetingLink: '/meeting/7d886553-414d-4cb5-98d5-06b2cbf62222',
    meetingProvider: 'Know-how Room',
    attendance: [],
    actualDurationMinutes: 0,
    verifiedDurationMinutes: 0,
    mentorJoinedAt: '',
    mentorLeftAt: '',
    learnerJoinedAt: '',
    learnerLeftAt: '',
    notes: 'Review landing page layout and visual hierarchy.',
  },
];

const INITIAL_TRANSACTIONS = [
  { id: 't001', type: 'Earned', title: 'Teaching UI Design', amount: 2, date: '2026-06-12' },
  { id: 't002', type: 'Spent', title: 'Learning English', amount: -1, date: '2026-06-14' },
  { id: 't003', type: 'Earned', title: 'Portfolio Review', amount: 1.5, date: '2026-06-18' },
  { id: 't004', type: 'Spent', title: 'Digital Marketing Session', amount: -1.5, date: '2026-06-20' },
];

const INITIAL_MESSAGES = [
  {
    id: 'm001',
    name: 'May Thet Hnin',
    username: 'maythet',
    type: 'Private',
    body: 'Hi! For our English session, please prepare a short self-introduction.',
    time: 'Today 09:30',
    direction: 'incoming',
    unread: true,
    reaction: '',
  },
  {
    id: 'm002',
    name: 'Design Exchange Circle',
    username: 'design-circle',
    type: 'Group Chat',
    body: 'Group session: 3 people, 2.5 total credits, Saturday 3 PM.',
    time: 'Yesterday 20:15',
    direction: 'incoming',
    unread: false,
    reaction: '👍',
  },
  {
    id: 'm003',
    name: 'Ko Hein Htet',
    username: 'heinhtetdev',
    type: 'Private',
    body: 'I can review your React layout after class. Send the session schedule here.',
    time: 'Yesterday 18:05',
    direction: 'incoming',
    unread: false,
    reaction: '',
  },
  {
    id: 'm004',
    name: 'Nway Oo',
    username: 'nwayoo',
    type: 'Private',
    body: 'Thanks for the UI feedback yesterday! Can we book another slot next week?',
    time: 'Today 08:12',
    direction: 'incoming',
    unread: true,
    reaction: '',
  },
  {
    id: 'm005',
    name: 'Phyo Wai',
    username: 'phyowai',
    type: 'Private',
    body: 'Sent you the Figma link. Let me know when you are free to review.',
    time: 'Yesterday 14:42',
    direction: 'incoming',
    unread: false,
    reaction: '🙏',
  },
  {
    id: 'm006',
    name: 'Japanese N5 Study Group',
    username: 'n5-group',
    type: 'Group Chat',
    body: 'Kira: Reminder — flashcard challenge starts tonight at 8 PM!',
    time: 'Today 07:55',
    direction: 'incoming',
    unread: true,
    reaction: '',
  },
  {
    id: 'm007',
    name: 'React Builders Circle',
    username: 'react-circle',
    type: 'Group Chat',
    body: 'Htet: Anyone tried TanStack Start with Supabase? Sharing notes after the session.',
    time: 'Yesterday 22:10',
    direction: 'incoming',
    unread: false,
    reaction: '🔥',
  },
  {
    id: 'm008',
    name: 'IELTS Speaking Squad',
    username: 'ielts-squad',
    type: 'Group Chat',
    body: 'May: Cue card practice this Sunday 10 AM. React if joining.',
    time: '2 days ago',
    direction: 'incoming',
    unread: false,
    reaction: '✅',
  },
];

const CHALLENGES = [
  { title: 'Complete 3 learning sessions this week', progress: 1, total: 3, reward: 40 },
  { title: 'Teach 2 hours this month', progress: 1.5, total: 2, reward: 60 },
  { title: 'Review 5 sessions', progress: 2, total: 5, reward: 30 },
];



const INITIAL_TEACHER_APPLICATIONS = [
  {
    id: 'ta-demo-001',
    source: 'demo',
    userId: 'u002',
    userName: 'May Thet Hnin',
    username: 'maythet',
    email: 'may@example.com',
    subject: 'English Speaking',
    requestedRole: 'teacher',
    learnerLevel: 'Advanced',
    teacherLevelClaim: 'IELTS coach / Advanced conversation mentor',
    linkedInUrl: 'https://linkedin.com/in/maythet-demo',
    cvUrl: 'https://example.com/may-cv.pdf',
    licenseUrl: 'https://example.com/may-certificate.pdf',
    authorityName: 'Demo Language Center',
    note: 'Wants to teach interview practice and speaking confidence.',
    status: 'Pending',
    submittedAt: '2026-06-23T09:00:00.000Z',
    reviewTrail: [],
  },
];

const INITIAL_COMMUNITY_POSTS = [
  {
    id: 'c001',
    community: 'Japanese N5 Learners',
    title: 'How do I remember particles は and が?',
    body: 'I keep confusing topic and subject particles. Any quick examples or memory tips?',
    author: 'Aung Min Thu',
    votes: 42,
    comments: ['Use は for topic contrast and が when introducing new subject.', 'Try sentence cards with one missing particle.'],
    tags: ['Japanese', 'N5', 'Language'],
  },
  {
    id: 'c002',
    community: 'Video Editing',
    title: 'Need a simple color grading workflow',
    body: 'I only need a few tips, not a full 1-hour session. What should I fix first?',
    author: 'Su Myat Noe',
    votes: 28,
    comments: ['Balance exposure first, then white balance, then creative look.'],
    tags: ['Video Editing', 'Creative'],
  },
];

const INITIAL_QUESTS = [];

const CREDIT_PRODUCTS = [
  { id: 'cp01', title: '1 Credit Point', credits: 1, price: '$5', productType: 'credit_points' },
  { id: 'cp02', title: '3 Credit Points', credits: 3, price: '$14', productType: 'credit_points' },
  { id: 'cp03', title: '5 Credit Points', credits: 5, price: '$22', productType: 'credit_points' },
];

const SAMPLE_VIDEO_BASE = 'https://test-videos.co.uk/vids';
const SAMPLE_POSTER_BASE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images';
const LECTURE_VIDEOS = [
  { id: 'free-ui-basics', title: 'UI/UX Basics for Beginners', teacher: 'Ei Mon', category: 'Design', duration: '18 min', level: 'Beginner', priceCredits: 0, description: 'A quick free starter lesson about layout, spacing, and visual hierarchy.', badge: 'Free', videoUrl: `${SAMPLE_VIDEO_BASE}/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4`, poster: `${SAMPLE_POSTER_BASE}/ForBiggerBlazes.jpg` },
  { id: 'free-english-speaking', title: 'Daily English Speaking Warmups', teacher: 'Aung Min Thu', category: 'Language', duration: '12 min', level: 'Beginner', priceCredits: 0, description: 'Practice confidence, pronunciation, and simple conversation patterns.', badge: 'Free', videoUrl: `${SAMPLE_VIDEO_BASE}/sintel/mp4/h264/720/Sintel_720_10s_5MB.mp4`, poster: `${SAMPLE_POSTER_BASE}/ForBiggerEscapes.jpg` },
  { id: 'paid-react-project', title: 'Build a React Mini Project', teacher: 'May Thandar', category: 'Programming', duration: '54 min', level: 'Intermediate', priceCredits: 1.5, description: 'A practical teacher-posted lecture for building components, state, and clean UI.', badge: 'Premium', videoUrl: `${SAMPLE_VIDEO_BASE}/jellyfish/mp4/h264/720/Jellyfish_720_10s_5MB.mp4`, poster: `${SAMPLE_POSTER_BASE}/ForBiggerFun.jpg` },
  { id: 'paid-video-editing', title: 'Video Editing Workflow Masterclass', teacher: 'Su Myat Noe', category: 'Creative', duration: '47 min', level: 'Intermediate', priceCredits: 1.25, description: 'Learn timeline setup, cuts, color correction, captions, and export settings.', badge: 'Premium', videoUrl: `${SAMPLE_VIDEO_BASE}/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4`, poster: `${SAMPLE_POSTER_BASE}/ForBiggerJoyrides.jpg` },
  { id: 'paid-japanese-n5', title: 'Japanese N5 Grammar Pack', teacher: 'Hnin Wai', category: 'Language', duration: '63 min', level: 'N5', priceCredits: 1.75, description: 'Structured grammar explanations with examples and short review tasks.', badge: 'Premium', videoUrl: `${SAMPLE_VIDEO_BASE}/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4`, poster: `${SAMPLE_POSTER_BASE}/ForBiggerMeltdowns.jpg` },
];

const LOAN_POLICY = {
  min: 0.5,
  maxOutstanding: 5,
  maxSingleLoan: 5,
  minDays: 7,
  maxDays: 7,
};

const TEACHING_ALLOWED_ROLES = ['assistant_teacher', 'teacher', 'community_mentor', 'administrator'];
const CREDIT_PER_MINUTE = 1 / 60;
const CREDIT_PRICE_TABLE = [
  { minutes: 1, credits: 0.0167 },
  { minutes: 5, credits: 0.0833 },
  { minutes: 10, credits: 0.1667 },
  { minutes: 15, credits: 0.25 },
  { minutes: 30, credits: 0.5 },
  { minutes: 45, credits: 0.75 },
  { minutes: 60, credits: 1 },
];
const TEACHER_LEVEL_RATES = {
  beginner: CREDIT_PER_MINUTE,
  intermediate: CREDIT_PER_MINUTE,
  advanced: CREDIT_PER_MINUTE,
  expert: CREDIT_PER_MINUTE,
  certified: CREDIT_PER_MINUTE,
};
const DEFAULT_STUDENT_LIMIT_BY_LEVEL = {
  beginner: 2,
  intermediate: 4,
  advanced: 6,
  expert: 8,
  certified: 10,
};

function normalizeLevel(value = '') {
  const text = normalizeText(value);
  if (text.includes('cert')) return 'certified';
  if (text.includes('expert') || text.includes('n1')) return 'expert';
  if (text.includes('advanced') || text.includes('n2')) return 'advanced';
  if (text.includes('intermediate') || text.includes('n3')) return 'intermediate';
  return 'beginner';
}

function minutesToCredits(minutes = 0) {
  return Number((Math.max(0, Number(minutes) || 0) / 60).toFixed(4));
}

function formatCredits(value = 0) {
  const num = Number(value) || 0;
  return Number(num.toFixed(4)).toString();
}

function getCreditTableLabel(minutes = 0) {
  const exact = CREDIT_PRICE_TABLE.find((item) => item.minutes === Number(minutes));
  if (exact) return `${exact.minutes} min = ${formatCredits(exact.credits)} credit`;
  return `${Number(minutes) || 0} min = ${formatCredits(minutesToCredits(minutes))} credit`;
}

function getSkillRatePerMinute() {
  return CREDIT_PER_MINUTE;
}

function getPersonCertificateSummary(person = {}) {
  const offered = person.offered || person.skillsOffered || [];
  if (!offered.length) return 'No teaching certificate/level listed yet';
  return offered.map((skill) => `${skill.name}: ${skill.level || 'Level not set'}${skill.certificate ? ` • ${skill.certificate}` : ''}`).join(' | ');
}

function findBestTeachingSkill(person = {}, topic = '') {
  const offered = person.offered || person.skillsOffered || [];
  if (!offered.length) return null;
  const normalizedTopic = normalizeText(topic);
  return offered.find((skill) => normalizedTopic && normalizeText(`${skill.name} ${skill.category}`).includes(normalizedTopic))
    || offered.find((skill) => normalizedTopic && normalizedTopic.includes(normalizeText(skill.name)))
    || offered[0];
}

function getTeacherRateInfo(person = {}, topic = '') {
  const skill = findBestTeachingSkill(person, topic) || {};
  const level = skill.level || 'Beginner';
  const rate = getSkillRatePerMinute(skill);
  return { skill, level, rate, label: `${level} • standard time credit pricing` };
}

function getSeatLimitForPerson(person = {}) {
  if (Number(person.studentLimit) > 0) return Number(person.studentLimit);
  const bestSkill = findBestTeachingSkill(person) || {};
  return DEFAULT_STUDENT_LIMIT_BY_LEVEL[normalizeLevel(bestSkill.level)] || 3;
}

function getTeacherSeatInfo(person = {}, sessions = []) {
  const limit = getSeatLimitForPerson(person);
  const activeBookings = sessions.filter((session) =>
    session.teacher === person.fullName && !['Completed', 'Cancelled', 'Rejected'].includes(session.status)
  ).length;
  const available = Math.max(0, limit - activeBookings);
  return { limit, activeBookings, available, full: available <= 0 };
}

function getTeacherForName(name = '') {
  return PEOPLE.find((person) => person.fullName === name || person.username === name || normalizeText(person.fullName) === normalizeText(name));
}

function getScheduledMinutes(session = {}) {
  if (session.durationMinutes !== undefined && session.durationMinutes !== null) return Number(session.durationMinutes) || 0;
  if (session.durationHours !== undefined && session.durationHours !== null) return Number(session.durationHours) * 60 || 0;
  const raw = Number(session.duration || 0);
  return raw > 12 ? raw : raw * 60;
}

function getBillableMinutes(session = {}) {
  const verified = Number(session.verifiedDurationMinutes || 0);
  const actual = Number(session.actualDurationMinutes || 0);
  if (verified > 0) return verified;
  if (actual > 0) return actual;
  return getScheduledMinutes(session);
}

function getSessionCreditRate(session = {}) {
  return Number(session.creditRatePerMinute || session.ratePerMinute || CREDIT_PER_MINUTE);
}

function getBillableCredits(session = {}) {
  return minutesToCredits(getBillableMinutes(session), getSessionCreditRate(session));
}

function createSecureRoomId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `room-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function buildJitsiRoomName(roomId = '') {
  const safeId = String(roomId || createSecureRoomId()).replace(/[^a-zA-Z0-9]/g, '');
  return `KnowHow-${safeId}`;
}

function buildMeetingUrl(roomId) {
  return `https://meet.jit.si/${buildJitsiRoomName(roomId)}`;
}

function isExternalMeetingLink(link = '') {
  return /^https?:\/\//i.test(link);
}

function getSessionRoom(session) {
  return session.roomId || session.meetingRoomId || '';
}

// ============== Ads system ==============
const AD_LIBRARY = [
  {
    id: 'ad-skillbridge',
    sponsor: 'SkillBridge',
    title: 'Level up faster with SkillBridge',
    body: 'Personalized learning paths curated by top mentors. Try 7 days free.',
    cta: 'Start free trial',
    url: 'https://example.com/skillbridge',
    color: '#3b82f6',
  },
  {
    id: 'ad-notebloom',
    sponsor: 'NoteBloom',
    title: 'Smarter notes for serious learners',
    body: 'Capture lecture highlights, sync flashcards, and review in seconds.',
    cta: 'Get NoteBloom',
    url: 'https://example.com/notebloom',
    color: '#10b981',
  },
  {
    id: 'ad-focusbean',
    sponsor: 'FocusBean Coffee',
    title: 'Fuel your study streaks',
    body: 'Single-origin beans, delivered fresh. 15% off your first bag with KNOWHOW15.',
    cta: 'Shop FocusBean',
    url: 'https://example.com/focusbean',
    color: '#f59e0b',
  },
  {
    id: 'ad-lingomate',
    sponsor: 'LingoMate',
    title: 'Practice 30+ languages with AI tutors',
    body: 'Real conversations, instant corrections. Pairs perfectly with Know-how sessions.',
    cta: 'Try LingoMate',
    url: 'https://example.com/lingomate',
    color: '#8b5cf6',
  },
];

function pickRandomAd() {
  return AD_LIBRARY[Math.floor(Math.random() * AD_LIBRARY.length)];
}

function AdOverlay({ ad, placement = 'Sponsored', onClose, skipAfter = 5 }) {
  const [remaining, setRemaining] = useState(skipAfter);
  useEffect(() => {
    if (remaining <= 0) return undefined;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);
  if (!ad) return null;
  const canSkip = remaining <= 0;
  return (
    <div className="modal-backdrop high-modal-backdrop" style={{ zIndex: 2000 }}>
      <div className="modal card" style={{ maxWidth: 480, padding: 0, overflow: 'hidden' }}>
        <div style={{ background: ad.color, color: '#fff', padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <small style={{ opacity: 0.9, letterSpacing: 0.5, textTransform: 'uppercase', fontSize: 11 }}>{placement} · Ad</small>
          <small style={{ opacity: 0.9 }}>{ad.sponsor}</small>
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0 }}>{ad.title}</h3>
          <p className="muted-text" style={{ margin: 0 }}>{ad.body}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8 }}>
            <a className="primary" style={{ textDecoration: 'none', padding: '8px 14px', borderRadius: 8, background: ad.color, color: '#fff' }} href={ad.url} target="_blank" rel="noopener noreferrer">{ad.cta}</a>
            <button type="button" className="ghost" onClick={onClose} disabled={!canSkip} style={{ opacity: canSkip ? 1 : 0.6 }}>
              {canSkip ? 'Skip ad ✕' : `Skip in ${remaining}s`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



function getParticipantRole(session, user) {
  if (session.teacherId && user.id && session.teacherId === user.id) return 'mentor';
  if (session.learnerId && user.id && session.learnerId === user.id) return 'learner';
  if (session.teacher === user.fullName) return 'mentor';
  if (session.learner === user.fullName) return 'learner';
  return '';
}

function saveState(user, sessions, transactions) {
  localStorage.setItem('knowhow-user', JSON.stringify(user));
  localStorage.setItem('knowhow-sessions', JSON.stringify(sessions));
  localStorage.setItem('knowhow-transactions', JSON.stringify(transactions));
}

function loadState(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function loadTeacherApplications() {
  const stored = loadState('knowhow-teacher-applications', null);
  if (stored && Array.isArray(stored)) return stored;
  return INITIAL_TEACHER_APPLICATIONS;
}

function saveTeacherApplications(applications) {
  localStorage.setItem('knowhow-teacher-applications', JSON.stringify(applications));
}

function openChatIntent(contactName) {
  localStorage.setItem('knowhow-open-chat', contactName);
}

function formatNowLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function attachmentLabel(attachment) {
  if (!attachment) return '';
  if (attachment.kind === 'video') return `🎬 ${attachment.name || 'Video'}`;
  if (attachment.kind === 'image') return `📷 ${attachment.name || 'Image'}`;
  return `📎 ${attachment.name || 'Attachment'}`;
}

function messagePreview(message = {}) {
  if (message.attachment) return attachmentLabel(message.attachment);
  return message.body || 'No messages yet';
}


function normalizeWallet(wallet = {}) {
  return {
    current: Number(wallet.current || 0),
    earned: Number(wallet.earned || 0),
    spent: Number(wallet.spent || 0),
    loanOutstanding: Number(wallet.loanOutstanding || 0),
    loanDueDate: wallet.loanDueDate || '',
    purchased: Number(wallet.purchased || 0),
    lectureAccess: Number(wallet.lectureAccess || 0),
  };
}

function canUserTeach(user) {
  return TEACHING_ALLOWED_ROLES.includes(user.rawRole) || ['Assistant Teacher', 'Teacher', 'Community Mentor', 'Administrator'].includes(user.role);
}

function isAdminRoute() {
  return window.location.pathname.replace(/\/$/, '') === '/admin' || window.location.hash === '#admin';
}

function getCurrentLevel(xp) {
  let current = XP_LEVELS[0];
  for (const level of XP_LEVELS) {
    if (xp >= level.min) current = level;
  }
  const nextLevel = XP_LEVELS.find((level) => level.min > xp);
  const next = nextLevel?.min ?? current.next;
  const progress = Math.min(100, Math.round(((xp - current.min) / (next - current.min)) * 100));
  return { ...current, next, progress };
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function wordOverlapScore(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = tokenize(b);
  if (!aTokens.size || !bTokens.length) return 0;
  return bTokens.filter((token) => aTokens.has(token)).length;
}

function skillPairScore(wanted = {}, offered = {}) {
  const wantedName = normalizeText(wanted.name);
  const offeredName = normalizeText(offered.name);
  const wantedCategory = normalizeText(wanted.category);
  const offeredCategory = normalizeText(offered.category);
  if (wantedName && offeredName && wantedName === offeredName) return 40;
  if (wantedName && offeredName && (wantedName.includes(offeredName) || offeredName.includes(wantedName))) return 34;
  const overlap = wordOverlapScore(wantedName, offeredName);
  if (overlap > 0) return 25 + Math.min(8, overlap * 3);
  if (wantedCategory && offeredCategory && wantedCategory === offeredCategory) return 20;
  return 0;
}

function calculateVerifiedOverlapMinutes(attendance = [], nowForOpen = '') {
  const merge = (intervals) => {
    const sorted = intervals
      .filter((item) => item.start && item.end && item.end > item.start)
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const item of sorted) {
      const last = merged[merged.length - 1];
      if (!last || item.start > last.end) merged.push({ ...item });
      else last.end = Math.max(last.end, item.end);
    }
    return merged;
  };
  const toIntervals = (role) => merge(attendance
    .filter((item) => item.role === role && item.joinedAt && (item.leftAt || nowForOpen))
    .map((item) => ({ start: new Date(item.joinedAt).getTime(), end: new Date(item.leftAt || nowForOpen).getTime() })));
  const mentors = toIntervals('mentor');
  const learners = toIntervals('learner');
  let overlapMs = 0;
  for (const mentor of mentors) {
    for (const learner of learners) {
      overlapMs += Math.max(0, Math.min(mentor.end, learner.end) - Math.max(mentor.start, learner.start));
    }
  }
  return Number((overlapMs / 60000).toFixed(2));
}

function calculateActualAttendanceMinutes(attendance = [], nowForOpen = '') {
  const totals = attendance.reduce((acc, item) => {
    if (!item.joinedAt || !(item.leftAt || nowForOpen)) return acc;
    const minutes = Math.max(0, (new Date(item.leftAt || nowForOpen).getTime() - new Date(item.joinedAt).getTime()) / 60000);
    acc[item.role] = (acc[item.role] || 0) + minutes;
    return acc;
  }, { mentor: 0, learner: 0 });
  return Number(Math.max(totals.mentor || 0, totals.learner || 0).toFixed(2));
}

function sessionAttendanceFields(attendance = [], nowForOpen = '') {
  const firstJoined = (role) => attendance.filter((item) => item.role === role && item.joinedAt).map((item) => item.joinedAt).sort()[0] || '';
  const lastLeft = (role) => attendance.filter((item) => item.role === role && item.leftAt).map((item) => item.leftAt).sort().at(-1) || '';
  const verifiedDurationMinutes = calculateVerifiedOverlapMinutes(attendance, nowForOpen);
  return {
    mentorJoinedAt: firstJoined('mentor'),
    mentorLeftAt: lastLeft('mentor'),
    learnerJoinedAt: firstJoined('learner'),
    learnerLeftAt: lastLeft('learner'),
    actualDurationMinutes: calculateActualAttendanceMinutes(attendance, nowForOpen),
    verifiedDurationMinutes,
    attendanceVerified: verifiedDurationMinutes > 0,
  };
}

function ensureStoredSessionRoom(session = {}) {
  const roomId = getSessionRoom(session) || createSecureRoomId();
  return {
    ...session,
    roomId,
    meetingLink: session.meetingLink || buildMeetingUrl(roomId),
    meetingProvider: session.meetingProvider || 'Know-how Room',
    meetingSpaceName: session.meetingSpaceName || buildJitsiRoomName(roomId),
  };
}

function calculateMatch(user, person) {
  const wantedToOffered = user.skillsWanted.reduce((sum, wanted) => sum + Math.max(0, ...person.offered.map((offered) => skillPairScore(wanted, offered))), 0);
  const offeredToWanted = user.skillsOffered.reduce((sum, offered) => sum + Math.max(0, ...person.wanted.map((wanted) => skillPairScore(wanted, offered))), 0);
  const sharedLanguages = person.languages.filter((language) => user.languages.includes(language));
  const language = sharedLanguages.length ? 12 : 0;
  const sameRegion = normalizeText(person.region.split(',')[0]) === normalizeText(user.region.split(',')[0]) ? 8 : 0;
  const reputationScore = Math.min(18, Math.round(person.reputation / 6));
  const completionScore = person.completion >= 90 ? 7 : 0;
  const total = Math.min(99, wantedToOffered + offeredToWanted + language + sameRegion + reputationScore + completionScore);
  const reasons = [];
  if (wantedToOffered) reasons.push('Teaches what you want');
  if (offeredToWanted) reasons.push('Wants what you teach');
  if (sharedLanguages.length) reasons.push(`Shared language: ${sharedLanguages.join(', ')}`);
  if (sameRegion) reasons.push('Same region');
  if (person.reputation >= 85) reasons.push('Strong reputation');
  return {
    total,
    reason: reasons.slice(0, 3).join(' • ') || 'General community match',
    directOne: wantedToOffered > 0,
    directTwo: offeredToWanted > 0,
    reasons,
    wantedToOffered,
    offeredToWanted,
  };
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [loggedIn, setLoggedIn] = useState(() => Boolean(localStorage.getItem('knowhow-token')));
  const [authLoading, setAuthLoading] = useState(() => Boolean(localStorage.getItem('knowhow-token')));
  const [user, setUser] = useState(() => {
    const storedUser = loadState('knowhow-user', DEFAULT_USER);
    return { ...storedUser, wallet: normalizeWallet(storedUser.wallet) };
  });
  const [sessions, setSessions] = useState(() => loadState('knowhow-sessions', INITIAL_SESSIONS));
  const [transactions, setTransactions] = useState(() => loadState('knowhow-transactions', INITIAL_TRANSACTIONS));
  const [messages, setMessages] = useState(() => loadState('knowhow-messages', INITIAL_MESSAGES));
  const [communityPosts, setCommunityPosts] = useState(() => loadState('knowhow-community-posts', INITIAL_COMMUNITY_POSTS));

  useEffect(() => {
    let cancelled = false;
    async function syncPosts() {
      try {
        const cloud = await apiRequest('/community');
        if (cancelled || !Array.isArray(cloud)) return;
        setCommunityPosts((prev) => {
          const cloudIds = new Set(cloud.map((p) => p.id));
          const localOnly = (prev || []).filter((p) => !cloudIds.has(p.id) && (INITIAL_COMMUNITY_POSTS || []).some((i) => i.id === p.id));
          const merged = [...cloud, ...localOnly];
          localStorage.setItem('knowhow-community-posts', JSON.stringify(merged));
          return merged;
        });
      } catch (err) { /* ignore */ }
    }
    syncPosts();
    const id = setInterval(syncPosts, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const [teacherApplications, setTeacherApplications] = useState(() => loadTeacherApplications());
  const [adminAuthed, setAdminAuthed] = useState(() => Boolean(localStorage.getItem('knowhow-admin-token')));
  const [adminMode, setAdminMode] = useState(() => isAdminRoute() || Boolean(localStorage.getItem('knowhow-admin-token')));
  const [authToast, setAuthToast] = useState('');
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [cloudPeople, setCloudPeople] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function loadCloudPeople() {
      try {
        const profiles = await apiRequest('/users', { query: '' });
        if (cancelled || !Array.isArray(profiles)) return;
        const mapped = profiles
          .filter((p) => p && p.id && (p.username || p.fullName))
          .map((p) => {
            const prof = p.profile || {};
            const initials = (p.fullName || p.username || '?')
              .split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
            const resolvedRole = roleLabel(p.rawRole || p.role || 'learner');
            return {
              id: p.id,
              fullName: p.fullName || p.username,
              username: p.username || (p.email || '').split('@')[0],
              avatar: initials || '?',
              bio: prof.bio || 'Know-how community member.',
              region: prof.region || '',
              languages: prof.languages || [],
              interests: prof.interests || [],
              reputation: p.xp || 0,
              rating: Number(p.averageRating || 0) || 5,
              completion: 100,
              hoursShared: 0,
              offered: prof.skillsOffered || [],
              wanted: prof.skillsWanted || [],
              email: p.email,
              role: resolvedRole,
              rawRole: p.rawRole || p.role || 'learner',
              teachingProfile: p.teachingProfile || {},
              teacherLevel: p.teachingProfile?.level || (resolvedRole !== 'Learner' ? resolvedRole : ''),
              isCloudUser: true,
            };
          });
        setCloudPeople(mapped);
      } catch (e) {
        // silent; fallback to seed PEOPLE
      }
    }
    loadCloudPeople();
    return () => { cancelled = true; };
  }, [loggedIn]);

  // Sync direct messages with the cloud so conversations appear for both sides.
  useEffect(() => {
    if (!loggedIn || !user?.id) return undefined;
    let cancelled = false;
    async function syncMessages() {
      try {
        const rows = await apiRequest('/messages/threads');
        if (cancelled || !Array.isArray(rows)) return;
        const peopleById = new Map(cloudPeople.map((p) => [p.id, p]));
        const mapped = rows
          .filter((r) => r && r.id && (r.senderId === user.id || r.recipientId === user.id))
          .map((r) => {
            const isOutgoing = r.senderId === user.id;
            const otherId = isOutgoing ? r.recipientId : r.senderId;
            const other = peopleById.get(otherId);
            const otherName = other?.fullName || r.groupName || 'Member';
            const otherUsername = other?.username || (otherName || '').toLowerCase().replace(/\s+/g, '');
            const t = new Date(r.createdAt || Date.now());
            const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return {
              id: r.id,
              name: otherName,
              username: otherUsername,
              type: r.messageType === 'community' ? 'Community message' : 'Private message',
              body: r.body || '',
              attachment: r.attachments || null,
              time,
              direction: isOutgoing ? 'outgoing' : 'incoming',
              unread: !isOutgoing && !r.readAt,
              delivered: true,
              cloudId: r.id,
              createdAt: r.createdAt,
            };
          });
        setMessages((current) => {
          const cloudIds = new Set(mapped.map((m) => m.id));
          const localOnly = (current || []).filter((m) => !cloudIds.has(m.id) && !m.cloudId);
          const merged = [...localOnly, ...mapped].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
          localStorage.setItem('knowhow-messages', JSON.stringify(merged));
          return merged;
        });
      } catch (err) { /* ignore */ }
    }
    syncMessages();
    const id = setInterval(syncMessages, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [loggedIn, user?.id, cloudPeople]);


  // Load active sessions from the cloud so every signed-in user sees teacher-created sessions.
  useEffect(() => {
    if (!loggedIn) return undefined;
    let cancelled = false;
    async function loadCloudSessions() {
      try {
        const cloud = await apiRequest('/sessions/feed');
        if (cancelled || !Array.isArray(cloud)) return;
        setSessions((current) => {
          const cloudIds = new Set(cloud.map((s) => s && s.id).filter(Boolean));
          // Drop previously cloud-backed sessions that no longer exist (e.g. teacher cancelled/deleted them).
          const kept = (current || []).filter((s) => !s?.fromCloud || cloudIds.has(s.id));
          const byId = new Map();
          kept.forEach((s) => { if (s && s.id) byId.set(s.id, s); });
          cloud.forEach((s) => { if (s && s.id) byId.set(s.id, { ...(byId.get(s.id) || {}), ...s }); });
          return Array.from(byId.values());
        });
      } catch (e) {
        // silent — local seed continues to work
      }
    }
    loadCloudSessions();
    const interval = window.setInterval(loadCloudSessions, 15000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [loggedIn]);

  const allPeople = useMemo(() => {
    const map = new Map();
    [...PEOPLE, ...cloudPeople].forEach((p) => {
      const key = (p.username || p.id || '').toLowerCase();
      if (!key) return;
      if (p.isCloudUser || !map.has(key)) map.set(key, p);
    });
    // exclude current logged-in user from search list
    if (user?.username) map.delete(user.username.toLowerCase());
    return Array.from(map.values());
  }, [cloudPeople, user?.username]);

  useEffect(() => {
    const syncAdminRoute = () => setAdminMode(isAdminRoute() || Boolean(localStorage.getItem('knowhow-admin-token')));
    window.addEventListener('hashchange', syncAdminRoute);
    window.addEventListener('popstate', syncAdminRoute);
    return () => {
      window.removeEventListener('hashchange', syncAdminRoute);
      window.removeEventListener('popstate', syncAdminRoute);
    };
  }, []);

  useEffect(() => {
    if (!authToast) return undefined;
    const timer = window.setTimeout(() => setAuthToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [authToast]);


  function updateMessages(nextMessages) {
    setMessages(nextMessages);
    localStorage.setItem('knowhow-messages', JSON.stringify(nextMessages));
  }


  function updateTeacherApplications(nextApplications) {
    setTeacherApplications(nextApplications);
    saveTeacherApplications(nextApplications);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleMeetStatus = params.get('googleMeet');
    if (googleMeetStatus) {
      setPage('sessions');
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function hydrateFromSupabase() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) return false;
        localStorage.setItem('knowhow-token', accessToken);
        const me = await apiRequest('/auth/me');
        if (cancelled) return true;
        const normalized = normalizeBackendUser(me.user, me.wallet);
        const nextUser = { ...normalized, wallet: normalizeWallet(normalized.wallet) };
        setUser(nextUser);
        saveState(nextUser, sessions, transactions);
        setLoggedIn(true);
        return true;
      } catch {
        return false;
      }
    }

    async function loadCurrentUser() {
      const token = localStorage.getItem('knowhow-token');
      if (!token) {
        const hydrated = await hydrateFromSupabase();
        if (!cancelled) setAuthLoading(false);
        return;
      }
      try {
        const data = await apiRequest('/auth/me');
        const normalized = normalizeBackendUser(data.user, data.wallet);
        const nextUser = { ...normalized, wallet: normalizeWallet(normalized.wallet) };
        setUser(nextUser);
        saveState(nextUser, sessions, transactions);
        setLoggedIn(true);
      } catch (error) {
        localStorage.removeItem('knowhow-token');
        localStorage.removeItem('knowhow-user');
        const hydrated = await hydrateFromSupabase();
        if (!hydrated && !cancelled) setLoggedIn(false);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }

    loadCurrentUser();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.access_token) {
        hydrateFromSupabase();
      }
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem('knowhow-token');
        localStorage.removeItem('knowhow-user');
        setLoggedIn(false);
      }
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const level = getCurrentLevel(user.xp);

  function handleAuthSuccess({ token, user: apiUser, wallet, authAction }) {
    localStorage.setItem('knowhow-token', token);
    const normalized = normalizeBackendUser(apiUser, wallet);
    const nextUser = { ...normalized, wallet: normalizeWallet(normalized.wallet) };
    setUser(nextUser);
    saveState(nextUser, sessions, transactions);
    setLoggedIn(true);
    setAuthToast(authAction === 'register' ? 'Account created successfully' : 'Login successful');
  }

  function handleLogout() {
    localStorage.removeItem('knowhow-token');
    localStorage.removeItem('knowhow-user');
    supabase.auth.signOut().catch(() => {});
    setLoggedIn(false);
  }

  function updateUser(nextUserOrUpdater) {
    setUser((currentUser) => {
      const resolved = typeof nextUserOrUpdater === 'function' ? nextUserOrUpdater(currentUser) : nextUserOrUpdater;
      if (!resolved) return currentUser;
      const normalized = { ...resolved, wallet: normalizeWallet(resolved.wallet) };
      saveState(normalized, sessions, transactions);
      return normalized;
    });
  }

  function updateSessions(nextSessions) {
    setSessions(nextSessions);
    saveState(user, nextSessions, transactions);
  }

  function updateTransactions(nextTransactions, nextUser = user) {
    setTransactions(nextTransactions);
    saveState(nextUser, sessions, nextTransactions);
  }

  if (adminMode) {
    return (
      <AdminShell
        adminAuthed={adminAuthed}
        setAdminAuthed={setAdminAuthed}
        setAdminMode={setAdminMode}
        sessions={sessions}
        people={allPeople}
        transactions={transactions}
        userTheme={user.theme}
        teacherApplications={teacherApplications}
        setTeacherApplications={updateTeacherApplications}
        setUser={updateUser}
      />
    );
  }

  if (authLoading) {
    return <div className="auth-shell"><section className="auth-card glass"><h1>Loading Know-how...</h1><p>Checking your saved login.</p></section></div>;
  }

  if (!loggedIn) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  const pages = {
    dashboard: <Dashboard user={user} level={level} sessions={sessions} setPage={setPage} />,
    search: <SearchPage user={user} people={allPeople} posts={communityPosts} sessions={sessions} messages={messages} setMessages={updateMessages} setPage={setPage} initialQuery={navSearchQuery} />,
    wallet: <WalletPage user={user} setUser={updateUser} transactions={transactions} setTransactions={updateTransactions} />,
    sessions: <SessionsPage user={user} setUser={updateUser} sessions={sessions} setSessions={updateSessions} transactions={transactions} setTransactions={updateTransactions} setPage={setPage} />,
    community: <CommunityPage user={user} posts={communityPosts} setPosts={(next) => { setCommunityPosts(next); localStorage.setItem('knowhow-community-posts', JSON.stringify(next)); }} />,
    video: <VideoPanelPage user={user} setUser={updateUser} />,
    friends: <FriendPage user={user} people={allPeople} setPage={setPage} setNavSearchQuery={setNavSearchQuery} />,
    messages: <MessagesPage messages={messages} setMessages={updateMessages} sessions={sessions} setSessions={updateSessions} user={user} people={allPeople} setPage={setPage} />,
    profile: <ProfilePage user={user} setUser={updateUser} level={level} teacherApplications={teacherApplications} setTeacherApplications={updateTeacherApplications} />,
    settings: <SettingsPage user={user} setUser={updateUser} onLogout={handleLogout} />,
  };

  return (
    <div className={`app ${user.theme === 'dark' ? 'dark' : ''}`}>
      {authToast && <SuccessToast message={authToast} />}
      <Sidebar page={page} setPage={setPage} user={user} level={level} navSearchQuery={navSearchQuery} setNavSearchQuery={setNavSearchQuery} unreadMessages={messages.filter((m) => m.unread).length} sessions={sessions} />
      <main className="main main-with-nav-actions">
        {pages[page]}
      </main>
    </div>
  );
}


function ProfileOptionLists() {
  return (
    <>
      <datalist id="language-options">
        {LANGUAGE_OPTIONS.map((item) => <option key={item} value={item} />)}
      </datalist>
      <datalist id="region-options">
        {REGION_OPTIONS.map((item) => <option key={item} value={item} />)}
      </datalist>
    </>
  );
}

function SuccessToast({ message }) {
  return (
    <div className="success-toast" role="status" aria-live="polite">
      <span>✓</span>
      <strong>{message}</strong>
    </div>
  );
}

function BrandLogo({ className = '', alt = 'Know-how logo' }) {
  return <img src={knowhowLogo} alt={alt} className={`brand-logo ${className}`.trim()} />;
}

function AuthScreen({ onAuthSuccess }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    fullName: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    region: 'Yangon, Myanmar',
    language: 'Myanmar, English',
    age: '',
    interests: 'English Speaking, UI/UX Design',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setError('');
  }

  function validateAccount() {
    if (!String(form.email || '').trim()) return 'Email is required.';
    if (!String(form.password || '').trim()) return 'Password is required.';
    if (String(form.password).length < 6) return 'Password must be at least 6 characters.';
    return '';
  }

  function validateRegistration() {
    const accountError = validateAccount();
    if (accountError) return accountError;
    if (form.password !== form.confirmPassword) return 'Confirmation password does not match.';
    const requiredFields = [
      ['fullName', 'Name is required.'],
      ['username', 'Username is required.'],
      ['language', 'Language is required.'],
      ['region', 'Region is required.'],
      ['age', 'Age is required.'],
    ];
    for (const [field, message] of requiredFields) {
      if (!String(form[field] || '').trim()) return message;
    }
    const age = Number(form.age);
    if (!Number.isFinite(age) || age < 13 || age > 120) return 'Age must be between 13 and 120.';
    if (!/^[a-z0-9_]{3,24}$/.test(form.username)) return 'Username must be 3-24 characters: lowercase letters, numbers, underscore only.';
    return '';
  }

  async function submitAuth(event) {
    event.preventDefault();
    setError('');
    const validationError = mode === 'register' ? validateRegistration() : validateAccount();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);

    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload = mode === 'login'
        ? { email: form.email.trim(), password: form.password }
        : {
            email: form.email.trim(),
            password: form.password,
            fullName: form.fullName.trim(),
            username: form.username.trim(),
            region: form.region.trim(),
            age: Number(form.age),
            languages: form.language.split(',').map((item) => item.trim()).filter(Boolean),
            interests: form.interests.split(',').map((item) => item.trim()).filter(Boolean),
          };

      const data = await apiRequest(path, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      localStorage.setItem('knowhow-token', data.token);
      const me = await apiRequest('/auth/me');
      onAuthSuccess({ token: data.token, user: me.user, wallet: me.wallet, authAction: mode });
    } catch (error) {
      setError(error.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell polished-auth-shell clean-auth-shell">
      <div className="auth-visual-panel">
        <span className="auth-badge">Know-how Web Application</span>
        <h2>Learn from real people, not random tabs.</h2>
        <p>Search teachers, message like Messenger, schedule sessions, join video rooms, and grow with Time Credits.</p>
        <div className="auth-feature-grid"><span>🔎 Social search</span><span>💬 Messenger chat</span><span>🎓 Verified teachers</span><span>📹 Video sessions</span></div>
      </div>
      <form className="auth-card glass register-card clean-auth-card" onSubmit={submitAuth}>
        <div className="logo large logo-image-mark"><BrandLogo className="brand-logo-auth" /></div>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        {mode !== 'login' && <p>Set up your Know-how profile in a clean, simple form.</p>}
        <ProfileOptionLists />
        <div className="tabs compact auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Login</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Register</button>
        </div>

        <div className="auth-form-section account-section">
          <div className="auth-section-label"><span>Account</span></div>
          <label>Email</label>
          <input value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="you@example.com" type="email" required />
          <div className={`form-grid ${mode === 'register' ? 'two' : 'one'}`}>
            <div><label>Password</label><input value={form.password} onChange={(event) => updateField('password', event.target.value)} type="password" placeholder="••••••••" minLength={6} required /></div>
            {mode === 'register' && <div><label>Confirm Password</label><input value={form.confirmPassword} onChange={(event) => updateField('confirmPassword', event.target.value)} type="password" placeholder="••••••••" minLength={6} required /></div>}
          </div>
        </div>

        {mode === 'register' && (
          <div className="auth-form-section profile-setup-section">
            <div className="auth-section-label"><span>Profile</span></div>
            <div className="form-grid two">
              <div><label>Name</label><input value={form.fullName} onChange={(event) => updateField('fullName', event.target.value)} placeholder="Your real display name" required /></div>
              <div><label>Username</label><input value={form.username} onChange={(event) => updateField('username', event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="username" required /></div>
            </div>
            <div className="form-grid two">
              <div><label>Language</label><input list="language-options" value={form.language} onChange={(event) => updateField('language', event.target.value)} placeholder="Choose or type any language" required /></div>
              <div><label>Region</label><input list="region-options" value={form.region} onChange={(event) => updateField('region', event.target.value)} placeholder="Choose or type any region" required /></div>
            </div>
            <div className="form-grid two">
              <div><label>Age</label><input type="number" min="13" max="120" value={form.age} onChange={(event) => updateField('age', event.target.value)} placeholder="Age" required /></div>
              <div><label>Interests</label><input value={form.interests} onChange={(event) => updateField('interests', event.target.value)} placeholder="Japanese, Editing, Design" /></div>
            </div>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        <button className="primary full auth-submit" type="submit" disabled={loading}>{loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}</button>
      </form>
    </div>
  );
}

function useDailyRewardAvailable(userId) {
  const compute = () => {
    if (!userId) return false;
    try {
      const raw = JSON.parse(localStorage.getItem(`knowhow:dailyReward:${userId}`) || 'null') || { lastClaim: '' };
      const today = new Date().toISOString().slice(0, 10);
      return raw.lastClaim !== today;
    } catch { return true; }
  };
  const [available, setAvailable] = useState(compute);
  useEffect(() => {
    const handler = () => setAvailable(compute());
    handler();
    window.addEventListener('daily-reward-updated', handler);
    window.addEventListener('focus', handler);
    const interval = setInterval(handler, 60000);
    return () => {
      window.removeEventListener('daily-reward-updated', handler);
      window.removeEventListener('focus', handler);
      clearInterval(interval);
    };
  }, [userId]);
  return available;
}

function Sidebar({ page, setPage, user, level, navSearchQuery, setNavSearchQuery, unreadMessages = 0, sessions = [] }) {
  const items = [
    ['dashboard', 'Home'],
    ['community', 'Community'],
    ['video', 'Video'],
    ['messages', 'Messages'],
    ['sessions', 'Sessions'],
    ['settings', 'Settings'],
  ];

  const dailyAvailable = useDailyRewardAvailable(user.id);

  function submitSearch(event) {
    event.preventDefault();
    if (!String(navSearchQuery || '').trim()) return;
    setPage('search');
  }

  return (
    <header className="sidebar top-navigation">
      <div className="brand top-brand">
        <div className="logo logo-image-mark"><BrandLogo className="brand-logo-nav" /></div>
        <div><h2>Know-how</h2><span>Learning Network</span></div>
      </div>
      <nav className="top-nav-menu" aria-label="Primary navigation">
        <button className="nav-search-icon-only" type="button" onClick={() => { setNavSearchQuery(''); setPage('search'); }} title="Search people" aria-label="Search people">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16.5" y2="16.5" />
          </svg>
        </button>
        {items.map(([key, label]) => {
          const showDot = key === 'messages' && unreadMessages > 0;
          return (
            <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)} title={showDot ? `${label} (${unreadMessages} new)` : label} style={{ position: 'relative' }}>
              {label}
              {showDot && <span className="credit-balance-dot" aria-hidden="true" style={{ position: 'absolute', top: 4, right: 6 }} />}
            </button>
          );
        })}
      </nav>
      <div className="topbar-actions nav-account-actions" aria-label="Account shortcuts">
        <NotificationBell userId={user.id} sessions={sessions} />
        <button className={`credit-balance${dailyAvailable ? ' has-reward' : ''}`} type="button" onClick={() => setPage('wallet')} title={dailyAvailable ? 'Daily reward available — open wallet' : 'Open credit wallet'}>
          {dailyAvailable && <span className="credit-balance-dot" aria-hidden="true" />}
          <span className="credit-balance-icon" aria-hidden="true">◎</span>
          <span className="credit-balance-copy"><span>Credit balance{dailyAvailable && <em className="credit-balance-flag"> • Daily reward ready</em>}</span><strong>{formatCredits(user.wallet.current)} credits</strong></span>
        </button>

        <button className="profile-shortcut" type="button" onClick={() => setPage('profile')} title="Open profile">
          <Avatar text={user.avatar} />
          <span className="profile-shortcut-copy"><strong>{user.username}</strong><small>{level.name}</small></span>
        </button>
      </div>
    </header>
  );
}

function Topbar({ user, level, setPage }) {
  const dailyAvailable = useDailyRewardAvailable(user.id);
  return (
    <header className="topbar topbar-compact">
      <div className="topbar-actions" aria-label="Account shortcuts">
        <button className={`credit-balance${dailyAvailable ? ' has-reward' : ''}`} type="button" onClick={() => setPage('wallet')} title={dailyAvailable ? 'Daily reward available — open wallet' : 'Open credit wallet'}>
          {dailyAvailable && <span className="credit-balance-dot" aria-hidden="true" />}
          <span className="credit-balance-icon" aria-hidden="true">◎</span>
          <span className="credit-balance-copy"><span>Credit balance{dailyAvailable && <em className="credit-balance-flag"> • Daily reward ready</em>}</span><strong>{formatCredits(user.wallet.current)} credits</strong></span>
        </button>

        <button className="profile-shortcut" type="button" onClick={() => setPage('profile')} title="Open profile">
          <Avatar text={user.avatar} />
          <span className="profile-shortcut-copy"><strong>{user.username}</strong><small>{level.name}</small></span>
        </button>
      </div>
    </header>
  );
}

function Dashboard({ user, level, sessions, setPage }) {
  const nextSession = sessions.find((session) => session.status !== 'Completed');
  return (
    <section className="page-grid">
      <div className="hero card wide">
        <div>
          <p className="eyebrow">1 hour shared = 1 Time Credit</p>
          <h2>Learn without money. Teach with contribution.</h2>
          
          <div className="actions">
            <button className="primary" onClick={() => setPage('search')}>Search Teachers</button>
            <button className="ghost" onClick={() => setPage('sessions')}>Create Session</button>
          </div>
        </div>
        <div className="credit-orb">
          <span>{user.wallet.current}</span>
          <small>Time Credits</small>
        </div>
      </div>

      <StatCard label="Current Credits" value={user.wallet.current} hint="Available balance" />
      <StatCard label="XP Level" value={level.name} hint={`${user.xp}/${level.next} XP`} />
      <StatCard label="Daily Streak" value={`${user.streak} days`} hint="Keep learning" />
      <StatCard label="Badges" value={user.badges.length} hint="Unlocked achievements" />

      <div className="card wide">
        <div className="section-title">
          <h3>Level Progress</h3>
          <span>{level.progress}%</span>
        </div>
        <div className="progress"><span style={{ width: `${level.progress}%` }} /></div>
      </div>

      <div className="card">
        <h3>Upcoming Session</h3>
        {nextSession ? <SessionMini session={nextSession} /> : <p>No upcoming sessions.</p>}
      </div>


      <div className="card wide">
        <h3>Start from your interests</h3>
        <div className="pill-wrap left">
          {(user.interests || []).map((interest) => <button key={interest} className="ghost" onClick={() => setPage('search')}>{interest}</button>)}
        </div>
      </div>
    </section>
  );
}

function SearchPage({ user, people, posts, sessions, messages, setMessages, setPage, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery || '');
  const [category, setCategory] = useState('What to learn/teach');
  const [level, setLevel] = useState('Any level');
  const [language, setLanguage] = useState('Any language');
  const [selected, setSelected] = useState(null);
  const [friends, setFriends] = useState(() => loadState('knowhow-friends', []));
  const [outgoingRequests, setOutgoingRequests] = useState(() => loadState('knowhow-friend-outgoing', []));
  const [reportedUsers, setReportedUsers] = useState(() => loadState('knowhow-reported-users', []));
  const [profileActionNotice, setProfileActionNotice] = useState('');
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportDraft, setReportDraft] = useState({ reason: 'Spam or scam', details: '' });

  useEffect(() => {
    setQuery(initialQuery || '');
  }, [initialQuery]);

  const allAccounts = useMemo(() => {
    const currentAccount = {
      id: user.id || 'current-user',
      fullName: user.fullName,
      username: user.username,
      avatar: user.avatar,
      bio: user.bio || 'Know-how learner profile.',
      region: user.region,
      languages: user.languages || [],
      interests: user.interests || [],
      reputation: user.xp || 0,
      rating: 5,
      completion: 100,
      hoursShared: user.wallet?.earned || 0,
      offered: user.skillsOffered || [],
      wanted: user.skillsWanted || [],
      isCurrentUser: true,
      email: user.email,
      role: user.role,
      age: user.age,
      education: user.education,
      work: user.work,
      portfolio: user.portfolio,
      social: user.social,
    };
    return [currentAccount, ...people];
  }, [user, people]);
  const languages = useMemo(() => ['Any language', ...Array.from(new Set(allAccounts.flatMap((person) => person.languages || []).filter(Boolean)))], [allAccounts]);
  const searchCategories = useMemo(() => ['What to learn/teach', ...CATEGORIES.filter((item) => item !== 'All')], []);
  const searchLevels = useMemo(() => ['Any level', ...LEVELS.filter((item) => item !== 'All')], []);
  const hasSearch = query.trim() || category !== 'What to learn/teach' || level !== 'Any level' || language !== 'Any language';

  useEffect(() => {
    setQuery(initialQuery || '');
  }, [initialQuery]);

  function accountText(person) {
    return normalizeText([
      person.fullName,
      person.username,
      person.bio,
      person.region,
      (person.languages || []).join(' '),
      (person.interests || []).join(' '),
      ...(person.offered || []).map((skill) => `${skill.name} ${skill.category} ${skill.level} ${skill.certificate || ''} ${skill.description || ''}`),
      ...(person.wanted || []).map((skill) => `${skill.name} ${skill.category} ${skill.target} ${skill.goal || ''}`),
    ].join(' '));
  }

  function matchAccount(person) {
    const textMatch = accountText(person);
    const qTokens = tokenize(query);
    const allQueryTokensMatch = !qTokens.length || qTokens.every((token) => textMatch.includes(token));
    const allSkills = [...(person.offered || []), ...(person.wanted || [])];
    const categoryIsNeutral = category === 'What to learn/teach' || category === 'Any skill' || category === 'All';
    const categoryMatch = categoryIsNeutral || allSkills.some((skill) => normalizeText(skill.category) === normalizeText(category) || normalizeText(skill.name).includes(normalizeText(category))) || textMatch.includes(normalizeText(category));
    const levelMatch = level === 'Any level' || allSkills.some((skill) => normalizeText(skill.level || skill.target).includes(normalizeText(level)));
    const languageMatch = language === 'Any language' || (person.languages || []).some((item) => normalizeText(item).includes(normalizeText(language)));
    const interestBoost = (user.interests || []).filter((interest) => textMatch.includes(normalizeText(interest))).length * 3;
    const queryScore = qTokens.reduce((sum, token) => sum + (textMatch.includes(token) ? 3 : 0), 0);
    const exactNameBoost = normalizeText(person.fullName).includes(normalizeText(query)) || normalizeText(person.username).includes(normalizeText(query)) ? 8 : 0;
    return {
      match: allQueryTokensMatch && categoryMatch && levelMatch && languageMatch,
      score: queryScore + exactNameBoost + interestBoost + Number(person.rating || 0),
    };
  }

  const accountResults = useMemo(() => {
    if (!hasSearch) {
      return allAccounts
        .filter((person) => !person.isCurrentUser)
        .map((person) => ({ person, score: matchAccount(person).score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((item) => item.person);
    }
    return allAccounts
      .map((person) => ({ person, ...matchAccount(person) }))
      .filter((item) => item.match)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.person);
  }, [allAccounts, query, category, level, language, hasSearch]);

  const communityResults = useMemo(() => {
    if (!hasSearch) return posts.filter((post) => (user.interests || []).some((interest) => normalizeText([post.community, ...(post.tags || [])].join(' ')).includes(normalizeText(interest)))).slice(0, 4);
    const q = normalizeText(query);
    return posts.filter((post) => {
      const textMatch = normalizeText([post.community, post.title, post.body, post.author, ...(post.tags || [])].join(' '));
      const categoryIsNeutral = category === 'What to learn/teach' || category === 'Any skill' || category === 'All';
      const categoryMatch = categoryIsNeutral || textMatch.includes(normalizeText(category));
      const queryMatch = !q || tokenize(q).every((token) => textMatch.includes(token));
      return categoryMatch && queryMatch;
    });
  }, [query, category, posts, hasSearch, user.interests]);

  function startMessage(person) {
    if (!person || person.isCurrentUser) return;
    const hasExisting = messages.some((message) => message.name === person.fullName);
    const nextMessages = hasExisting ? messages : [
      ...messages,
      {
        id: crypto.randomUUID(),
        name: person.fullName,
        username: person.username,
        type: 'Private',
        body: `You opened a conversation with ${person.fullName}. Say hi or send a schedule request.`,
        time: 'Now',
        direction: 'incoming',
        unread: false,
      },
    ];
    setMessages(nextMessages);
    openChatIntent(person.fullName);
    setPage('messages');
  }

  function requestFriend(person) {
    if (!person || person.isCurrentUser) return;
    if (friends.includes(person.id)) {
      setProfileActionNotice(`${person.fullName} is already your friend.`);
      return;
    }
    if (outgoingRequests.includes(person.id)) {
      setProfileActionNotice(`Friend request to ${person.fullName} is already pending.`);
      return;
    }
    const next = [...outgoingRequests, person.id];
    setOutgoingRequests(next);
    localStorage.setItem('knowhow-friend-outgoing', JSON.stringify(next));
    setProfileActionNotice(`Friend request sent to ${person.fullName}.`);
  }

  async function submitReport(person) {
    if (!person || person.isCurrentUser) return;
    if (!String(reportDraft.details || '').trim()) {
      setProfileActionNotice('Please add report details before submitting.');
      return;
    }
    const payload = {
      reportedUserId: person.isCloudUser ? person.id : null,
      reportedUsername: person.username,
      reportedFullName: person.fullName,
      reason: reportDraft.reason,
      details: reportDraft.details.trim(),
    };
    try {
      await apiRequest('/users/report', { method: 'POST', body: JSON.stringify(payload) });
      setProfileActionNotice(`Report submitted for ${person.fullName}. The admin team will review it.`);
    } catch (error) {
      // Fall back to local cache so the user still gets feedback if offline / unauthenticated.
      const report = {
        id: crypto.randomUUID(),
        userId: person.id,
        userName: person.fullName,
        reason: reportDraft.reason,
        details: reportDraft.details.trim(),
        submittedAt: new Date().toISOString(),
        status: 'Requested review',
      };
      const existingReports = loadState('knowhow-profile-reports', []);
      localStorage.setItem('knowhow-profile-reports', JSON.stringify([report, ...existingReports]));
      setProfileActionNotice(`Report saved locally for ${person.fullName} (${error.message}).`);
    }
    const nextReported = Array.from(new Set([...reportedUsers, person.id]));
    setReportedUsers(nextReported);
    localStorage.setItem('knowhow-reported-users', JSON.stringify(nextReported));
    setReportDraft({ reason: 'Spam or scam', details: '' });
    setShowReportForm(false);
  }

  const selectedPerson = selected?.person;

  function renderProfileModal(person) {
    if (!person) return null;
    const isFriend = friends.includes(person.id);
    const isPending = outgoingRequests.includes(person.id);
    return (
      <div className="modal-backdrop high-modal-backdrop">
        <div className="modal card search-profile-modal">
          <div className="section-title">
            <h2>{person.isCurrentUser ? 'My Profile' : 'User Profile'}</h2>
            <button className="icon" type="button" onClick={() => { setSelected(null); setShowReportForm(false); }}>×</button>
          </div>
          <div className="profile-display-card search-profile-surface">
            <div className="profile-head">
              <Avatar text={person.avatar || getInitials(person.fullName)} large />
              <div>
                <h2>{person.fullName}</h2>
                <p>@{person.username} • {person.role || 'Learner'}</p>
                <small>⭐ {person.rating || 0} • {person.hoursShared || 0} hours shared • {person.completion || 100}% completion</small>
              </div>
            </div>
            <div className="profile-readonly-grid">
              <MiniPill title="Email" text={person.email || 'Not added'} />
              <MiniPill title="Languages" text={(person.languages || []).join(', ') || 'Not added'} />
              <MiniPill title="Region" text={person.region || 'Not added'} />
              <MiniPill title="Age" text={person.age || 'Not added'} />
            </div>
            <div className="readonly-section"><label>Interests</label><p>{(person.interests || []).join(', ') || 'Not added'}</p></div>
            <div className="readonly-section"><label>Bio</label><p>{person.bio || 'No bio added yet.'}</p></div>
            <div className="readonly-section"><label>Education</label><p>{person.education || 'Not added'}</p></div>
            <div className="readonly-section"><label>Work Experience</label><p>{person.work || 'Not added'}</p></div>
            <div className="profile-link-grid">
              <MiniPill title="Portfolio" text={person.portfolio || 'Not added'} />
              <MiniPill title="Social" text={person.social || 'Not added'} />
            </div>
            <div className="profile-detail-grid search-profile-detail-grid">
              <div><h3>Can Teach</h3><div className="list">{(person.offered || []).length ? person.offered.map((skill) => <MiniPill key={`${skill.name}-${skill.category}`} title={skill.name} text={`${skill.category} • ${skill.level || 'Level not set'} • ${skill.certificate || 'No certificate detail'} • ${getCreditTableLabel((skill.duration || 1) * 60)} • suggested ${(skill.duration || 1)}h`} />) : <p className="muted-text">No teaching skills listed.</p>}</div></div>
              <div><h3>Wants to Learn</h3><div className="list">{(person.wanted || []).length ? person.wanted.map((skill) => <MiniPill key={`${skill.name}-${skill.category}`} title={skill.name} text={`${skill.category} • target ${skill.target || 'Not set'}`} />) : <p className="muted-text">No learning goals listed.</p>}</div></div>
            </div>
            {!person.isCurrentUser && (
              <div className="profile-action-row search-modal-actions-row">
                <button className="primary" type="button" onClick={() => startMessage(person)}>Message</button>
                <button className="danger" type="button" onClick={() => setShowReportForm((current) => !current)}>Report</button>
              </div>
            )}
            {showReportForm && !person.isCurrentUser && (
              <div className="report-info-panel">
                <div><strong>Report Info</strong><p className="muted-text">Tell the Know-how team why this profile needs review.</p></div>
                <label>Reason</label>
                <select value={reportDraft.reason} onChange={(event) => setReportDraft({ ...reportDraft, reason: event.target.value })}>
                  <option>Spam or scam</option>
                  <option>Fake profile</option>
                  <option>Harassment</option>
                  <option>Unsafe teaching content</option>
                  <option>Other</option>
                </select>
                <label>Details</label>
                <textarea value={reportDraft.details} onChange={(event) => setReportDraft({ ...reportDraft, details: event.target.value })} placeholder="Write the report information here..." />
                <div className="modal-actions"><button className="ghost" type="button" onClick={() => setShowReportForm(false)}>Cancel</button><button className="danger" type="button" onClick={() => submitReport(person)}>Submit Report Info</button></div>
              </div>
            )}
            {profileActionNotice && <div className="notice compact-notice">{profileActionNotice}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section>
      <PageHeader title="Search" subtitle="Use the top navigation search box or refine the filters below." />
      <div className="searchbar card social-searchbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people: name, username, Japanese, video editing, Yangon, English..." />
        <select aria-label="What do you want to learn or teach?" value={category} onChange={(event) => setCategory(event.target.value)}>{searchCategories.map((item) => <option key={item}>{item}</option>)}</select>
        <select aria-label="Level" value={level} onChange={(event) => setLevel(event.target.value)}>{searchLevels.map((item) => <option key={item}>{item}</option>)}</select>
        <select aria-label="Language" value={language} onChange={(event) => setLanguage(event.target.value)}>{languages.map((item) => <option key={item}>{item}</option>)}</select>
      </div>
      <div className="pill-wrap left interest-strip">
        {(user.interests || []).map((interest) => <button key={interest} className="ghost" onClick={() => setQuery(interest)}>{interest}</button>)}
      </div>

      <div className="facebook-search-layout single-column-search-layout">
        <div className="card people-results-card full-width-results-card">
          <div className="section-title"><h3>{hasSearch ? 'People Results' : 'Suggested People'}</h3><span className="pill muted">{accountResults.length} account(s)</span></div>
          <div className="social-people-list">
            {accountResults.length === 0 && <p className="muted-text">No profile found yet. Try searching a name, username, language, region, interest, or skill.</p>}
            {accountResults.map((person) => (
              <div className={`social-person-row ${selectedPerson?.id === person.id ? 'selected' : ''}`} key={person.id} onClick={() => { setProfileActionNotice(''); setShowReportForm(false); setSelected({ type: 'person', person }); }}>
                <Avatar text={person.avatar || getInitials(person.fullName)} />
                <div className="social-person-main">
                  <strong>{person.fullName}</strong>
                  <span>@{person.username} • {person.region || 'Region hidden'} • {(person.languages || []).join(', ') || 'No language yet'}</span>
                  <p>{person.bio}</p>
                  <div className="certificate-line">🎓 {getPersonCertificateSummary(person)}</div>
                  <div className="teacher-rate-line">💳 {getTeacherRateInfo(person, query).label} • Seats: {getTeacherSeatInfo(person, sessions).available}/{getTeacherSeatInfo(person, sessions).limit} available</div>
                  <div className="pill-wrap left">{(person.interests || []).slice(0, 4).map((interest) => <span className="pill muted" key={interest}>{interest}</span>)}</div>
                </div>
                <div className="social-person-actions">
                  <button className="primary" type="button" onClick={(event) => { event.stopPropagation(); setProfileActionNotice(''); setShowReportForm(false); setSelected({ type: 'person', person }); }}>View Profile</button>
                  {!person.isCurrentUser && <button className="ghost" type="button" onClick={(event) => { event.stopPropagation(); startMessage(person); }}>Message</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card community-search-strip">
        <div className="section-title"><h3>Related Community Posts</h3><span className="pill muted">{communityResults.length}</span></div>
        <div className="list">
          {communityResults.length === 0 && <p className="muted-text">No related community content.</p>}
          {communityResults.map((post) => <div className="message selectable" key={post.id}><small>r/{post.community}</small><strong>{post.title}</strong><p>{post.body}</p></div>)}
        </div>
      </div>
      {selectedPerson && renderProfileModal(selectedPerson)}
    </section>
  );
}

function FriendPage({ user, people, setPage, setNavSearchQuery }) {
  const defaultIncoming = people.slice(0, 2).map((person) => person.id);
  const [friends, setFriends] = useState(() => loadState('knowhow-friends', []));
  const [incomingRequests, setIncomingRequests] = useState(() => loadState('knowhow-friend-requests', defaultIncoming));
  const [outgoingRequests, setOutgoingRequests] = useState(() => loadState('knowhow-friend-outgoing', []));
  const [friendSearch, setFriendSearch] = useState('');
  const [friendNotice, setFriendNotice] = useState('');

  function saveFriends(next) {
    setFriends(next);
    localStorage.setItem('knowhow-friends', JSON.stringify(next));
  }

  function saveIncoming(next) {
    setIncomingRequests(next);
    localStorage.setItem('knowhow-friend-requests', JSON.stringify(next));
  }

  function saveOutgoing(next) {
    setOutgoingRequests(next);
    localStorage.setItem('knowhow-friend-outgoing', JSON.stringify(next));
  }

  function acceptRequest(person) {
    const nextFriends = Array.from(new Set([...friends, person.id]));
    saveFriends(nextFriends);
    saveIncoming(incomingRequests.filter((id) => id !== person.id));
    setFriendNotice(`${person.fullName} accepted as a friend.`);
  }

  function declineRequest(person) {
    saveIncoming(incomingRequests.filter((id) => id !== person.id));
    setFriendNotice(`${person.fullName} request removed.`);
  }

  function requestFriend(person) {
    if (friends.includes(person.id)) {
      setFriendNotice(`${person.fullName} is already your friend.`);
      return;
    }
    if (outgoingRequests.includes(person.id)) {
      setFriendNotice(`Friend request to ${person.fullName} is already pending.`);
      return;
    }
    saveOutgoing([...outgoingRequests, person.id]);
    setFriendNotice(`Friend request sent to ${person.fullName}.`);
  }

  function openSearch(person) {
    setNavSearchQuery(person.username || person.fullName);
    setPage('search');
  }

  const query = normalizeText(friendSearch);
  const filterPeople = (list) => list.filter((person) => !query || normalizeText([person.fullName, person.username, person.bio, person.region, ...(person.interests || [])].join(' ')).includes(query));
  const friendPeople = filterPeople(people.filter((person) => friends.includes(person.id)));
  const incomingPeople = filterPeople(people.filter((person) => incomingRequests.includes(person.id) && !friends.includes(person.id)));
  const outgoingPeople = filterPeople(people.filter((person) => outgoingRequests.includes(person.id) && !friends.includes(person.id)));
  const suggestedPeople = filterPeople(people.filter((person) => !friends.includes(person.id) && !incomingRequests.includes(person.id) && !outgoingRequests.includes(person.id))).slice(0, 6);

  function FriendCard({ person, action }) {
    return (
      <article className="friend-card card">
        <div className="profile-head no-margin">
          <Avatar text={person.avatar || getInitials(person.fullName)} />
          <div><h3>{person.fullName}</h3><p>@{person.username} • {person.region || 'Region hidden'}</p></div>
        </div>
        <p>{person.bio}</p>
        <div className="pill-wrap left">{(person.interests || []).slice(0, 3).map((interest) => <span className="pill muted" key={interest}>{interest}</span>)}</div>
        <div className="friend-actions">
          {action === 'incoming' && <><button className="primary" type="button" onClick={() => acceptRequest(person)}>Accept</button><button className="ghost" type="button" onClick={() => declineRequest(person)}>Decline</button></>}
          {action === 'suggested' && <button className="primary" type="button" onClick={() => requestFriend(person)}>Add Friend</button>}
          {action === 'outgoing' && <button className="ghost" type="button" disabled>Requested</button>}
          {action === 'friend' && <button className="ghost" type="button" onClick={() => openSearch(person)}>View Profile</button>}
          <button className="ghost" type="button" onClick={() => openSearch(person)}>Profile</button>
        </div>
      </article>
    );
  }

  return (
    <section className="friends-page">
      <PageHeader title="Friends" subtitle="Accept friend requests, track sent requests, and discover suggested friends." />
      <div className="card friend-search-card"><span aria-hidden="true">⌕</span><input value={friendSearch} onChange={(event) => setFriendSearch(event.target.value)} placeholder="Search friends or suggested people..." /></div>
      {friendNotice && <div className="notice compact-notice">{friendNotice}</div>}

      <div className="friend-section-grid">
        <section className="friend-column">
          <div className="section-title"><h3>Friend Requests</h3><span className="pill muted">{incomingPeople.length}</span></div>
          <div className="friend-list">{incomingPeople.length ? incomingPeople.map((person) => <FriendCard key={person.id} person={person} action="incoming" />) : <div className="card"><p className="muted-text">No pending friend requests.</p></div>}</div>
        </section>
        <section className="friend-column">
          <div className="section-title"><h3>My Friends</h3><span className="pill muted">{friendPeople.length}</span></div>
          <div className="friend-list">{friendPeople.length ? friendPeople.map((person) => <FriendCard key={person.id} person={person} action="friend" />) : <div className="card"><p className="muted-text">Accepted friends will appear here.</p></div>}</div>
        </section>
      </div>

      <div className="friend-section-grid">
        <section className="friend-column">
          <div className="section-title"><h3>Suggested Friends</h3><span className="pill muted">{suggestedPeople.length}</span></div>
          <div className="friend-list">{suggestedPeople.length ? suggestedPeople.map((person) => <FriendCard key={person.id} person={person} action="suggested" />) : <div className="card"><p className="muted-text">No new suggestions right now.</p></div>}</div>
        </section>
        <section className="friend-column">
          <div className="section-title"><h3>Sent Requests</h3><span className="pill muted">{outgoingPeople.length}</span></div>
          <div className="friend-list">{outgoingPeople.length ? outgoingPeople.map((person) => <FriendCard key={person.id} person={person} action="outgoing" />) : <div className="card"><p className="muted-text">No sent requests.</p></div>}</div>
        </section>
      </div>
    </section>
  );
}



function WalletPage({ user, setUser, transactions, setTransactions }) {
  const [loanAmount, setLoanAmount] = useState(2);
  const [loanDays, setLoanDays] = useState(14);
  const [walletNotice, setWalletNotice] = useState('');
  const [historyFilter, setHistoryFilter] = useState('All');
  const [paymentProduct, setPaymentProduct] = useState(null);
  const [paymentDraft, setPaymentDraft] = useState({ name: '', cardNumber: '', expiry: '', cvv: '' });
  const [paymentError, setPaymentError] = useState('');
  const wallet = normalizeWallet(user.wallet);
  const dailyKey = `knowhow:dailyReward:${user.id}`;
  const [dailyState, setDailyState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(dailyKey) || 'null') || { lastClaim: '', streak: 0 }; }
    catch { return { lastClaim: '', streak: 0 }; }
  });
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const alreadyClaimed = dailyState.lastClaim === today;
  const nextStreak = dailyState.lastClaim === yesterday ? Math.min((dailyState.streak || 0) + 1, 7) : 1;
  const rewardAmount = Number((1 + (nextStreak - 1) * (0.5 / 6)).toFixed(2));

  async function claimDailyReward() {
    setWalletNotice('');
    if (alreadyClaimed) {
      setWalletNotice('Daily reward already claimed today. Come back tomorrow!');
      return;
    }
    const newCurrent = Number((wallet.current + rewardAmount).toFixed(2));
    const newEarned = Number(((wallet.earned || 0) + rewardAmount).toFixed(2));
    try {
      const { error: wErr } = await supabase
        .from('wallets')
        .update({ current_credits: newCurrent, earned_credits: newEarned, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
      if (wErr) throw wErr;
      await supabase.from('credit_transactions').insert({
        user_id: user.id,
        amount: rewardAmount,
        type: 'earned',
        description: `Daily reward (Day ${nextStreak} streak)`,
        balance_after: newCurrent,
      });
    } catch (err) {
      setWalletNotice(`Could not save daily reward: ${err.message || err}`);
      return;
    }
    const nextUser = {
      ...user,
      wallet: normalizeWallet({
        ...wallet,
        current: newCurrent,
        earned: newEarned,
      }),
    };
    const nextState = { lastClaim: today, streak: nextStreak };
    try { localStorage.setItem(dailyKey, JSON.stringify(nextState)); window.dispatchEvent(new Event('daily-reward-updated')); } catch {}
    setDailyState(nextState);
    addTransaction('Daily Reward', `Day ${nextStreak} streak bonus`, rewardAmount, nextUser);
    setWalletNotice(`Daily reward claimed: +${rewardAmount} credits. Streak: ${nextStreak} day${nextStreak === 1 ? '' : 's'}.`);
  }

  const income = transactions.filter((item) => item.amount > 0 && item.type !== 'Loan' && item.type !== 'Purchase').reduce((sum, item) => sum + item.amount, 0);
  const spending = Math.abs(transactions.filter((item) => item.amount < 0).reduce((sum, item) => sum + item.amount, 0));
  const outstandingLoan = wallet.loanOutstanding || 0;
  const remainingLoanLimit = Math.max(0, Number((LOAN_POLICY.maxOutstanding - outstandingLoan).toFixed(2)));
  const historyTypes = ['All', ...Array.from(new Set(transactions.map((item) => item.type)))];
  const filteredTransactions = historyFilter === 'All' ? transactions : transactions.filter((item) => item.type === historyFilter);

  function addTransaction(type, title, amount, nextUser) {
    const nextTransaction = { id: crypto.randomUUID(), type, title, amount, date: new Date().toISOString().slice(0, 10) };
    setUser(nextUser);
    setTransactions([nextTransaction, ...transactions], nextUser);
  }

  function requestLoan() {
    setWalletNotice('');
    const amount = Number(loanAmount);
    const days = Number(loanDays);
    if (!amount || amount < LOAN_POLICY.min) {
      setWalletNotice(`Minimum loan is ${LOAN_POLICY.min} credit.`);
      return;
    }
    if (amount > LOAN_POLICY.maxSingleLoan) {
      setWalletNotice(`Single loan limit is ${LOAN_POLICY.maxSingleLoan} credits.`);
      return;
    }
    if (amount > remainingLoanLimit) {
      setWalletNotice(`Loan denied. Your remaining loan limit is ${remainingLoanLimit} credits.`);
      return;
    }
    if (!days || days < LOAN_POLICY.minDays || days > LOAN_POLICY.maxDays) {
      setWalletNotice(`Return period must be ${LOAN_POLICY.minDays}-${LOAN_POLICY.maxDays} days.`);
      return;
    }
    const dueDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const nextUser = {
      ...user,
      wallet: normalizeWallet({
        ...wallet,
        current: Number((wallet.current + amount).toFixed(2)),
        loanOutstanding: Number((outstandingLoan + amount).toFixed(2)),
        loanDueDate: dueDate,
      }),
    };
    addTransaction('Loan', `Credit loan due ${dueDate}`, amount, nextUser);
    setWalletNotice(`Loan approved: ${amount} credits. Due date: ${dueDate}.`);
  }

  function repayLoan() {
    setWalletNotice('');
    if (outstandingLoan <= 0) {
      setWalletNotice('No active loan to repay.');
      return;
    }
    const amount = Math.min(outstandingLoan, wallet.current);
    if (amount <= 0) {
      setWalletNotice('You need available credits before repaying the loan.');
      return;
    }
    const nextOutstanding = Number((outstandingLoan - amount).toFixed(2));
    const nextUser = {
      ...user,
      wallet: normalizeWallet({
        ...wallet,
        current: Number((wallet.current - amount).toFixed(2)),
        loanOutstanding: nextOutstanding,
        loanDueDate: nextOutstanding > 0 ? wallet.loanDueDate : '',
      }),
    };
    addTransaction('Loan Repayment', 'Returned borrowed credits', -amount, nextUser);
    setWalletNotice(nextOutstanding > 0 ? `Partial repayment complete. Remaining loan: ${nextOutstanding} credits.` : 'Loan fully repaid.');
  }

  function openPayment(product) {
    setWalletNotice('');
    setPaymentError('');
    setPaymentProduct(product);
  }

  function closePayment() {
    setPaymentProduct(null);
    setPaymentError('');
  }

  function validatePayment() {
    const cardNumber = paymentDraft.cardNumber.replace(/\D/g, '');
    const expiry = paymentDraft.expiry.trim();
    const cvv = paymentDraft.cvv.trim();
    if (!paymentDraft.name.trim() || !cardNumber || !expiry || !cvv) {
      return 'Fill all credit card fields before buying.';
    }
    if (cardNumber.length < 12 || cardNumber.length > 19) {
      return 'Card number must be 12-19 digits.';
    }
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) {
      return 'Expiry must use MM/YY format.';
    }
    if (!/^\d{3,4}$/.test(cvv)) {
      return 'CVV must be 3 or 4 digits.';
    }
    return '';
  }

  function completePayment(event) {
    event.preventDefault();
    if (!paymentProduct) return;
    const validationError = validatePayment();
    if (validationError) {
      setPaymentError(validationError);
      return;
    }
    const lastFour = paymentDraft.cardNumber.replace(/\D/g, '').slice(-4);
    purchase(paymentProduct, lastFour);
    setPaymentProduct(null);
    setPaymentDraft({ name: '', cardNumber: '', expiry: '', cvv: '' });
    setPaymentError('');
  }

  function purchase(product, cardLastFour = '') {
    setWalletNotice('');
    const nextWallet = product.productType === 'lecture_video'
      ? normalizeWallet({ ...wallet, lectureAccess: (wallet.lectureAccess || 0) + 1 })
      : normalizeWallet({
          ...wallet,
          current: Number((wallet.current + product.credits).toFixed(2)),
          purchased: Number(((wallet.purchased || 0) + product.credits).toFixed(2)),
        });
    const nextUser = { ...user, wallet: nextWallet };
    addTransaction('Purchase', product.title, product.productType === 'lecture_video' ? 0 : product.credits, nextUser);
    const paidWith = cardLastFour ? ` Card ending ${cardLastFour} accepted.` : '';
    setWalletNotice(product.productType === 'lecture_video' ? `Lecture video access added. Credit balance was not changed.${paidWith}` : `${product.credits} credits purchased successfully.${paidWith}`);
  }

  return (
    <section>
      <PageHeader title="Credit Wallet, Loans & Purchases" subtitle="Track earned credits, spent credits, borrowed credits, repayments, credit point purchases, and lecture video purchases." />
      <div className="stats-grid">
        <StatCard label="Current Credits" value={wallet.current} hint="Ready to spend" />
        <StatCard label="Earned Credits" value={wallet.earned} hint={`${income.toFixed(2)} from teaching history`} />
        <StatCard label="Spent Credits" value={wallet.spent} hint={`${spending.toFixed(2)} spent / repaid`} />
        <StatCard label="Loan Balance" value={outstandingLoan} hint={wallet.loanDueDate ? `Due ${wallet.loanDueDate}` : 'No active loan'} />
      </div>
      {walletNotice && <div className="notice">{walletNotice}</div>}
      <div className="card">
        <h3>Daily Credit Reward</h3>
        <p className="muted-text">Claim a free credit bonus every day. Keep your streak alive for bigger rewards (cap +0.5 at a 7-day streak).</p>
        <div className="stats-grid">
          <StatCard label="Current Streak" value={`${dailyState.streak || 0} day${(dailyState.streak || 0) === 1 ? '' : 's'}`} hint={alreadyClaimed ? `Last claimed ${dailyState.lastClaim}` : 'Claim today to grow it'} />
          <StatCard label="Today's Reward" value={`+${rewardAmount}`} hint={alreadyClaimed ? 'Already claimed today' : `Day ${nextStreak} bonus available`} />
          <StatCard label="Max Streak Bonus" value="+0.5" hint="Reach a 7-day streak" />
        </div>
        <div className="actions wrap">
          <button className="primary" type="button" onClick={claimDailyReward} disabled={alreadyClaimed}>
            {alreadyClaimed ? 'Claimed Today' : `Claim +${rewardAmount} Credits`}
          </button>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Loan Credit</h3>
          <p className="muted-text">Loan limit: max {LOAN_POLICY.maxOutstanding} credits outstanding. Return period is {LOAN_POLICY.minDays} days.</p>
          <div className="form-grid two">
            <div><label>Amount</label><input type="number" min={LOAN_POLICY.min} max={Math.min(LOAN_POLICY.maxSingleLoan, remainingLoanLimit)} step="0.5" value={loanAmount} onChange={(event) => setLoanAmount(event.target.value)} /></div>
            <div><label>Return in days</label><input type="number" min={LOAN_POLICY.minDays} max={LOAN_POLICY.maxDays} value={loanDays} onChange={(event) => setLoanDays(event.target.value)} /></div>
          </div>
          <div className="summary-box"><strong>Remaining loan limit:</strong> {remainingLoanLimit} credits</div>
          <div className="actions wrap">
            <button className="primary" onClick={requestLoan} disabled={remainingLoanLimit <= 0}>Request Loan</button>
            <button className="ghost" onClick={repayLoan} disabled={outstandingLoan <= 0}>Repay Loan</button>
          </div>
        </div>
        <div className="card">
          <h3>Purchase Options</h3>
          <div className="list">
            {CREDIT_PRODUCTS.map((product) => (
              <div className="skill-row" key={product.id}>
                <div><strong>{product.title}</strong><span>{product.price} • {product.credits} credit{product.credits === 1 ? '' : 's'}</span></div>
                <button className="primary" type="button" onClick={() => openPayment(product)}>Buy</button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card credit-history-card">
        <div className="section-title">
          <h3>Credit History</h3>
          <label className="history-filter-label">
            <span>Type</span>
            <select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}>
              {historyTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
        </div>
        <div className="list">
          {filteredTransactions.length === 0 && <p className="muted-text">No credit history for this type.</p>}
          {filteredTransactions.map((item) => <TransactionItem key={item.id} item={item} />)}
        </div>
      </div>
      {paymentProduct && (
        <div className="modal-backdrop high-modal-backdrop">
          <form className="modal card payment-modal" onSubmit={completePayment}>
            <div className="section-title">
              <h2>Payment Information</h2>
              <button className="icon" type="button" onClick={closePayment}>x</button>
            </div>
            <div className="summary-box">
              <strong>{paymentProduct.title}</strong>
              <span>{paymentProduct.price} - {paymentProduct.credits} credit{paymentProduct.credits === 1 ? '' : 's'}</span>
            </div>
            <label>Name on Card</label>
            <input value={paymentDraft.name} onChange={(event) => setPaymentDraft({ ...paymentDraft, name: event.target.value })} placeholder="Cardholder name" autoComplete="cc-name" required />
            <label>Card Number</label>
            <input value={paymentDraft.cardNumber} onChange={(event) => setPaymentDraft({ ...paymentDraft, cardNumber: event.target.value.replace(/[^\d ]/g, '').slice(0, 23) })} placeholder="1234 5678 9012 3456" inputMode="numeric" autoComplete="cc-number" required />
            <div className="form-grid two">
              <div><label>Expiry</label><input value={paymentDraft.expiry} onChange={(event) => setPaymentDraft({ ...paymentDraft, expiry: event.target.value.replace(/[^\d/]/g, '').slice(0, 5) })} placeholder="MM/YY" autoComplete="cc-exp" required /></div>
              <div><label>CVV</label><input value={paymentDraft.cvv} onChange={(event) => setPaymentDraft({ ...paymentDraft, cvv: event.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="123" inputMode="numeric" autoComplete="cc-csc" required /></div>
            </div>
            {paymentError && <p className="error-text">{paymentError}</p>}
            <div className="modal-actions">
              <button className="ghost" type="button" onClick={closePayment}>Cancel</button>
              <button className="primary" type="submit">Confirm Payment</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function SessionsPage({ user, setUser, sessions, setSessions, transactions, setTransactions, setPage }) {
  const [showDialog, setShowDialog] = useState(false);
  const [sessionNotice, setSessionNotice] = useState('');
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [sessionEndAd, setSessionEndAd] = useState(null);
  const [pendingReview, setPendingReview] = useState(null);

  // Keep the active meeting in sync with the global sessions list (cloud polling refreshes attendance).
  useEffect(() => {
    if (!activeMeeting) return;
    const fresh = sessions.find((s) => s.id === activeMeeting.id);
    if (fresh && fresh !== activeMeeting) {
      setActiveMeeting((curr) => (curr ? { ...curr, ...fresh } : curr));
    }
  }, [sessions, activeMeeting?.id]);

  // While a meeting is open, poll that one session every 3s so the other participant's
  // join/leave is reflected quickly (the global 15s feed poll is too slow for live counters).
  useEffect(() => {
    if (!activeMeeting?.id) return undefined;
    const isCloud = activeMeeting.fromCloud || activeMeeting.cloudId || /^[0-9a-f-]{36}$/i.test(String(activeMeeting.id));
    if (!isCloud) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data, error } = await supabase.from('sessions').select('*').eq('id', activeMeeting.id).maybeSingle();
        if (cancelled || error || !data) return;
        const merged = cloudToLocalSession(data);
        if (!merged) return;
        setSessions((curr) => curr.map((s) => (s.id === merged.id ? { ...s, ...merged } : s)));
        setActiveMeeting((curr) => (curr && curr.id === merged.id ? { ...curr, ...merged } : curr));
      } catch (_) { /* ignore */ }
    };
    const interval = window.setInterval(tick, 3000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [activeMeeting?.id]);


  const meetingRoomRef = useRef(null);
  function toggleMeetingFullscreen() {
    const el = meetingRoomRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleDraft, setRescheduleDraft] = useState({ date: '', time: '', durationMinutes: 30 });
  const [sessionSearch, setSessionSearch] = useState('');
  const [form, setForm] = useState({
    role: 'teaching',
    topic: 'English Speaking',
    teacherName: 'May Thet Hnin',
    date: '2026-06-30',
    time: '18:30',
    durationMinutes: 30,
    studentLimit: 8,
    notes: '',
  });
  const canTeach = canUserTeach(user);
  // Re-render every 30s so the "Join Meeting" button enables when the start time arrives.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setNowTick((n) => n + 1), 30000);
    return () => window.clearInterval(t);
  }, []);
  const activeSessions = sessions.filter((session) => session.status !== 'Completed');
  const normalizedSessionSearch = normalizeText(sessionSearch);
  const visibleSessions = activeSessions
    .filter((session) => !normalizedSessionSearch || normalizeText([session.teacher, session.topic, session.language, session.date, session.time].join(' ')).includes(normalizedSessionSearch))
    .sort((a, b) => {
      const aJoined = (a.joinedSeats || []).some((seat) => seat.userId === user.id || seat.userName === user.fullName);
      const bJoined = (b.joinedSeats || []).some((seat) => seat.userId === user.id || seat.userName === user.fullName);
      if (aJoined !== bJoined) return aJoined ? -1 : 1;
      return `${a.date || ''} ${a.time || ''}`.localeCompare(`${b.date || ''} ${b.time || ''}`);
    });
  const completedCount = sessions.length - activeSessions.length;

  async function createSession() {
    setSessionNotice('');
    if (!canTeach) {
      setSessionNotice('Only approved teachers can create sessions. Learner accounts can only join assigned sessions. Apply for Teaching Authority from Profile first.');
      setShowDialog(false);
      return;
    }
    const durationMinutes = Number(form.durationMinutes);
    const studentLimit = Math.max(1, Math.floor(Number(form.studentLimit) || 1));
    const durationHours = Number((durationMinutes / 60).toFixed(2));
    const creditAmount = minutesToCredits(durationMinutes);
    if (!form.topic.trim()) {
      setSessionNotice('Please enter a skill topic.');
      return;
    }
    if (!durationMinutes || durationMinutes < 1) {
      setSessionNotice('Session duration must be at least 1 minute.');
      return;
    }
    if (!studentLimit || studentLimit < 1) {
      setSessionNotice('Seats limit must be at least 1 learner.');
      return;
    }
    const roomId = createSecureRoomId();
    const meetingLink = buildMeetingUrl(roomId);
    const meetingProvider = 'Know-how Room';
    const meetingSpaceName = buildJitsiRoomName(roomId);

    const session = {
      id: crypto.randomUUID(),
      topic: form.topic.trim(),
      teacher: user.fullName,
      learner: 'Learner pending',
      date: form.date,
      time: form.time,
      duration: durationHours,
      durationMinutes,
      credits: creditAmount,
      creditRatePerMinute: CREDIT_PER_MINUTE,
      studentLimit,
      seatsAvailable: studentLimit,
      teacherLevel: user.teacherLevel || user.role || 'Approved Teacher',
      status: 'Pending',
      roomId,
      meetingLink,
      meetingProvider,
      meetingSpaceName,
      attendance: [],
      mentorJoinedAt: '',
      mentorLeftAt: '',
      learnerJoinedAt: '',
      learnerLeftAt: '',
      actualDurationMinutes: 0,
      verifiedDurationMinutes: 0,
      attendanceVerified: false,
      notes: form.notes || 'Created by approved teacher. Learner will be assigned through booking, message schedule, or admin flow.',
      createdByRole: 'teaching',
      creatorOnly: 'teacher',
    };
    setSessions([session, ...sessions]);
    setShowDialog(false);
    setSessionNotice(`Teaching session created. Learners can join from the sessions feed. Credits: ${formatCredits(creditAmount)} using the standard time table (${getCreditTableLabel(durationMinutes)}).`);
    // Persist to cloud so other users can discover and join.
    try {
      const saved = await apiRequest('/sessions/request', { method: 'POST', body: JSON.stringify(session) });
      if (saved && saved.id) {
        setSessions((current) => current.map((s) => (s.id === session.id ? { ...session, ...saved } : s)));
      }
    } catch (err) {
      setSessionNotice(`Session saved locally but cloud sync failed: ${err.message}. It will not appear for other users yet.`);
    }
  }

  function updateStatus(id, status) {
    setSessionNotice('');
    setSessions(sessions.map((session) => {
      if (session.id !== id) return session;
      const withRoom = ['Accepted', 'Rescheduled'].includes(status) ? ensureStoredSessionRoom(session) : session;
      return { ...withRoom, status };
    }));
    // Push to cloud so other participants see the change.
    apiRequest(`/sessions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      .catch((err) => setSessionNotice(`Status updated locally but cloud sync failed: ${err.message}.`));
  }

  function cancelSession(session) {
    setSessionNotice('');
    if (!window.confirm('Cancel and delete this session? This cannot be undone.')) return;
    setSessions((current) => current.filter((s) => s.id !== session.id));
    notify(user.id, { category: 'reschedule', title: 'Session cancelled', body: `${session.topic || 'Your session'} on ${session.date || 'TBA'} ${session.time || ''} was cancelled.` });
    apiRequest(`/sessions/${session.id}`, { method: 'DELETE' })
      .then(() => setSessionNotice('Session cancelled and removed.'))
      .catch((err) => setSessionNotice(`Removed locally but cloud delete failed: ${err.message}.`));
  }

  function openReschedule(session) {
    setSessionNotice('');
    setRescheduleTarget(session);
    setRescheduleDraft({
      date: session.date || '',
      time: session.time || '',
      durationMinutes: session.durationMinutes || Math.round((Number(session.duration || 0)) * 60) || 30,
    });
  }

  function closeReschedule() {
    setRescheduleTarget(null);
  }

  async function submitReschedule(event) {
    event.preventDefault();
    if (!rescheduleTarget) return;
    const { date, time, durationMinutes } = rescheduleDraft;
    if (!date || !time) {
      setSessionNotice('Please choose a new date and time to reschedule.');
      return;
    }
    const minutes = Math.max(1, Math.floor(Number(durationMinutes) || 30));
    const id = rescheduleTarget.id;
    setSessions((current) => current.map((s) => s.id === id ? {
      ...s,
      date,
      time,
      durationMinutes: minutes,
      duration: Number((minutes / 60).toFixed(2)),
      credits: minutesToCredits(minutes),
      status: 'Rescheduled',
    } : s));
    setRescheduleTarget(null);
    notify(user.id, { category: 'reschedule', title: 'Session rescheduled', body: `${rescheduleTarget.topic || 'Session'} moved to ${date} ${time} (${minutes} min).` });
    try {
      await apiRequest(`/sessions/${id}/reschedule`, { method: 'PATCH', body: JSON.stringify({ date, time, durationMinutes: minutes }) });
      setSessionNotice('Session rescheduled. Learners will see the updated time.');
    } catch (err) {
      setSessionNotice(`Rescheduled locally but cloud sync failed: ${err.message}.`);
    }
  }


  function updateSessionAttendance(sessionId, updater) {
    let updatedSession = null;
    const nextSessions = sessions.map((session) => {
      if (session.id !== sessionId) return session;
      updatedSession = updater(session);
      return updatedSession;
    });
    setSessions(nextSessions);
    return updatedSession;
  }

  function joinSeat(session) {
    setSessionNotice('');
    const seatLimit = Number(session.studentLimit || 10);
    const joinedSeats = session.joinedSeats || [];
    const alreadyJoined = joinedSeats.some((seat) => seat.userId === user.id || seat.userName === user.fullName);
    const availableSeats = Number(session.seatsAvailable ?? Math.max(0, seatLimit - joinedSeats.length));
    if (alreadyJoined) {
      setSessionNotice('You already joined this session seat. Your selected sessions appear at the top.');
      return;
    }
    if (availableSeats <= 0 || joinedSeats.length >= seatLimit) {
      setSessionNotice('This session is full.');
      return;
    }
    // Credit check: a learner must hold at least the session's credit cost before joining a seat.
    const isTeacherSelf = getParticipantRole(session, user) === 'mentor';
    const sessionCost = Number(session.credits ?? getBillableCredits(session) ?? 0);
    const currentCredits = Number(normalizeWallet(user.wallet).current || 0);
    if (!isTeacherSelf && sessionCost > 0 && currentCredits < sessionCost) {
      setSessionNotice(`You need ${formatCredits(sessionCost)} credits to join this seat (you have ${formatCredits(currentCredits)}). Redirecting to the credit loan page…`);
      if (typeof setPage === 'function') window.setTimeout(() => setPage('wallet'), 700);
      return;
    }
    const nextSessions = sessions.map((item) => {
      if (item.id !== session.id) return item;
      const nextJoinedSeats = [
        ...(item.joinedSeats || []),
        { id: crypto.randomUUID(), userId: user.id, userName: user.fullName, joinedAt: new Date().toISOString() },
      ];
      return {
        ...item,
        joinedSeats: nextJoinedSeats,
        learner: item.learner && item.learner !== 'Learner pending' ? item.learner : user.fullName,
        seatsAvailable: Math.max(0, Number(item.studentLimit || seatLimit) - nextJoinedSeats.length),
        status: item.status === 'Pending' ? 'Accepted' : item.status,
      };
    });
    setSessions(nextSessions);
    setSessionNotice('Seat joined successfully. This session is now pinned at the top.');
    // Sync seat join to cloud so the teacher and other learners see the updated seat count.
    if (session.fromCloud || session.cloudId) {
      apiRequest(`/sessions/${session.id}/meeting/join`, { method: 'POST', body: JSON.stringify({ userName: user.fullName }) })
        .catch((err) => setSessionNotice(`Seat joined locally but cloud sync failed: ${err.message}.`));
    }
  }

  function sessionStartMs(session) {
    if (!session.date) return null;
    const iso = session.time ? `${session.date}T${session.time}:00` : `${session.date}T00:00:00`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  }
  function canJoinMeetingNow(session) {
    const start = sessionStartMs(session);
    if (start == null) return true; // unknown start → allow
    // Allow joining from 10 minutes before start time.
    return Date.now() >= start - 10 * 60 * 1000;
  }

  function joinMeeting(session) {
    setSessionNotice('');
    const roomId = getSessionRoom(session);
    if (!roomId) {
      setSessionNotice('Meeting room ID is missing. Please contact admin; a session must have a stored room ID before joining.');
      return;
    }
    const role = getParticipantRole(session, user);
    if (!role) {
      setSessionNotice('Only the mentor or learner assigned to this session can join this room.');
      return;
    }
    const updated = updateSessionAttendance(session.id, (current) => {
      const attendance = current.attendance || [];
      const alreadyOpen = attendance.some((item) => item.userName === user.fullName && !item.leftAt);
      const nextAttendance = alreadyOpen ? attendance : [
        ...attendance,
        { id: crypto.randomUUID(), userName: user.fullName, role, joinedAt: new Date().toISOString(), leftAt: '', durationMinutes: 0 },
      ];
      return {
        ...current,
        status: current.status === 'Completed' ? current.status : 'Ongoing',
        roomId,
        meetingLink: current.meetingLink || buildMeetingUrl(roomId),
        meetingProvider: current.meetingProvider || 'Know-how Room',
        meetingSpaceName: current.meetingSpaceName || buildJitsiRoomName(roomId),
        attendance: nextAttendance,
        ...sessionAttendanceFields(nextAttendance, new Date().toISOString()),
      };
    });
    setActiveMeeting(updated);
    // Sync attendance to the cloud so the other participant's client sees this join in real time.
    const isCloudSession = session.id && (session.fromCloud || session.cloudId || /^[0-9a-f-]{36}$/i.test(String(session.id)));
    if (isCloudSession) {
      (async () => {
        try {
          const { data, error } = await supabase.rpc('session_attendance_join', { _session_id: session.id, _user_name: user.fullName, _role: role });
          if (error) throw error;
          const merged = cloudToLocalSession(data);
          if (!merged) return;
          setSessions((curr) => curr.map((s) => (s.id === merged.id ? { ...s, ...merged } : s)));
          setActiveMeeting((curr) => (curr && curr.id === merged.id ? { ...curr, ...merged } : curr));
        } catch (err) {
          setSessionNotice(`Joined locally but cloud attendance sync failed: ${err.message || err}`);
        }
      })();
    }
  }

  async function leaveMeeting() {
    if (!activeMeeting) return;
    const nowIso = new Date().toISOString();
    const sessionId = activeMeeting.id;

    // 1) Mark current user as left in attendance.
    const afterLeave = updateSessionAttendance(sessionId, (current) => {
      const attendance = (current.attendance || []).map((item) => {
        if (item.userName === user.fullName && !item.leftAt) {
          const minutes = Number(((new Date(nowIso).getTime() - new Date(item.joinedAt).getTime()) / 60000).toFixed(2));
          return { ...item, leftAt: nowIso, durationMinutes: Math.max(0, minutes) };
        }
        return item;
      });
      return { ...current, attendance, ...sessionAttendanceFields(attendance, nowIso) };
    });

    // 2) Settle verified-minute deltas per learner. Verified minutes = overlap where at
    //    least 1 mentor AND that learner were both present; auto-pauses otherwise.
    let session = afterLeave || activeMeeting;
    const isCloud = session.id && session.teacherId && (session.fromCloud || session.cloudId || /^[0-9a-f-]{36}$/i.test(String(session.id)));
    // Sync this leave to the cloud BEFORE settlement so attendance reflects every participant.
    if (isCloud) {
      try {
        const { data, error } = await supabase.rpc('session_attendance_leave', { _session_id: session.id, _user_name: user.fullName });
        if (error) throw error;
        const merged = cloudToLocalSession(data);
        if (merged) {
          session = { ...session, ...merged };
          setSessions((curr) => curr.map((s) => (s.id === merged.id ? { ...s, ...merged } : s)));
        }
      } catch (err) {
        setSessionNotice(`Leave sync failed: ${err.message || err}. Settling with local attendance.`);
      }
    }
    const ratePerMinute = getSessionCreditRate(session);
    const settledMap = { ...(session.settledMinutesByLearner || {}) };
    const joinedSeats = (session.joinedSeats || []).filter((s) => s.userId && s.userId !== session.teacherId);
    const settlements = [];
    const isTeacher = session.teacher === user.fullName || (session.teacherId && session.teacherId === user.id);

    for (const seat of joinedSeats) {
      const totalMinutes = learnerVerifiedMinutes(session.attendance || [], seat.userName, nowIso);
      const already = Number(settledMap[seat.userName] || 0);
      const deltaMinutes = Number(Math.max(0, totalMinutes - already).toFixed(2));
      if (deltaMinutes <= 0) continue;
      const deltaCredits = Number((deltaMinutes * ratePerMinute).toFixed(2));
      if (deltaCredits <= 0) continue;
      if (isCloud) {
        try {
          await supabase.rpc('session_settle_verified', { _session_id: session.id, _learner_id: seat.userId, _credits: deltaCredits });
        } catch (err) {
          setSessionNotice(`Settlement failed for ${seat.userName}: ${err.message || err}`);
          continue;
        }
      }
      settledMap[seat.userName] = Number((already + deltaMinutes).toFixed(2));
      settlements.push({ learner: seat.userName, credits: deltaCredits, minutes: deltaMinutes });
    }

    if (settlements.length) {
      updateSessionAttendance(sessionId, (current) => ({ ...current, settledMinutesByLearner: settledMap }));
    }

    // 3) Mirror the current user's side of the transfer in their local wallet.
    let nextUser = user;
    const localTxs = [];
    if (settlements.length) {
      const currentWallet = normalizeWallet(user.wallet);
      if (isTeacher) {
        const earned = settlements.reduce((s, x) => s + x.credits, 0);
        const nextWallet = normalizeWallet({
          ...currentWallet,
          current: Number((currentWallet.current + earned).toFixed(2)),
          earned: Number((currentWallet.earned + earned).toFixed(2)),
        });
        settlements.forEach((s) => localTxs.push({
          id: crypto.randomUUID(), type: 'Earned',
          title: `Teaching ${session.topic} • ${s.minutes} min verified • ${formatCredits(s.credits)} credits from ${s.learner}`,
          amount: s.credits, date: nowIso.slice(0, 10),
        }));
        settlements.forEach((s) => notify(user.id, {
          category: 'credit-gain',
          title: `+${formatCredits(s.credits)} credits earned`,
          body: `${s.learner} attended ${s.minutes} verified min of ${session.topic}.`,
        }));
        nextUser = { ...user, wallet: nextWallet };
      } else {
        const mine = settlements.find((s) => s.learner === user.fullName);
        if (mine) {
          const nextWallet = normalizeWallet({
            ...currentWallet,
            current: Number((currentWallet.current - mine.credits).toFixed(2)),
            spent: Number((currentWallet.spent + mine.credits).toFixed(2)),
          });
          localTxs.push({
            id: crypto.randomUUID(), type: 'Spent',
            title: `Learning ${session.topic} • ${mine.minutes} min verified • ${formatCredits(mine.credits)} credits`,
            amount: -mine.credits, date: nowIso.slice(0, 10),
          });
          notify(user.id, {
            category: 'credit-loss',
            title: `-${formatCredits(mine.credits)} credits spent`,
            body: `${mine.minutes} verified min of ${session.topic}.`,
          });
          nextUser = { ...user, wallet: nextWallet };
        }
      }
    }
    if (nextUser !== user) setUser(nextUser);
    if (localTxs.length) setTransactions([...localTxs, ...transactions], nextUser);

    setActiveMeeting(null);
    setSessionEndAd(pickRandomAd());
    if (!isTeacher && session.teacherId && session.teacherId !== user.id) {
      setPendingReview({ sessionId: session.id, teacherId: session.teacherId, teacherName: session.teacher || 'Teacher', topic: session.topic });
    }

    const totalCredits = settlements.reduce((s, x) => s + x.credits, 0);
    setSessionNotice(settlements.length
      ? `Left meeting. Auto-settled ${formatCredits(totalCredits)} credit(s) across ${settlements.length} learner(s) using verified overlap minutes.`
      : 'Left meeting. No new verified minutes to settle.');
  }

  // Compute verified overlap (in minutes) between mentor intervals and ONE specific learner's intervals.
  function learnerVerifiedMinutes(attendance = [], learnerUserName = '', nowIso = '') {
    const toMerged = (filterFn) => {
      const items = attendance.filter(filterFn).filter((a) => a.joinedAt && (a.leftAt || nowIso))
        .map((a) => ({ start: new Date(a.joinedAt).getTime(), end: new Date(a.leftAt || nowIso).getTime() }))
        .filter((x) => x.end > x.start)
        .sort((a, b) => a.start - b.start);
      const merged = [];
      for (const it of items) {
        const last = merged[merged.length - 1];
        if (!last || it.start > last.end) merged.push({ ...it });
        else last.end = Math.max(last.end, it.end);
      }
      return merged;
    };
    const mentors = toMerged((a) => a.role === 'mentor');
    const learners = toMerged((a) => a.role === 'learner' && a.userName === learnerUserName);
    let overlapMs = 0;
    for (const m of mentors) for (const l of learners) overlapMs += Math.max(0, Math.min(m.end, l.end) - Math.max(m.start, l.start));
    return Number((overlapMs / 60000).toFixed(2));
  }

  async function completeSession(session) {
    setSessionNotice('');
    if (session.status === 'Completed') {
      setSessionNotice('This session is already completed.');
      return;
    }
    if (session.status === 'Cancelled') {
      setSessionNotice('Cancelled sessions cannot be completed.');
      return;
    }
    const isTeacher = session.teacher === user.fullName || (session.teacherId && session.teacherId === user.id);
    const nowIso = new Date().toISOString();
    const attendanceFields = sessionAttendanceFields(session.attendance || [], nowIso);
    const sessionForBilling = { ...session, ...attendanceFields };
    const billableMinutes = getBillableMinutes(sessionForBilling);
    const ratePerMinute = getSessionCreditRate(sessionForBilling);
    const billableCredits = getBillableCredits(sessionForBilling);

    // Settle credits between each joined learner and the teacher using verified minutes.
    const joinedSeats = (session.joinedSeats || []).filter((s) => s.userId && s.userId !== session.teacherId);
    const settlements = [];
    if (session.id && session.teacherId && (session.fromCloud || session.cloudId || /^[0-9a-f-]{36}$/i.test(String(session.id)))) {
      for (const seat of joinedSeats) {
        const perLearnerMinutes = learnerVerifiedMinutes(session.attendance || [], seat.userName, nowIso) || billableMinutes;
        const perLearnerCredits = Number((perLearnerMinutes * ratePerMinute).toFixed(2));
        if (perLearnerCredits <= 0) continue;
        try {
          await supabase.rpc('session_settle_verified', { _session_id: session.id, _learner_id: seat.userId, _credits: perLearnerCredits });
          settlements.push({ learner: seat.userName, credits: perLearnerCredits, minutes: perLearnerMinutes });
        } catch (err) {
          setSessionNotice(`Settlement failed for ${seat.userName}: ${err.message || err}`);
        }
      }
    }

    // Reflect the local user's side of the transfer in their visible wallet/transactions.
    const currentWallet = normalizeWallet(user.wallet);
    let nextWallet = currentWallet;
    let localTransactions = [];
    if (isTeacher && settlements.length) {
      const earned = settlements.reduce((s, x) => s + x.credits, 0);
      nextWallet = normalizeWallet({
        ...currentWallet,
        current: Number((currentWallet.current + earned).toFixed(2)),
        earned: Number((currentWallet.earned + earned).toFixed(2)),
      });
      localTransactions = settlements.map((s) => ({
        id: crypto.randomUUID(), type: 'Earned',
        title: `Teaching ${session.topic} • ${s.minutes} min verified • ${formatCredits(s.credits)} credits from ${s.learner}`,
        amount: s.credits, date: nowIso.slice(0, 10),
      }));
    } else if (!isTeacher) {
      const mine = settlements.find((s) => s.learner === user.fullName);
      const myCredits = mine ? mine.credits : billableCredits;
      const myMinutes = mine ? mine.minutes : billableMinutes;
      if (currentWallet.current < myCredits) {
        setSessionNotice(`Not enough credits to complete this learning session. Required: ${formatCredits(myCredits)} credits for ${myMinutes} minute(s).`);
        return;
      }
      // If no cloud settlement happened (local-only session), debit locally.
      if (!settlements.length) {
        nextWallet = normalizeWallet({
          ...currentWallet,
          current: Number((currentWallet.current - myCredits).toFixed(2)),
          spent: Number((currentWallet.spent + myCredits).toFixed(2)),
        });
      } else {
        // Refresh from cloud wallet would be ideal; mirror the debit locally so UI matches.
        nextWallet = normalizeWallet({
          ...currentWallet,
          current: Number((currentWallet.current - myCredits).toFixed(2)),
          spent: Number((currentWallet.spent + myCredits).toFixed(2)),
        });
      }
      localTransactions = [{
        id: crypto.randomUUID(), type: 'Spent',
        title: `Learning ${session.topic} • ${myMinutes} min verified • ${formatCredits(myCredits)} credits`,
        amount: -myCredits, date: nowIso.slice(0, 10),
      }];
    }

    const nextUser = {
      ...user,
      wallet: nextWallet,
      xp: user.xp + 45,
      badges: isTeacher && !user.badges.includes('10 Hours Taught') ? [...user.badges, '10 Hours Taught'] : user.badges,
    };
    const nextSessions = sessions.map((item) => item.id === session.id ? {
      ...item,
      status: 'Completed',
      completedAt: nowIso,
      ...sessionAttendanceFields(item.attendance || [], nowIso),
      creditsCharged: billableCredits,
      billableMinutes,
      summary: generateSummary({ ...item, billableMinutes, creditsCharged: billableCredits }),
    } : item);
    setUser(nextUser);
    setSessions(nextSessions);
    if (localTransactions.length) setTransactions([...localTransactions, ...transactions], nextUser);
    const summary = settlements.length
      ? `Session completed. Transferred ${settlements.map((s) => `${formatCredits(s.credits)} from ${s.learner}`).join(', ')} to the teacher using verified minutes.`
      : `Session completed. ${formatCredits(billableCredits)} credit(s) calculated from ${billableMinutes} verified minute(s).`;
    setSessionNotice(summary);
  }

  return (
    <section>
      <PageHeader title="Sessions" subtitle="Search sessions by teacher or topic, then join a seat before it becomes full." action={canTeach ? <button className="primary" onClick={() => { setSessionNotice(''); setShowDialog(true); }}>Create Teaching Session</button> : <span className="status pending">Join seat mode</span>} />
      <div className="card sessions-search-card">
        <label className="sessions-search-box"><span>⌕</span><input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="Search by teacher name or topic..." /></label>
        
      </div>
      {sessionNotice && <div className="notice">{sessionNotice}</div>}
      {completedCount > 0 && <div className="summary-box"><strong>{completedCount} completed session(s)</strong> are hidden from this active list.</div>}
      <div className="sessions-grid">
        {visibleSessions.length === 0 && <div className="card"><p className="muted-text">No matching active sessions. Try another teacher name or topic.</p></div>}
        {visibleSessions.map((session) => {
          const role = getParticipantRole(session, user);
          const scheduledMinutes = getScheduledMinutes(session);
          const creditValue = session.credits ?? getBillableCredits(session);
          const seatLimit = Number(session.studentLimit || 10);
          const joinedSeats = session.joinedSeats || [];
          const availableSeats = Number(session.seatsAvailable ?? Math.max(0, seatLimit - joinedSeats.length));
          const usedSeats = Math.max(0, seatLimit - availableSeats);
          const alreadyJoined = joinedSeats.some((seat) => seat.userId === user.id || seat.userName === user.fullName);
          const isFull = availableSeats <= 0 || usedSeats >= seatLimit;
          const teacherLevelLabel = session.teacherLevel || 'Intermediate';
          const teacherRating = session.teacherRating || '4.8';
          const teacherLevelNumber = session.teacherLevelNumber || 'Lv.15';
          const sessionLanguage = session.language || user.languages?.[0] || 'English';
          return (
            <div className={`card session-card session-compact-card ${alreadyJoined ? 'joined-session-card' : ''}`} key={session.id}>
              <div className="session-compact-head">
                <div className="session-teacher-line"><span>📊</span><strong>{session.teacher || session.topic}</strong></div>
                <StatusBadge status={alreadyJoined ? 'Seat Joined' : session.status} />
              </div>
              <div className="session-rating-line">⭐️ {teacherRating} • 🟡 {teacherLevelLabel} • {teacherLevelNumber}</div>
              <div className="session-info-lines">
                <span>📚 {session.topic}</span>
                <span>🌐 {sessionLanguage}</span>
                <span>📅 {session.date || 'Date TBA'} • {session.time || 'Time TBA'}</span>
                <span>⏱️ {scheduledMinutes} mins</span>
                <span>💳 {formatCredits(creditValue)} Credits</span>
                <span>👥 {usedSeats}/{seatLimit} Seats</span>
              </div>
              {session.summary && <div className="summary-box compact-session-summary"><strong>AI Summary:</strong><p>{session.summary}</p></div>}
              <div className="session-card-actions">
                <button className="primary" onClick={() => joinSeat(session)} disabled={alreadyJoined || isFull}>{alreadyJoined ? 'Seat Joined' : isFull ? 'Full' : 'Join Seat'}</button>
                {(role === 'mentor' || alreadyJoined) && (() => {
                  const allowed = canJoinMeetingNow(session) && session.status !== 'Cancelled' && session.status !== 'Completed';
                  const start = sessionStartMs(session);
                  const title = !allowed && start
                    ? `Meeting opens 10 minutes before ${new Date(start).toLocaleString()}`
                    : 'Open the meeting room';
                  return (
                    <button className="primary" onClick={() => joinMeeting(session)} disabled={!allowed} title={title}>
                      {allowed ? 'Join Meeting' : 'Opens at start time'}
                    </button>
                  );
                })()}
                
                {canTeach && role === 'mentor' && <button className="ghost" onClick={() => openReschedule(session)}>Reschedule</button>}
                {canTeach && role === 'mentor' && <button className="ghost" onClick={() => cancelSession(session)}>Cancel</button>}
                
              </div>
            </div>
          );
        })}
      </div>

      {showDialog && (
        <div className="modal-backdrop">
          <div className="modal card">
            <div className="section-title">
              <h2>New Session</h2>
              <button className="icon" onClick={() => setShowDialog(false)}>×</button>
            </div>
            {sessionNotice && <p className="error-text">{sessionNotice}</p>}
            <label>Skill Topic</label>
            <input value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} disabled={!canTeach} />
            <div className="form-grid">
              <div><label>Date</label><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} disabled={!canTeach} /></div>
              <div><label>Time</label><input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} disabled={!canTeach} /></div>
              <div><label>Duration (minutes)</label><input type="number" step="1" min="1" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} disabled={!canTeach} /></div>
              <div><label>Seats limit</label><input type="number" step="1" min="1" value={form.studentLimit} onChange={(event) => setForm({ ...form, studentLimit: event.target.value })} disabled={!canTeach} /></div>
            </div>
            <label>Notes</label>
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Session goals, files, preparation notes..." disabled={!canTeach} />
            <TeacherBookingPreview form={form} sessions={sessions} user={user} />
            <button className="primary full" onClick={createSession} disabled={!canTeach}>Create Teaching Session</button>
          </div>
        </div>
      )}

      {rescheduleTarget && (
        <div className="modal-backdrop">
          <form className="modal card" onSubmit={submitReschedule}>
            <div className="section-title">
              <h2>Reschedule Session</h2>
              <button className="icon" type="button" onClick={closeReschedule}>×</button>
            </div>
            <p className="muted-text">{rescheduleTarget.topic} • currently {rescheduleTarget.date || 'TBA'} {rescheduleTarget.time || ''}</p>
            <div className="form-grid">
              <div><label>New Date</label><input type="date" value={rescheduleDraft.date} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, date: e.target.value })} required /></div>
              <div><label>New Time</label><input type="time" value={rescheduleDraft.time} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, time: e.target.value })} required /></div>
              <div><label>Duration (minutes)</label><input type="number" min="1" step="1" value={rescheduleDraft.durationMinutes} onChange={(e) => setRescheduleDraft({ ...rescheduleDraft, durationMinutes: e.target.value })} required /></div>
            </div>
            <div className="actions">
              <button className="ghost" type="button" onClick={closeReschedule}>Cancel</button>
              <button className="primary" type="submit">Save New Time</button>
            </div>
          </form>
        </div>
      )}


      {activeMeeting && (
        <div className="modal-backdrop meeting-backdrop">
          <div className="modal card meeting-room" ref={meetingRoomRef}>
            <div className="section-title">
              <h2>Know-how Meeting Room</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusBadge status="Ongoing" />
                <button className="ghost" type="button" onClick={toggleMeetingFullscreen}>⛶ Fullscreen</button>
              </div>
            </div>
            <div className="call-box video-call-box">
              <div className="video-call-header">
                <div><h3>{activeMeeting.topic}</h3><p>Room: {buildJitsiRoomName(getSessionRoom(activeMeeting))}</p></div>
              </div>
              <iframe
                className="jitsi-frame"
                title={`Session room ${getSessionRoom(activeMeeting)}`}
                src={activeMeeting.meetingLink || buildMeetingUrl(getSessionRoom(activeMeeting))}
                allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
                allowFullScreen
              />
            </div>
            
            <LiveAttendanceSummary activeMeeting={activeMeeting} />
            <button className="danger full" onClick={leaveMeeting}>Leave Meeting</button>
          </div>
        </div>
      )}
      {sessionEndAd && (
        <AdOverlay ad={sessionEndAd} placement="After session" onClose={() => setSessionEndAd(null)} />
      )}
      {!sessionEndAd && pendingReview && (
        <SessionRatingModal
          review={pendingReview}
          onClose={() => setPendingReview(null)}
          onSubmit={async ({ rating, comment }) => {
            try {
              await apiRequest('/reviews', { method: 'POST', body: JSON.stringify({
                revieweeId: pendingReview.teacherId,
                sessionId: pendingReview.sessionId,
                rating,
                comment,
              }) });
              setSessionNotice(`Thanks for rating ${pendingReview.teacherName}!`);
              try { notify(pendingReview.teacherId, { category: 'reminder', title: `New ${rating}★ review`, body: `${user.fullName} rated your session "${pendingReview.topic}".` }); } catch {}
            } catch (err) {
              setSessionNotice(`Could not submit rating: ${err.message || err}`);
            } finally {
              setPendingReview(null);
            }
          }}
        />
      )}

    </section>
  );
}

function SessionRatingModal({ review, onClose, onSubmit }) {
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3 style={{ margin: '0 0 4px' }}>Rate your teacher</h3>
        <p className="muted-text" style={{ marginTop: 0 }}>How was <strong>{review.teacherName}</strong>'s session{review.topic ? ` on "${review.topic}"` : ''}?</p>
        <div style={{ display: 'flex', gap: 6, fontSize: 34, cursor: 'pointer', userSelect: 'none', justifyContent: 'center', margin: '12px 0' }}>
          {[1,2,3,4,5].map((n) => (
            <span
              key={n}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(n)}
              style={{ color: (hover || rating) >= n ? '#f5b301' : '#d0d4dc', transition: 'color 0.15s' }}
              aria-label={`${n} star${n>1?'s':''}`}
            >★</span>
          ))}
        </div>
        <textarea
          className="input"
          placeholder="Share a quick note (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          style={{ width: '100%', resize: 'vertical' }}
        />
        <div className="actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Skip</button>
          <button type="button" className="primary" disabled={busy} onClick={async () => {
            setBusy(true);
            await onSubmit({ rating, comment: comment.trim() });
          }}>{busy ? 'Submitting…' : 'Submit rating'}</button>
        </div>
      </div>
    </div>
  );
}



function TeacherBookingPreview() {
  return null;
}


function LiveAttendanceSummary({ activeMeeting }) {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (!activeMeeting) return undefined;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeMeeting]);
  const now = new Date(tick).toISOString();
  const liveFields = sessionAttendanceFields(activeMeeting?.attendance || [], now);
  const verifiedMin = Number(liveFields.verifiedDurationMinutes || 0);
  const accruing = verifiedMin > 0 && (liveFields.mentorJoinedAt && liveFields.learnerJoinedAt);
  const totalSec = Math.max(0, Math.floor(verifiedMin * 60));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const liveCredits = minutesToCredits(verifiedMin);
  return (
    <div className="summary-box live-attendance-box">
      <div className="live-counter" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: accruing ? '#ecfdf5' : '#fef3c7', border: `1px solid ${accruing ? '#10b981' : '#f59e0b'}`, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: accruing ? '#10b981' : '#f59e0b', boxShadow: accruing ? '0 0 0 4px rgba(16,185,129,0.2)' : '0 0 0 4px rgba(245,158,11,0.2)', animation: 'pulse 1.5s infinite' }} />
        <strong style={{ fontSize: 13, color: '#374151' }}>Verified minutes</strong>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 22, color: accruing ? '#065f46' : '#92400e' }}>{mm}:{ss}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#374151' }}>≈ <strong>{formatCredits(liveCredits)}</strong> credit(s)</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: accruing ? '#059669' : '#d97706', padding: '3px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.5 }}>{accruing ? 'Accruing' : 'Paused'}</span>
      </div>
      {!accruing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fcd34d', marginBottom: 8, fontSize: 12, color: '#92400e' }}>
          <span style={{ fontSize: 14 }}>⏸️</span>
          <span><strong>Credits paused.</strong> {!liveFields.mentorJoinedAt ? 'Waiting for the teacher to join.' : !liveFields.learnerJoinedAt ? 'Waiting for a learner to join.' : 'Waiting for verified overlap to begin.'} Credits only accrue while both teacher and learner are present.</span>
        </div>
      )}
      <span style={{ fontSize: 12, color: '#6b7280' }}>Mentor joined: {liveFields.mentorJoinedAt || '—'} • Learner joined: {liveFields.learnerJoinedAt || '—'} • Actual: {liveFields.actualDurationMinutes} min</span>
    </div>
  );
}


function MessagesPage({ messages, setMessages, sessions, setSessions, user, people, setPage }) {
  const contactProfiles = useMemo(() => {
    const map = new Map();
    people.forEach((person) => map.set(person.fullName, person));
    map.set(user.fullName, {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      avatar: user.avatar,
      region: user.region,
      languages: user.languages || [],
      interests: user.interests || [],
      bio: user.bio,
    });
    return map;
  }, [people, user]);
  const contacts = useMemo(() => {
    const names = Array.from(new Set([
      ...messages.map((message) => message.name),
      ...sessions.flatMap((session) => [session.teacher, session.learner]).filter((name) => name && name !== user.fullName && !name.includes('auto-assigned')),
      ...people.map((person) => person.fullName),
    ])).filter(Boolean);
    return names.length ? names : ['Community Inbox'];
  }, [messages, sessions, user.fullName, people]);
  const [activeContact, setActiveContact] = useState(() => localStorage.getItem('knowhow-open-chat') || contacts[0] || 'Community Inbox');
  const [text, setText] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('solo');
  const [messageSearch, setMessageSearch] = useState('');
  const [composerMode, setComposerMode] = useState('message');
  const [chatProfileOpen, setChatProfileOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState({
    topic: 'English Speaking',
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: '18:30',
    durationMinutes: 30,
    notes: '',
  });

  useEffect(() => {
    const intent = localStorage.getItem('knowhow-open-chat');
    if (intent) {
      setActiveContact(intent);
      localStorage.removeItem('knowhow-open-chat');
    }
  }, []);

  const groupContactNames = useMemo(() => {
    const set = new Set();
    messages.forEach((message) => {
      if (message.type === 'Group Chat' || message.type === 'group' || message.isGroup) set.add(message.name);
    });
    return set;
  }, [messages]);
  const isGroupContact = (contact) => groupContactNames.has(contact) || /\b(group|circle|club|team|community|cohort|squad)\b/i.test(contact);
  const filteredContacts = contacts.filter((contact) => {
    const matchesSearch = normalizeText(contact).includes(normalizeText(contactSearch)) || normalizeText(contactProfiles.get(contact)?.username).includes(normalizeText(contactSearch));
    const hasConversation = messages.some((message) => message.name === contact);
    if (!matchesSearch || !hasConversation) return false;
    const grouped = isGroupContact(contact);
    return activeFilter === 'group' ? grouped : !grouped;
  });
  const activeMessages = messages.filter((message) => message.name === activeContact && (!messageSearch.trim() || normalizeText([message.body, message.attachment?.name, message.attachment?.kind].join(' ')).includes(normalizeText(messageSearch))));
  const activeProfile = contactProfiles.get(activeContact);
  const relatedSessions = sessions.filter((session) => {
    const peopleInSession = [session.teacher, session.learner];
    if (activeContact === 'Community Inbox') return peopleInSession.includes(user.fullName);
    return peopleInSession.includes(user.fullName) && peopleInSession.includes(activeContact);
  });
  const lastActiveSession = relatedSessions.find((session) => session.status !== 'Completed') || relatedSessions[0];
  const canTeach = canUserTeach(user);

  function sendMessage(customBody = '', attachment = null) {
    const body = (customBody || text || (attachment ? attachmentLabel(attachment) : '')).trim();
    if (!body && !attachment) return;
    const tempId = crypto.randomUUID();
    const optimistic = {
      id: tempId,
      name: activeContact || 'Community Inbox',
      username: activeProfile?.username || normalizeText(activeContact).replace(/\s+/g, ''),
      type: composerMode === 'schedule' ? 'Schedule' : activeContact === 'Community Inbox' ? 'Community message' : 'Private message',
      body: body || attachmentLabel(attachment),
      attachment,
      time: formatNowLabel(),
      direction: 'outgoing',
      unread: false,
      delivered: true,
    };
    setMessages((current) => [...current, optimistic]);
    setText('');
    setComposerMode('message');
    // Persist to cloud so the recipient sees it
    const recipientId = activeProfile?.id;
    if (recipientId && activeContact !== 'Community Inbox' && activeContact !== user.fullName) {
      apiRequest('/messages', {
        method: 'POST',
        body: {
          recipientId,
          body: body || attachmentLabel(attachment),
          messageType: composerMode === 'schedule' ? 'schedule' : 'private',
          attachments: attachment || {},
        },
      }).then((saved) => {
        if (!saved?.id) return;
        setMessages((current) => current.map((m) => m.id === tempId ? { ...m, id: saved.id, cloudId: saved.id, createdAt: saved.createdAt || new Date().toISOString() } : m));
      }).catch((err) => { console.warn('sendMessage failed', err); });
    }
  }


  async function sendMediaFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || !activeContact) return;
    const tooLarge = files.find((file) => file.size > 5 * 1024 * 1024);
    if (tooLarge) {
      sendMessage(`Attachment too large for local demo storage: ${tooLarge.name}. Please keep files under 5MB.`);
      return;
    }
    const attachments = await Promise.all(files.map(async (file) => ({
      name: file.name,
      mime: file.type || 'application/octet-stream',
      kind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file',
      size: file.size,
      url: await readFileAsDataUrl(file),
    })));
    const fileMessages = attachments.map((attachment) => ({
      id: crypto.randomUUID(),
      name: activeContact || 'Community Inbox',
      username: activeProfile?.username || normalizeText(activeContact).replace(/\s+/g, ''),
      type: activeContact === 'Community Inbox' ? 'Community message' : 'Private message',
      body: attachmentLabel(attachment),
      attachment,
      time: formatNowLabel(),
      direction: 'outgoing',
      unread: false,
      delivered: true,
    }));
    setMessages((current) => [...current, ...fileMessages]);
  }

  function sendSchedule(session) {
    sendMessage(`Schedule shared: ${session.topic} on ${session.date} at ${session.time} • ${formatCredits(session.credits)} credits • Status: ${session.status}`);
  }

  function createScheduleFromMessage() {
    if (!canTeach) {
      sendMessage('Only approved teachers can create schedules. As a learner, you can join after a teacher creates and assigns a session.');
      setComposerMode('message');
      return;
    }
    if (!activeContact || activeContact === user.fullName || activeContact === 'Community Inbox') return;
    const durationMinutes = Math.max(1, Number(scheduleDraft.durationMinutes) || 30);
    const duration = Number((durationMinutes / 60).toFixed(2));
    const credits = minutesToCredits(durationMinutes);
    const roomId = createSecureRoomId();
    const session = {
      id: crypto.randomUUID(),
      topic: scheduleDraft.topic.trim() || 'Learning Session',
      teacher: user.fullName,
      learner: activeContact,
      date: scheduleDraft.date,
      time: scheduleDraft.time,
      duration,
      durationMinutes,
      credits,
      status: 'Pending',
      roomId,
      meetingLink: buildMeetingUrl(roomId),
      meetingProvider: 'Know-how Room',
      meetingSpaceName: buildJitsiRoomName(roomId),
      attendance: [],
      mentorJoinedAt: '',
      mentorLeftAt: '',
      learnerJoinedAt: '',
      learnerLeftAt: '',
      actualDurationMinutes: 0,
      verifiedDurationMinutes: 0,
      attendanceVerified: false,
      notes: scheduleDraft.notes || `Created by teacher from Messenger schedule with ${activeContact}`,
      createdFrom: 'messages',
      creatorOnly: 'teacher',
    };
    setSessions([session, ...sessions]);
    sendMessage(`📅 Teaching schedule created: ${session.topic} on ${session.date} at ${session.time} • ${durationMinutes} min • ${formatCredits(session.credits)} credits. Learner can join when accepted/assigned.`);
    setComposerMode('message');
  }

  function startCall() {
    if (lastActiveSession) {
      setPage('sessions');
      return;
    }
    sendMessage(`Let's create a session and start a video call for ${activeContact}.`);
    setPage('sessions');
  }

  function openContact(contact) {
    setActiveContact(contact);
    setMessages(messages.map((message) => message.name === contact ? { ...message, unread: false } : message));
  }

  return (
    <section className="messages-page modern-messages-page messenger-flex-page">
      <div className="messages-layout card messenger-flex-shell">
        <aside className="messages-contact-panel">
          <div className="messages-panel-head messenger-title-row simple-messenger-title-row">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'nowrap' }}><strong>Chat</strong></div>
          </div>
          <div className="messenger-search-wrap">
            <svg className="messenger-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="compact-input messenger-search-input" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Search people or groups" />
          </div>
          <div className="chat-filter-row"><button type="button" className={activeFilter === 'solo' ? 'active' : ''} onClick={() => setActiveFilter('solo')}>People</button><button type="button" className={activeFilter === 'group' ? 'active' : ''} onClick={() => setActiveFilter('group')}>Group</button></div>
          <div className="contact-scroll modern-contact-scroll">
            {filteredContacts.length === 0 && <p className="muted-text empty-contacts">No conversations found.</p>}
            {filteredContacts.map((contact) => {
              const last = [...messages].reverse().find((message) => message.name === contact);
              const profile = contactProfiles.get(contact);
              const unreadCount = messages.filter((message) => message.name === contact && message.unread).length;
              return (
                <button key={contact} className={`messenger-contact modern-contact ${activeContact === contact ? 'active' : ''}`} onClick={() => openContact(contact)}>
                  <span className="avatar-wrap"><Avatar text={profile?.avatar || getInitials(contact)} /><i /></span>
                  <span className="contact-copy"><strong>{contact}</strong><small>{messagePreview(last)}</small></span>
                  <span className="contact-side">{unreadCount > 0 ? <b className="unread-dot">{unreadCount}</b> : <small>{last?.time || ''}</small>}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="messages-chat-panel">
          <header className="messages-chat-header messenger-chat-title">
            <div className="profile-head no-margin" style={{ cursor: activeProfile ? 'pointer' : 'default' }} onClick={() => { if (activeProfile) setChatProfileOpen(true); }}>
              <Avatar text={activeProfile?.avatar || getInitials(activeContact)} />
              <div><h3>{activeContact}</h3><p className="muted-text">{activeProfile ? `@${activeProfile.username} • ${activeProfile.region || 'Region hidden'}` : 'Community conversation'} • Active now</p></div>
            </div>

          </header>
          {messageSearch !== '' && <div className="message-search-row"><input value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} autoFocus placeholder="Search in conversation..." /><button className="ghost" onClick={() => setMessageSearch('')}>Close</button></div>}

          <div className="message-session-strip compact-message-session-strip">
            {relatedSessions.length === 0 && <div className="schedule-chip"><strong>No session yet</strong><span>{canTeach ? 'Create a teacher schedule here, or open Sessions for advanced options.' : 'No session yet. Learners can join after a teacher creates a session.'}</span>{canTeach && <button className="ghost" onClick={() => setComposerMode('schedule')}>Create</button>}</div>}
            {relatedSessions.slice(0, 3).map((session) => (
              <div className="schedule-chip" key={session.id}>
                <strong>{session.topic}</strong><span>{session.date} • {session.time} • {formatCredits(session.credits)} credits</span>
                <button className="ghost" onClick={() => sendSchedule(session)}>Send</button>
              </div>
            ))}
          </div>

          {canTeach && composerMode === 'schedule' && (
            <div className="schedule-builder modern-schedule-builder">
              <div><label>Topic</label><input value={scheduleDraft.topic} onChange={(event) => setScheduleDraft({ ...scheduleDraft, topic: event.target.value })} /></div>
              <div><label>Date</label><input type="date" value={scheduleDraft.date} onChange={(event) => setScheduleDraft({ ...scheduleDraft, date: event.target.value })} /></div>
              <div><label>Time</label><input type="time" value={scheduleDraft.time} onChange={(event) => setScheduleDraft({ ...scheduleDraft, time: event.target.value })} /></div>
              <div><label>Duration</label><input type="number" min="1" step="1" value={scheduleDraft.durationMinutes} onChange={(event) => setScheduleDraft({ ...scheduleDraft, durationMinutes: event.target.value })} /></div>
              <div className="wide"><label>Note</label><input value={scheduleDraft.notes} onChange={(event) => setScheduleDraft({ ...scheduleDraft, notes: event.target.value })} placeholder="Goals, files, preparation..." /></div>
              <button className="primary" onClick={createScheduleFromMessage}>Create & Send</button>
            </div>
          )}

          <div className="chat-messages message-thread-body">
            <div className="thread-date-divider">TODAY</div>
            {activeMessages.length === 0 && <p className="muted-text center-text">No messages yet. Start a conversation.</p>}
            {activeMessages.map((message) => (
              <div className={`bubble-row ${message.direction === 'outgoing' ? 'me' : 'them'}`} key={message.id}>
                {message.direction !== 'outgoing' && <span style={{ cursor: activeProfile ? 'pointer' : 'default' }} onClick={() => { if (activeProfile) setChatProfileOpen(true); }}><Avatar text={activeProfile?.avatar || getInitials(activeContact)} /></span>}
                <div className={`bubble ${message.direction === 'outgoing' ? 'outgoing' : 'incoming'}`}>
                  {message.attachment && <MediaPreview attachment={message.attachment} />}
                  <p>{message.body}</p>
                  <small>{message.type} • {message.time}{message.delivered ? ' • Delivered' : ''}{message.reaction ? ` • ${message.reaction}` : ''}</small>
                </div>
                {message.direction === 'outgoing' && <Avatar text={user.avatar} />}
              </div>
            ))}
          </div>

          <div className="messenger-composer modern-composer simple-message-composer attachment-message-composer">
            <label className="attachment-button clip-attachment-button" htmlFor="message-attachment-input" title="Attach image or file" aria-label="Attach image or file">📎</label>
            <input id="message-attachment-input" className="hidden-file-input" type="file" multiple onChange={sendMediaFiles} />
            <input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendMessage(); }} placeholder={composerMode === 'schedule' ? `Type schedule note for ${activeContact}...` : 'Type a message...'} />
            <button className="primary messenger-send-button" onClick={() => sendMessage()}>Send</button>
          </div>
        </section>
      </div>
      {chatProfileOpen && activeProfile && (
        <div className="modal-backdrop high-modal-backdrop" onClick={() => setChatProfileOpen(false)}>
          <div className="modal card search-profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h3>User Profile</h3>
              <button className="ghost" type="button" onClick={() => setChatProfileOpen(false)}>Close</button>
            </div>
            <div className="profile-head">
              <Avatar text={activeProfile.avatar || getInitials(activeProfile.fullName || activeContact)} large />
              <div>
                <h2>{activeProfile.fullName || activeContact}</h2>
                <p>@{activeProfile.username || '—'} • {activeProfile.region || 'Region hidden'}</p>
                {activeProfile.role && <p className="muted-text">{activeProfile.role}</p>}
              </div>
            </div>
            {activeProfile.bio && <p>{activeProfile.bio}</p>}
            {(activeProfile.languages?.length || activeProfile.interests?.length) ? (
              <div className="pill-wrap left">
                {(activeProfile.languages || []).map((item) => <span className="pill muted" key={`lang-${item}`}>{item}</span>)}
                {(activeProfile.interests || []).map((item) => <span className="pill" key={`int-${item}`}>{item}</span>)}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}



function MediaPreview({ attachment }) {
  if (!attachment?.url) return null;
  if (attachment.kind === 'video') {
    return <video className="message-media" src={attachment.url} controls preload="metadata" />;
  }
  if (attachment.kind === 'image') {
    return <img className="message-media" src={attachment.url} alt={attachment.name || 'attachment'} />;
  }
  return <a className="message-file-chip" href={attachment.url} download={attachment.name || 'attachment'}>📎 {attachment.name || 'Download file'}</a>;
}

function ProfilePage({ user, setUser, level, teacherApplications, setTeacherApplications }) {
  const buildDraft = (source) => ({
    ...source,
    languagesInput: (source.languages || []).join(', '),
    interestsInput: (source.interests || []).join(', '),
  });
  const [draft, setDraft] = useState(buildDraft(user));
  const [editDraft, setEditDraft] = useState(buildDraft(user));
  const [application, setApplication] = useState({
    linkedInUrl: user.social || '',
    cvUrl: '',
    licenseUrl: '',
    authorityName: '',
    subject: 'Japanese',
    requestedRole: 'assistant_teacher',
    learnerLevel: user.learnerLevel || 'Beginner',
    teacherLevelClaim: '',
    note: '',
  });
  const [applicationNotice, setApplicationNotice] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const [showLevelDialog, setShowLevelDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const myApplications = (teacherApplications || []).filter((item) => item.userId === user.id || item.username === user.username || item.email === user.email);

  function parseList(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  function openEditDialog() {
    setEditDraft(buildDraft(draft));
    setProfileNotice('');
    setShowEditDialog(true);
  }

  async function saveProfileEdits() {
    setProfileNotice('');
    if (!String(editDraft.fullName || '').trim()) {
      setProfileNotice('Name is required.');
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(String(editDraft.username || '').trim())) {
      setProfileNotice('Username must be 3-24 characters: lowercase letters, numbers, underscore only.');
      return;
    }
    const normalized = {
      ...draft,
      ...editDraft,
      fullName: String(editDraft.fullName || '').trim(),
      username: String(editDraft.username || '').trim().toLowerCase(),
      email: String(editDraft.email || '').trim(),
      avatar: editDraft.avatar || getInitials(editDraft.fullName),
      age: editDraft.age,
      languages: parseList(editDraft.languagesInput),
      interests: parseList(editDraft.interestsInput),
    };
    setSavingProfile(true);
    try {
      if (localStorage.getItem('knowhow-token')) {
        await apiRequest('/users/me/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: normalized.fullName,
            username: normalized.username,
            email: normalized.email,
            profile: {
              builtInAvatar: normalized.avatar,
              bio: normalized.bio || '',
              region: normalized.region || '',
              age: normalized.age ? Number(normalized.age) : undefined,
              languages: normalized.languages,
              interests: normalized.interests,
              education: normalized.education ? [{ degree: normalized.education }] : [],
              workExperience: normalized.work ? [{ role: normalized.work }] : [],
              portfolioLinks: normalized.portfolio ? [normalized.portfolio] : [],
              socialLinks: normalized.social ? [normalized.social] : [],
              theme: normalized.theme || 'light',
              notifications: { sessionReminders: normalized.notifications !== false },
              privacy: { showRegion: normalized.privacy !== 'Private' && normalized.privacy !== 'Private profile' },
            },
          }),
        });
      }
      setDraft(buildDraft(normalized));
      setUser(normalized);
      setShowEditDialog(false);
    } catch (error) {
      setProfileNotice(error.message || 'Profile could not be saved.');
    } finally {
      setSavingProfile(false);
    }
  }

  function addOfferedSkill() {
    const nextDraft = {
      ...draft,
      skillsOffered: [
        ...draft.skillsOffered,
        { id: crypto.randomUUID(), name: 'New Skill', category: 'Creative', description: 'Describe your skill.', level: 'Beginner', availability: 'Flexible', duration: 1 },
      ],
    };
    setDraft(nextDraft);
    setUser(nextDraft);
  }

  function addWantedSkill() {
    const nextDraft = {
      ...draft,
      skillsWanted: [
        ...draft.skillsWanted,
        { id: crypto.randomUUID(), name: 'New Learning Goal', category: 'Business', goal: 'Describe your goal.', target: 'Beginner' },
      ],
    };
    setDraft(nextDraft);
    setUser(nextDraft);
  }

  async function submitTeacherApplication() {
    setApplicationNotice('');
    if (!application.subject.trim()) {
      setApplicationNotice('Subject is required.');
      return;
    }
    if (!application.linkedInUrl.trim() && !application.cvUrl.trim() && !application.licenseUrl.trim()) {
      setApplicationNotice('Please add at least one proof: LinkedIn, CV/portfolio, or license/certificate link.');
      return;
    }
    const pendingDuplicate = myApplications.find((item) => item.status === 'Pending' && normalizeText(item.subject) === normalizeText(application.subject));
    if (pendingDuplicate) {
      setApplicationNotice('You already have a pending application for this subject.');
      return;
    }
    const newApplication = {
      id: crypto.randomUUID(),
      source: 'local-demo',
      userId: user.id,
      userName: draft.fullName,
      username: draft.username,
      email: user.email,
      subject: application.subject.trim(),
      requestedRole: application.requestedRole,
      learnerLevel: application.learnerLevel,
      teacherLevelClaim: application.teacherLevelClaim || (application.requestedRole === 'teacher' ? 'Qualified teacher level claimed' : 'Assistant teacher level claimed'),
      linkedInUrl: application.linkedInUrl.trim(),
      cvUrl: application.cvUrl.trim(),
      licenseUrl: application.licenseUrl.trim(),
      authorityName: application.authorityName.trim(),
      note: application.note.trim(),
      status: 'Pending',
      submittedAt: new Date().toISOString(),
      reviewTrail: [{ at: new Date().toISOString(), action: 'Submitted', by: draft.fullName }],
    };
    setTeacherApplications([newApplication, ...(teacherApplications || [])]);
    const nextDraft = {
      ...draft,
      teacherPath: `${application.requestedRole === 'teacher' ? 'Teacher' : 'Assistant Teacher'} application pending`,
      licenseStatus: application.licenseUrl || application.authorityName ? 'Submitted' : 'LinkedIn/CV submitted',
    };
    setDraft(buildDraft(nextDraft));
    setUser(nextDraft);

    try {
      await apiRequest('/qualifications/teacher-applications', {
        method: 'POST',
        body: JSON.stringify({
          subject: newApplication.subject,
          requestedRole: newApplication.requestedRole,
          learnerLevel: newApplication.learnerLevel,
          teacherLevelClaim: newApplication.teacherLevelClaim,
          linkedInUrl: newApplication.linkedInUrl,
          cvUrl: newApplication.cvUrl,
          licenseUrl: newApplication.licenseUrl,
          authorityName: newApplication.authorityName,
          note: newApplication.note,
        }),
      });
      setApplicationNotice('Application submitted.');
    } catch (error) {
      setApplicationNotice('Application saved locally.');
    }
  }

  function updateOfferedSkill(index, next) {
    const updated = [...draft.skillsOffered];
    updated[index] = next;
    const nextDraft = { ...draft, skillsOffered: updated };
    setDraft(nextDraft);
    setUser(nextDraft);
  }

  function updateWantedSkill(index, next) {
    const updated = [...draft.skillsWanted];
    updated[index] = next;
    const nextDraft = { ...draft, skillsWanted: updated };
    setDraft(nextDraft);
    setUser(nextDraft);
  }

  return (
    <section>
      <ProfileOptionLists />
      <PageHeader title="Profile" subtitle="View your profile details, skills, XP, and teaching level." />
      <div className="profile-grid">
        <div className="card profile-display-card profile-main-card-with-edit">
          <button className="profile-edit-pencil" type="button" onClick={openEditDialog} title="Edit profile" aria-label="Edit profile">✎</button>
          <div className="profile-head">
            <Avatar text={draft.avatar || getInitials(draft.fullName)} large />
            <div>
              <h2>{draft.fullName}</h2>
              <p>@{draft.username} • {draft.role}</p>
            </div>
          </div>
          <div className="profile-readonly-grid">
            <MiniPill title="Email" text={draft.email || 'Not added'} />
            <MiniPill title="Languages" text={(draft.languages || []).join(', ') || 'Not added'} />
            <MiniPill title="Region" text={draft.region || 'Not added'} />
            <MiniPill title="Age" text={draft.age || 'Not added'} />
          </div>
          <div className="readonly-section"><label>Interests</label><p>{(draft.interests || []).join(', ') || 'Not added'}</p></div>
          <div className="readonly-section"><label>Bio</label><p>{draft.bio || 'No bio added yet.'}</p></div>
          <div className="readonly-section"><label>Education</label><p>{draft.education || 'Not added'}</p></div>
          <div className="readonly-section"><label>Work Experience</label><p>{draft.work || 'Not added'}</p></div>
          <div className="profile-link-grid">
            <MiniPill title="Portfolio" text={draft.portfolio || 'Not added'} />
            <MiniPill title="Social" text={draft.social || 'Not added'} />
          </div>
        </div>

        <div className="card profile-xp-card">
          <div className="section-title"><h3>XP, Badges & Challenges</h3><span className="pill muted">{level.name} • {draft.xp}/{level.next} XP</span></div>
          <div className="progress"><span style={{ width: `${level.progress}%` }} /></div>
          <div className="badge-grid compact-view">
            {['First Exchange', 'First Skill Shared', '10 Hours Taught', 'Community Helper', 'Top Mentor', 'Knowledge Champion', '100 Hours Completed'].map((badge) => (
              <div className={`badge ${draft.badges.includes(badge) ? 'earned' : ''}`} key={badge}>🏅<span>{badge}</span></div>
            ))}
          </div>
          <h3>Challenges</h3>
          <div className="challenge-grid">
            {CHALLENGES.map((challenge) => {
              const percent = Math.min(100, Math.round((challenge.progress / challenge.total) * 100));
              return <div className="challenge-card" key={challenge.title}><strong>{challenge.title}</strong><span>{challenge.progress}/{challenge.total} complete • +{challenge.reward} XP</span><div className="progress"><span style={{ width: `${percent}%` }} /></div></div>;
            })}
          </div>
        </div>
      </div>

      {showEditDialog && (
        <div className="modal-backdrop">
          <div className="modal card profile-edit-modal">
            <div className="section-title">
              <h2>Edit Profile</h2>
              <button className="icon" type="button" onClick={() => setShowEditDialog(false)}>×</button>
            </div>
            <div className="profile-head compact-profile-head">
              <Avatar text={editDraft.avatar || getInitials(editDraft.fullName)} />
              <div><strong>{editDraft.fullName || 'Your name'}</strong><span>@{editDraft.username || 'username'}</span></div>
            </div>
            <label>Avatar</label>
            <div className="avatar-picker">
              {['KH', getInitials(editDraft.fullName), '😊', '🌱', '📘', '🚀'].map((avatarOption) => (
                <button type="button" key={avatarOption} className={editDraft.avatar === avatarOption ? 'active' : ''} onClick={() => setEditDraft({ ...editDraft, avatar: avatarOption })}>{avatarOption}</button>
              ))}
              <input value={editDraft.avatar || ''} maxLength="3" onChange={(event) => setEditDraft({ ...editDraft, avatar: event.target.value.slice(0, 3) })} placeholder="Custom" />
            </div>
            <div className="form-grid two">
              <div><label>Full Name</label><input value={editDraft.fullName || ''} onChange={(event) => setEditDraft({ ...editDraft, fullName: event.target.value })} /></div>
              <div><label>Username</label><input value={editDraft.username || ''} onChange={(event) => setEditDraft({ ...editDraft, username: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></div>
            </div>
            <label>Email</label>
            <input value={editDraft.email || ''} type="email" onChange={(event) => setEditDraft({ ...editDraft, email: event.target.value })} />
            <div className="form-grid three">
              <div><label>Languages</label><input list="language-options" value={editDraft.languagesInput || ''} onChange={(event) => setEditDraft({ ...editDraft, languagesInput: event.target.value })} placeholder="Myanmar, English" /></div>
              <div><label>Region</label><input list="region-options" value={editDraft.region || ''} onChange={(event) => setEditDraft({ ...editDraft, region: event.target.value })} placeholder="Yangon, Myanmar" /></div>
              <div><label>Age</label><input type="number" min="13" max="120" value={editDraft.age || ''} onChange={(event) => setEditDraft({ ...editDraft, age: event.target.value })} /></div>
            </div>
            <label>Interests</label>
            <input value={editDraft.interestsInput || ''} onChange={(event) => setEditDraft({ ...editDraft, interestsInput: event.target.value })} placeholder="Japanese, Video Editing, UI/UX" />
            <label>Bio</label>
            <textarea value={editDraft.bio || ''} onChange={(event) => setEditDraft({ ...editDraft, bio: event.target.value })} />
            <div className="form-grid two">
              <div><label>Education</label><input value={editDraft.education || ''} onChange={(event) => setEditDraft({ ...editDraft, education: event.target.value })} /></div>
              <div><label>Work Experience</label><input value={editDraft.work || ''} onChange={(event) => setEditDraft({ ...editDraft, work: event.target.value })} /></div>
            </div>
            <div className="form-grid two">
              <div><label>Portfolio Link</label><input value={editDraft.portfolio || ''} onChange={(event) => setEditDraft({ ...editDraft, portfolio: event.target.value })} /></div>
              <div><label>LinkedIn / Social Media Link</label><input value={editDraft.social || ''} onChange={(event) => setEditDraft({ ...editDraft, social: event.target.value })} /></div>
            </div>

            <div className="edit-profile-skills-panel">
              <div className="section-title"><h3>Skills Offered</h3><button className="ghost" type="button" onClick={() => setEditDraft({ ...editDraft, skillsOffered: [...(editDraft.skillsOffered || []), { id: crypto.randomUUID(), name: 'New Skill', category: 'General', level: 'Beginner', description: 'Describe this skill.', certificate: '', duration: 1 }] })}>Add</button></div>
              <div className="list">
                {(editDraft.skillsOffered || []).map((skill, index) => (
                  <SkillEditor key={skill.id || index} skill={skill} onChange={(next) => {
                    const updated = [...(editDraft.skillsOffered || [])];
                    updated[index] = next;
                    setEditDraft({ ...editDraft, skillsOffered: updated });
                  }} />
                ))}
              </div>
            </div>

            <div className="edit-profile-skills-panel">
              <div className="section-title"><h3>Skills Wanted</h3><button className="ghost" type="button" onClick={() => setEditDraft({ ...editDraft, skillsWanted: [...(editDraft.skillsWanted || []), { id: crypto.randomUUID(), name: 'New Goal', category: 'General', goal: 'Describe your goal.', target: 'Beginner' }] })}>Add</button></div>
              <div className="list">
                {(editDraft.skillsWanted || []).map((skill, index) => (
                  <WantedSkillEditor key={skill.id || index} skill={skill} onChange={(next) => {
                    const updated = [...(editDraft.skillsWanted || [])];
                    updated[index] = next;
                    setEditDraft({ ...editDraft, skillsWanted: updated });
                  }} />
                ))}
              </div>
            </div>

            {profileNotice && <p className="error-text">{profileNotice}</p>}
            <div className="modal-actions">
              <button className="ghost" type="button" onClick={() => setShowEditDialog(false)}>Cancel</button>
              <button className="primary" type="button" onClick={saveProfileEdits} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {showLevelDialog && (
        <div className="modal-backdrop">
          <div className="modal card level-form-modal">
            <div className="section-title">
              <h2>Learner & Teacher Levels</h2>
              <button className="icon" type="button" onClick={() => setShowLevelDialog(false)}>×</button>
            </div>
            <div className="level-grid">
              <MiniPill title="Learner Level" text={draft.learnerLevel} />
              <MiniPill title="Teacher Level" text={draft.teacherLevel} />
              <MiniPill title="License Status" text={draft.licenseStatus} />
            </div>
            <div className="list level-subject-list">
              {draft.subjectLevels.map((subjectLevel, index) => (
                <div className="skill-row" key={`${subjectLevel.subject}-${index}`}>
                  <div><strong>{subjectLevel.subject}</strong><span>Learner: {subjectLevel.learnerLevel} • Teacher: {subjectLevel.teacherLevel}</span></div>
                </div>
              ))}
            </div>

            <h3>Apply for Teaching Authority</h3>
            <div className="form-grid two">
              <div><label>Subject</label><input value={application.subject} onChange={(event) => setApplication({ ...application, subject: event.target.value })} placeholder="Japanese, English Speaking..." /></div>
              <div><label>Requested Role</label><select value={application.requestedRole} onChange={(event) => setApplication({ ...application, requestedRole: event.target.value })}><option value="assistant_teacher">Assistant Teacher</option><option value="teacher">Teacher</option></select></div>
            </div>
            <div className="form-grid two">
              <div><label>Your Learner Level</label><input value={application.learnerLevel} onChange={(event) => setApplication({ ...application, learnerLevel: event.target.value })} placeholder="N5, Beginner, Intermediate..." /></div>
              <div><label>Teacher Level Claim</label><input value={application.teacherLevelClaim} onChange={(event) => setApplication({ ...application, teacherLevelClaim: event.target.value })} placeholder="N1, Advanced, Certified..." /></div>
            </div>
            <label>LinkedIn</label>
            <input value={application.linkedInUrl} onChange={(event) => setApplication({ ...application, linkedInUrl: event.target.value })} placeholder="https://linkedin.com/in/..." />
            <label>CV / Portfolio URL</label>
            <input value={application.cvUrl} onChange={(event) => setApplication({ ...application, cvUrl: event.target.value })} placeholder="CV, resume, portfolio, Google Drive link" />
            <label>License / Educational Authority Proof</label>
            <input value={application.licenseUrl} onChange={(event) => setApplication({ ...application, licenseUrl: event.target.value })} placeholder="Certificate/license number or link" />
            <label>Authority / School / Organization Name</label>
            <input value={application.authorityName} onChange={(event) => setApplication({ ...application, authorityName: event.target.value })} placeholder="University, school, company, training center" />
            <label>Admin Note</label>
            <textarea value={application.note} onChange={(event) => setApplication({ ...application, note: event.target.value })} placeholder="Explain why you are qualified and what you can teach." />
            {applicationNotice && <div className="notice">{applicationNotice}</div>}
            <button className="primary full" type="button" onClick={submitTeacherApplication}>Submit to Admin Review</button>
          </div>
        </div>
      )}

      <div className="card level-popup-card swapped-level-card">
        <div className="section-title">
          <h3>Learner & Teacher Levels</h3>
          <button className="primary" type="button" onClick={() => setShowLevelDialog(true)}>Open Form</button>
        </div>
        <div className="level-grid">
          <MiniPill title="Learner Level" text={draft.learnerLevel} />
          <MiniPill title="Teacher Level" text={draft.teacherLevel} />
          <MiniPill title="License Status" text={draft.licenseStatus} />
        </div>
        {applicationNotice && <div className="notice compact-notice">{applicationNotice}</div>}
      </div>
    </section>
  );
}


function SettingsPage({ user, setUser, onLogout }) {
  const [activeSection, setActiveSection] = useState('security');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [language, setLanguage] = useState(() => (typeof window !== 'undefined' && window.localStorage.getItem('knowhow-language')) || 'English');

  const [draft, setDraft] = useState({
    theme: user.theme || 'light',
    privacy: user.privacy || 'Community visible',
    notifications: user.notifications ?? true,
    twoFactor: user.twoFactor ?? false,
    criticalAlerts: true,
    loginAlerts: true,
    marketingEmails: false,
    publicProfile: user.privacy !== 'Private profile',
    showRegion: user.privacy !== 'Private profile',
    allowMessages: true,
    autoPlayFreeVideos: true,
    compactMode: false,
  });
  const [passwordDraft, setPasswordDraft] = useState({ old: '', next: '', confirm: '' });
  const [settingsNotice, setSettingsNotice] = useState('');
  const [feedback, setFeedback] = useState('');
  const [subscriptionPlan, setSubscriptionPlan] = useState('Free');
  const paymentStorageKey = `knowhow:payment-methods:${user?.id || 'guest'}`;
  const [paymentMethods, setPaymentMethods] = useState(() => {
    try {
      const raw = window.localStorage.getItem(paymentStorageKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [paymentModal, setPaymentModal] = useState(null); // null | { mode: 'add' | 'edit', index, draft }
  useEffect(() => {
    try { window.localStorage.setItem(paymentStorageKey, JSON.stringify(paymentMethods)); } catch {}
  }, [paymentStorageKey, paymentMethods]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(paymentStorageKey);
      setPaymentMethods(raw ? JSON.parse(raw) : []);
    } catch { setPaymentMethods([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function openAddPayment() {
    setPaymentModal({ mode: 'add', index: -1, draft: { brand: 'Visa', last4: '', expiry: '', holder: user?.name || '' } });
  }
  function openEditPayment(index) {
    const m = paymentMethods[index];
    if (!m) return;
    setPaymentModal({ mode: 'edit', index, draft: { ...m } });
  }
  function savePaymentModal() {
    const d = paymentModal?.draft;
    if (!d) return;
    const last4 = (d.last4 || '').replace(/\D/g, '').slice(-4);
    if (last4.length !== 4) { setSettingsNotice('Enter the last 4 digits of the card.'); return; }
    if (!/^\d{2}\/\d{2}$/.test(d.expiry || '')) { setSettingsNotice('Expiry must be in MM/YY format.'); return; }
    const next = { brand: d.brand || 'Card', last4, expiry: d.expiry, holder: d.holder || '' };
    setPaymentMethods((curr) => {
      const copy = [...curr];
      if (paymentModal.mode === 'edit' && paymentModal.index >= 0) copy[paymentModal.index] = next;
      else copy.push(next);
      return copy;
    });
    setPaymentModal(null);
    setSettingsNotice(paymentModal.mode === 'edit' ? 'Payment method updated.' : 'Payment method added.');
  }
  function removePaymentMethod(index) {
    setPaymentMethods((curr) => curr.filter((_, i) => i !== index));
    setSettingsNotice('Payment method removed.');
  }

  const sections = [
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'security', label: 'Security', icon: '🛡️' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
    { id: 'privacy', label: 'Privacy', icon: '🔒' },
    { id: 'billing', label: 'Payment Info', icon: '💳' },
    { id: 'subscription', label: 'Subscription', icon: '⭐' },
    { id: 'appearance', label: 'Appearance', icon: '👁️' },
    { id: 'language', label: 'Language', icon: '🌐' },
    { id: 'support', label: 'Help and Support', icon: '?' },
    { id: 'about', label: 'About', icon: 'i' },

  ];

  const filteredSections = sections.filter((item) => item.label.toLowerCase().includes(settingsSearch.toLowerCase().trim()));

  useEffect(() => {
    if (!settingsNotice) return undefined;
    const timer = window.setTimeout(() => setSettingsNotice(''), 2400);
    return () => window.clearTimeout(timer);
  }, [settingsNotice]);

  function setDraftField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function applyUserSettings(nextDraft = draft) {
    setUser({
      ...user,
      theme: nextDraft.theme,
      privacy: nextDraft.publicProfile ? (nextDraft.showRegion ? 'Community visible' : 'Only matched users') : 'Private profile',
      notifications: nextDraft.notifications,
      twoFactor: nextDraft.twoFactor,
    });
  }

  function updateTheme(isDark) {
    const nextDraft = { ...draft, theme: isDark ? 'dark' : 'light' };
    setDraft(nextDraft);
    applyUserSettings(nextDraft);
    setSettingsNotice(`${isDark ? 'Dark' : 'Light'} mode applied.`);
  }

  function updatePrivacy(field, value) {
    const nextDraft = { ...draft, [field]: value };
    setDraft(nextDraft);
    applyUserSettings(nextDraft);
  }

  function changePassword(event) {
    event.preventDefault();
    if (!passwordDraft.old || !passwordDraft.next || !passwordDraft.confirm) {
      setSettingsNotice('Fill old password, new password, and confirm password.');
      return;
    }
    if (passwordDraft.next.length < 6) {
      setSettingsNotice('New password must be at least 6 characters.');
      return;
    }
    if (passwordDraft.next !== passwordDraft.confirm) {
      setSettingsNotice('New password and confirmation do not match.');
      return;
    }
    setPasswordDraft({ old: '', next: '', confirm: '' });
    setSettingsNotice('Password update saved for this demo account.');
  }

  function toggleTwoFactor() {
    const nextDraft = { ...draft, twoFactor: !draft.twoFactor };
    setDraft(nextDraft);
    applyUserSettings(nextDraft);
    setSettingsNotice(nextDraft.twoFactor ? 'Two-factor authentication enabled.' : 'Two-factor authentication disabled.');
  }

  function saveAll() {
    applyUserSettings();
    setSettingsNotice('Settings saved.');
  }

  function sendFeedback() {
    if (!feedback.trim()) {
      setSettingsNotice('Please add a short support message first.');
      return;
    }
    setFeedback('');
    setSettingsNotice('Your support message was saved for the Know-how team.');
  }

  function renderSection() {
    if (activeSection === 'profile') {
      return (
        <div className="settings-panel-card">
          <h2>Profile Settings</h2>
          <div className="settings-profile-summary">
            <Avatar text={user.avatar || getInitials(user.fullName)} large />
            <div><strong>{user.fullName}</strong><span>@{user.username} • {user.email}</span></div>
          </div>
          <div className="settings-form-grid two">
            <MiniPill title="Region" text={user.region || 'Not set'} />
            <MiniPill title="Languages" text={(user.languages || []).join(', ') || 'Not set'} />
            <MiniPill title="Role" text={user.role || 'Learner'} />
            <MiniPill title="Credits" text={`${formatCredits(user.wallet?.current || 0)} credits`} />
          </div>
          <p className="muted-text">Use the Profile page Edit button to update name, language, region, education, links, and other personal details.</p>
        </div>
      );
    }

    if (activeSection === 'security') {
      return (
        <div className="settings-panel-card">
          <div className="settings-section-head"><div><h2>Security Settings</h2><p>Control password, login protection, and recent sessions.</p></div><button className="ghost" type="button" onClick={saveAll}>Save</button></div>
          <form className="security-inline-form" onSubmit={changePassword}>
            <h3>Change Password</h3>
            <div><label>Old</label><input type="password" value={passwordDraft.old} onChange={(event) => setPasswordDraft({ ...passwordDraft, old: event.target.value })} /></div>
            <div><label>New</label><input type="password" value={passwordDraft.next} onChange={(event) => setPasswordDraft({ ...passwordDraft, next: event.target.value })} /></div>
            <div><label>Confirm</label><input type="password" value={passwordDraft.confirm} onChange={(event) => setPasswordDraft({ ...passwordDraft, confirm: event.target.value })} /></div>
            <button className="primary" type="submit">Update Password</button>
          </form>
          <div className="settings-row bordered-row">
            <div><strong>Two-Factor Authentication (2FA)</strong><span>Require an extra verification step when signing in.</span></div>
            <label className="mini-switch"><input type="checkbox" checked={draft.twoFactor} onChange={toggleTwoFactor} /><i /></label>
            <button className="ghost" type="button" onClick={() => { setDraftField('twoFactor', true); setSettingsNotice('2FA setup opened for demo mode.'); }}>Setup 2FA</button>
          </div>
        </div>
      );
    }

    if (activeSection === 'notifications') {
      return (
        <div className="settings-panel-card">
          <h2>Notification Settings</h2>
          <label className="settings-row"><span><strong>Session reminders</strong><small>Notify before upcoming sessions.</small></span><input type="checkbox" checked={draft.notifications} onChange={(event) => { const nextDraft = { ...draft, notifications: event.target.checked }; setDraft(nextDraft); applyUserSettings(nextDraft); }} /></label>
          <label className="settings-row"><span><strong>Login alerts</strong><small>Email when a new device logs in.</small></span><input type="checkbox" checked={draft.loginAlerts} onChange={(event) => setDraftField('loginAlerts', event.target.checked)} /></label>
          <label className="settings-row"><span><strong>Product updates</strong><small>Occasional Know-how announcements.</small></span><input type="checkbox" checked={draft.marketingEmails} onChange={(event) => setDraftField('marketingEmails', event.target.checked)} /></label>
        </div>
      );
    }

    if (activeSection === 'privacy') {
      return (
        <div className="settings-panel-card">
          <h2>Privacy Settings</h2>
          <label className="settings-row"><span><strong>Public profile</strong><small>Allow learners and teachers to view your profile.</small></span><input type="checkbox" checked={draft.publicProfile} onChange={(event) => updatePrivacy('publicProfile', event.target.checked)} /></label>
          <label className="settings-row"><span><strong>Show region</strong><small>Display your region in search and profile preview.</small></span><input type="checkbox" checked={draft.showRegion} onChange={(event) => updatePrivacy('showRegion', event.target.checked)} /></label>
          <label className="settings-row"><span><strong>Allow direct messages</strong><small>Let matched users message you.</small></span><input type="checkbox" checked={draft.allowMessages} onChange={(event) => setDraftField('allowMessages', event.target.checked)} /></label>
        </div>
      );
    }

    if (activeSection === 'billing') {
      const invoices = [
        { date: '2026-06-01', title: 'Monthly subscription', amount: subscriptionPlan === 'Premium' ? '$6.99 demo' : '$0 demo', status: 'Paid' },
        { date: '2026-05-01', title: 'Lecture access pass', amount: '$9 demo', status: 'Paid' },
      ];
      const primary = paymentMethods[0];
      return (
        <div className="settings-panel-card billing-settings-panel">
          <div className="settings-section-head">
            <div><h2>Payment Info</h2><p>Manage saved payment methods, invoices, credit balance, and lecture purchases.</p></div>
            <button className="ghost" type="button" onClick={() => setSettingsNotice('Payment details refreshed.')}>Refresh</button>
          </div>
          <div className="billing-hero-grid">
            <div className="billing-payment-card">
              <span>Your payment method</span>
              {primary ? (
                <>
                  <strong>{primary.brand} •••• {primary.last4}</strong>
                  <small>Expires {primary.expiry} • used for Premium and paid lecture videos</small>
                  <div className="billing-action-row">
                    <button className="ghost" type="button" onClick={() => openEditPayment(0)}>Edit Payment</button>
                    <button className="ghost" type="button" onClick={openAddPayment}>Add Method</button>
                  </div>
                </>
              ) : (
                <>
                  <strong>No payment method</strong>
                  <small>Add a card to subscribe to Premium or buy lecture videos.</small>
                  <div className="billing-action-row">
                    <button className="ghost" type="button" onClick={openAddPayment}>Add Method</button>
                  </div>
                </>
              )}
            </div>
            <div className="billing-plan-card upgraded-billing-card">
              <span>Credit wallet</span>
              <strong>{formatCredits(user.wallet?.current || 0)} Credits</strong>
              <small>{user.wallet?.lectureAccess || 0} video access pass • purchases stay separate from subscription</small>
            </div>
          </div>
          <div className="billing-info-grid">
            <div className="settings-sub-card">
              <div className="settings-section-head small"><h3>Payment Methods</h3><button className="ghost" type="button" onClick={openAddPayment}>Add Method</button></div>
              {paymentMethods.length === 0 ? (
                <div className="settings-row compact-row"><span><small>No payment methods saved yet.</small></span></div>
              ) : paymentMethods.map((method, i) => (
                <div className="settings-row compact-row" key={`${method.brand}-${method.last4}-${i}`}>
                  <span><strong>{method.brand} •••• {method.last4}</strong><small>Expires {method.expiry}{i === 0 ? ' • Primary' : ''}</small></span>
                  <button className="ghost" type="button" onClick={() => openEditPayment(i)}>Edit</button>
                  <button className="ghost" type="button" onClick={() => removePaymentMethod(i)}>Remove</button>
                </div>
              ))}
            </div>
            <div className="settings-sub-card"><div className="settings-section-head small"><h3>Recent Invoices</h3><button className="ghost" type="button" onClick={() => setSettingsNotice('Invoice download started in demo mode.')}>Download</button></div>{invoices.map((invoice) => <div className="settings-row compact-row" key={invoice.date}><span><strong>{invoice.title}</strong><small>{invoice.date}</small></span><span>{invoice.amount}</span><b>{invoice.status}</b></div>)}</div>
          </div>
          {paymentModal && (
            <div className="modal-backdrop" onClick={() => setPaymentModal(null)}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
                <h3>{paymentModal.mode === 'edit' ? 'Edit Payment Method' : 'Add Payment Method'}</h3>
                <label className="field-label">Card brand
                  <select value={paymentModal.draft.brand} onChange={(e) => setPaymentModal({ ...paymentModal, draft: { ...paymentModal.draft, brand: e.target.value } })}>
                    <option>Visa</option><option>Mastercard</option><option>Amex</option><option>Discover</option>
                  </select>
                </label>
                <label className="field-label">Cardholder name
                  <input type="text" value={paymentModal.draft.holder} onChange={(e) => setPaymentModal({ ...paymentModal, draft: { ...paymentModal.draft, holder: e.target.value } })} />
                </label>
                <label className="field-label">Last 4 digits
                  <input type="text" maxLength={4} value={paymentModal.draft.last4} onChange={(e) => setPaymentModal({ ...paymentModal, draft: { ...paymentModal.draft, last4: e.target.value.replace(/\D/g, '').slice(0, 4) } })} placeholder="4242" />
                </label>
                <label className="field-label">Expiry (MM/YY)
                  <input type="text" maxLength={5} value={paymentModal.draft.expiry} onChange={(e) => setPaymentModal({ ...paymentModal, draft: { ...paymentModal.draft, expiry: e.target.value } })} placeholder="12/29" />
                </label>
                <div className="billing-action-row" style={{ marginTop: 12 }}>
                  <button className="ghost" type="button" onClick={() => setPaymentModal(null)}>Cancel</button>
                  <button className="primary" type="button" onClick={savePaymentModal}>{paymentModal.mode === 'edit' ? 'Save' : 'Add'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (activeSection === 'subscription') {
      const plans = [
        { name: 'Free', price: '$0', note: 'Core learning access', perks: ['Community posts and comments', 'Basic messaging', 'Standard daily credit reward', 'Standard XP growth'] },
        { name: 'Premium', price: '$6.99', note: 'For active learners and teachers', perks: ['Remove ads', 'Increase daily credit reward', 'Increase XP gain', 'Priority lecture video access'] },
      ];
      return (
        <div className="settings-panel-card subscription-settings-panel">
          <div className="settings-section-head">
            <div><h2>Subscription</h2><p>Choose between Free and Premium. Premium removes ads and boosts rewards.</p></div>
            <span className="pill muted">Current: {subscriptionPlan}</span>
          </div>
          <div className="subscription-plan-grid">
            {plans.map((plan) => (
              <button key={plan.name} type="button" className={subscriptionPlan === plan.name ? 'subscription-card active' : 'subscription-card'} onClick={() => { setSubscriptionPlan(plan.name); setSettingsNotice(`${plan.name} subscription selected.`); }}>
                <span>{plan.name}</span>
                <strong>{plan.price}</strong>
                <small>{plan.note}</small>
                <ul>{plan.perks.map((perk) => <li key={perk}>✓ {perk}</li>)}</ul>
              </button>
            ))}
          </div>
          <div className="settings-sub-card premium-benefits-card">
            <h3>Premium Benefits</h3>
            <div className="settings-form-grid three">
              <MiniPill title="Ads" text="Removed from app surfaces" />
              <MiniPill title="Daily Credit Reward" text="Higher daily bonus" />
              <MiniPill title="XP Boost" text="Faster level progress" />
            </div>
          </div>
        </div>
      );
    }

    if (activeSection === 'appearance') {
      return (
        <div className="settings-panel-card">
          <h2>Appearance</h2>
          <label className="theme-toggle setting-wide-toggle">
            <span><strong>Dark mode</strong><small>{draft.theme === 'dark' ? 'On' : 'Off'}</small></span>
            <input type="checkbox" role="switch" checked={draft.theme === 'dark'} onChange={(event) => updateTheme(event.target.checked)} aria-label="Toggle dark mode" />
            <i aria-hidden="true"></i>
          </label>
        </div>
      );
    }
    if (activeSection === 'language') {
      return (
        <div className="settings-panel-card">
          <h2>Language</h2>
          <p className="muted-text">Choose your preferred display language.</p>
          <label htmlFor="settings-language">Language</label>
          <select
            id="settings-language"
            value={language}
            onChange={(event) => {
              const next = event.target.value;
              setLanguage(next);
              try { window.localStorage.setItem('knowhow-language', next); } catch (_) {}
              setSettingsNotice(`Translating to ${next}...`);
              import('../lib/translator').then((m) => m.setTranslationLanguage(next)).catch(() => {});
            }}


          >
            <option value="English">English</option>
            <option value="Myanmar">Myanmar (မြန်မာ)</option>
            <option value="Chinese">Chinese (中文)</option>
          </select>
          <p className="muted-text" style={{ marginTop: 12 }}>Current: <strong>{language}</strong></p>
        </div>
      );
    }





    if (activeSection === 'support') {
      return (
        <div className="settings-panel-card">
          <h2>Help and Support</h2>
          <p className="muted-text">Contact customer support for account, credits, videos, or session issues.</p>
          <a className="ghost support-link" href="mailto:support@knowhow.app?subject=Know-how%20support">Contact customer support</a>
          <label htmlFor="settings-feedback">Feedback</label>
          <textarea id="settings-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Write your issue or suggestion..." />
          <button className="primary" type="button" onClick={sendFeedback}>Send Message</button>
        </div>
      );
    }

    return (
      <div className="settings-panel-card">
        <h2>About Know-how</h2>
        <p className="muted-text">Know-how is a learning network for skill exchange, teacher sessions, community posts, credit wallets, and lecture videos.</p>
        <div className="settings-form-grid two">
          <MiniPill title="Version" text="MVP demo build" />
          <MiniPill title="Account" text={user.email || 'Signed in'} />
        </div>
      </div>
    );
  }

  return (
    <section className="settings-desktop-page">
      <div className="settings-window card">
        <div className="settings-quick-actions"><button className="ghost" type="button" onClick={onLogout}>↪ Log Out</button></div>
        <div className="settings-window-body">
          <aside className="settings-left-menu">
            {(filteredSections.length ? filteredSections : sections).map((item) => <button key={item.id} type="button" className={activeSection === item.id ? 'active' : ''} onClick={() => setActiveSection(item.id)}><span>{item.icon}</span>{item.label}</button>)}
          </aside>
          <main className="settings-content-panel">
            {renderSection()}
            {settingsNotice && <p className="settings-notice floating-notice" role="status">{settingsNotice}</p>}
          </main>
        </div>
      </div>
    </section>
  );
}

function CommunityPage({ user, posts = [], setPosts = () => {} }) {
  const categories = ['All', 'Academic', 'Arts', 'Career', 'General', 'Languages', 'Lifestyle', 'Tech'];
  const boards = [
    { id: 'career', name: 'career', title: 'Career & Mentorship', description: 'Resume reviews, interview prep, and mentorship.', category: 'Career', tag: 'career', initial: 'C', gradient: 'linear-gradient(135deg, #6d5dfc, #0891b2)', matches: ['career', 'business'] },
    { id: 'design', name: 'design', title: 'Design', description: 'UI/UX, illustration, and visual feedback.', category: 'Arts', tag: 'arts', initial: 'D', gradient: 'linear-gradient(135deg, #7c3aed, #2563eb)', matches: ['design', 'ui/ux', 'arts'] },
    { id: 'general', name: 'general', title: 'General', description: 'Introductions, platform questions, and casual chat.', category: 'General', tag: 'general', initial: 'G', gradient: 'linear-gradient(135deg, #5b5ce2, #0284c7)', matches: ['general'] },
    { id: 'languages', name: 'languages', title: 'Languages', description: 'Practice partners, learning tips, and resources for any language.', category: 'Languages', tag: 'languages', initial: 'L', gradient: 'linear-gradient(135deg, #6d5dfc, #0ea5e9)', matches: ['japanese', 'english', 'language'] },
    { id: 'music', name: 'music', title: 'Music', description: 'Instruments, theory, production, and jam sessions.', category: 'Arts', tag: 'arts', initial: 'M', gradient: 'linear-gradient(135deg, #7c3aed, #0284c7)', matches: ['music', 'arts'] },
    { id: 'programming', name: 'programming', title: 'Programming', description: 'Code questions, projects, and pair-programming requests.', category: 'Tech', tag: 'tech', initial: 'P', gradient: 'linear-gradient(135deg, #5b5ce2, #0891b2)', matches: ['web development', 'programming', 'tech'] },
    { id: 'study-help', name: 'study-help', title: 'Study Help', description: 'Study plans, accountability, and help with tricky topics.', category: 'Academic', tag: 'academic', initial: 'S', gradient: 'linear-gradient(135deg, #6d5dfc, #2563eb)', matches: ['study', 'academic', 'learning'] },
    { id: 'wellness', name: 'wellness', title: 'Wellness', description: 'Balanced routines, focus, and supportive learning habits.', category: 'Lifestyle', tag: 'lifestyle', initial: 'W', gradient: 'linear-gradient(135deg, #7c3aed, #0e7490)', matches: ['wellness', 'lifestyle'] },
  ];
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeBoard, setActiveBoard] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [postForm, setPostForm] = useState({ community: 'General', title: '', body: '' });
  const [commentDrafts, setCommentDrafts] = useState({});
  const [communityNotice, setCommunityNotice] = useState('');
  const [activeCommentsPostId, setActiveCommentsPostId] = useState(null);
  const reactionStorageKey = `knowhow-community-reactions-${user?.id || user?.username || 'guest'}`;
  const [reactionMap, setReactionMap] = useState(() => loadState(reactionStorageKey, {}));

  const currentAuthor = user?.fullName || user?.username || 'You';
  const normalizedSearch = normalizeText(searchTerm);

  function boardMatchesPost(board, post) {
    if (!board || !post) return false;
    const postText = normalizeText([post.community, post.title, post.body, ...(post.tags || [])].join(' '));
    return board.matches.some((term) => postText.includes(normalizeText(term))) || normalizeText(post.community) === normalizeText(board.title) || normalizeText(post.community) === normalizeText(board.name);
  }

  function boardMatchesSearch(board) {
    if (!normalizedSearch) return true;
    return normalizeText([board.name, board.title, board.description, board.category, board.tag, ...board.matches].join(' ')).includes(normalizedSearch);
  }

  function discussionCount(board) {
    return posts.filter((post) => boardMatchesPost(board, post)).length;
  }

  function postCategory(post) {
    const matchedBoard = boards.find((board) => boardMatchesPost(board, post));
    return matchedBoard?.category || post.category || 'General';
  }

  function postMatchesSearch(post) {
    if (!normalizedSearch) return true;
    return normalizeText([post.community, post.title, post.body, post.author, ...(post.tags || [])].join(' ')).includes(normalizedSearch);
  }

  const visibleBoards = boards.filter((board) => (selectedCategory === 'All' || board.category === selectedCategory) && boardMatchesSearch(board));
  const filteredPosts = posts.filter((post) => {
    const categoryOkay = selectedCategory === 'All' || postCategory(post) === selectedCategory;
    const boardOkay = activeBoard === 'all' || boardMatchesPost(boards.find((board) => board.id === activeBoard), post);
    return categoryOkay && boardOkay && postMatchesSearch(post);
  });
  const activeCommentsPost = posts.find((post) => post.id === activeCommentsPostId) || null;

  function updateReactionMap(nextMap) {
    setReactionMap(nextMap);
    localStorage.setItem(reactionStorageKey, JSON.stringify(nextMap));
  }

  async function createPost(event) {
    event.preventDefault();
    setCommunityNotice('');
    if (!postForm.title.trim() || !postForm.body.trim()) {
      setCommunityNotice('Add a post title and body before publishing.');
      return;
    }
    const selectedBoard = boards.find((board) => board.title === postForm.community || board.category === postForm.community || board.name === normalizeText(postForm.community));
    const communityName = postForm.community || selectedBoard?.title || 'General';
    const draft = {
      community: communityName,
      title: postForm.title.trim(),
      body: postForm.body.trim(),
    };
    try {
      const saved = await apiRequest('/community', { method: 'POST', body: draft });
      const newPost = {
        id: saved?.id || crypto.randomUUID(),
        community: saved?.community || communityName,
        title: saved?.title || draft.title,
        body: saved?.body || draft.body,
        author: currentAuthor,
        authorId: user?.id,
        votes: 0,
        likes: 0,
        dislikes: 0,
        comments: [],
        tags: [communityName, selectedBoard?.category || communityName].filter(Boolean),
        createdAt: saved?.createdAt || new Date().toISOString(),
      };
      setPosts([newPost, ...posts]);
      setPostForm({ community: communityName, title: '', body: '' });
      setActiveBoard('all');
      setShowCreatePost(false);
    } catch (err) {
      setCommunityNotice(err?.message || 'Failed to publish post. Please sign in and try again.');
    }
  }


  function votePost(postId, delta) {
    const current = Number(reactionMap[postId] || 0);
    const nextReaction = current === delta ? 0 : delta;
    const nextMap = { ...reactionMap };
    if (nextReaction === 0) delete nextMap[postId];
    else nextMap[postId] = nextReaction;
    updateReactionMap(nextMap);

    setPosts(posts.map((post) => {
      if (post.id !== postId) return post;
      let votes = Number(post.votes || 0);
      let likes = Number(post.likes || 0);
      let dislikes = Number(post.dislikes || 0);
      if (current === 1) { votes -= 1; likes = Math.max(0, likes - 1); }
      if (current === -1) { votes += 1; dislikes = Math.max(0, dislikes - 1); }
      if (nextReaction === 1) { votes += 1; likes += 1; }
      if (nextReaction === -1) { votes -= 1; dislikes += 1; }
      return { ...post, votes, likes, dislikes };
    }));
  }

  function addComment(postId) {
    const body = String(commentDrafts[postId] || '').trim();
    if (!body) return;
    setPosts(posts.map((post) => {
      if (post.id !== postId) return post;
      return {
        ...post,
        comments: [
          ...(post.comments || []),
          { id: crypto.randomUUID(), author: currentAuthor, body, createdAt: new Date().toISOString() },
        ],
      };
    }));
    setCommentDrafts({ ...commentDrafts, [postId]: '' });
  }

  function renderComment(comment, index) {
    if (typeof comment === 'string') return { id: `legacy-${index}`, author: 'Community member', body: comment };
    return { id: comment.id || `comment-${index}`, author: comment.author || comment.userName || 'Community member', body: comment.body || '' };
  }

  return (
    <section className="community-directory community-rework">
      <header className="community-directory-header community-feed-header">
        <div>
          <h2>Community</h2>
          
        </div>
        
      </header>

      <div className="community-top-search card">
        <label className="community-search-box" aria-label="Search community">
          <span>⌕</span>
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search community posts, boards, teachers, or keywords..." />
        </label>
        <button className="community-plus-button" type="button" onClick={() => { setCommunityNotice(''); setShowCreatePost(true); }} aria-label="Create community post">+</button>
      </div>

      <div className="community-category-tabs" aria-label="Community categories">
        {categories.map((category) => <button type="button" key={category} className={selectedCategory === category ? 'active' : ''} onClick={() => { setSelectedCategory(category); setActiveBoard('all'); }}>{category === 'All' ? 'All' : `# ${category.toLowerCase()}`}</button>)}
      </div>


      <div className="community-feed-list">
        {filteredPosts.length === 0 && <div className="card"><p className="muted-text">No posts match this search or filter yet.</p></div>}
        {filteredPosts.map((post) => {
          const normalizedComments = (post.comments || []).map(renderComment);
          const currentReaction = Number(reactionMap[post.id] || 0);
          return (
            <article className="card community-post-card compact-community-post" key={post.id}>
              <div className="community-post-content compact-post-content">
                <div className="post-meta"><span>k/{post.community}</span><span>Posted by {post.author || 'Community member'}</span></div>
                <h3>{post.title}</h3>
                <p>{post.body}</p>
                <div className="community-post-actions post-react-actions">
                  <button type="button" className={currentReaction === 1 ? 'active' : ''} aria-label="Like post" onClick={() => votePost(post.id, 1)}>👍 <strong>{post.likes || 0}</strong></button>
                  <button type="button" className={currentReaction === -1 ? 'active' : ''} aria-label="Dislike post" onClick={() => votePost(post.id, -1)}>👎 <strong>{post.dislikes || 0}</strong></button>
                  <button type="button" aria-label="Open comments" onClick={() => setActiveCommentsPostId(post.id)}>💬 <strong>{normalizedComments.length}</strong></button>
                  <span className="post-score-chip">Score {post.votes || 0}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {showCreatePost && (
        <div className="modal-backdrop high-modal-backdrop">
          <form className="modal card community-create-modal" onSubmit={createPost}>
            <div className="section-title"><h3>Create Post</h3><button className="ghost" type="button" onClick={() => setShowCreatePost(false)}>Close</button></div>
            <div className="form-grid two">
              <div><label>Community / Board</label><select value={postForm.community} onChange={(event) => setPostForm({ ...postForm, community: event.target.value })}>{boards.map((board) => <option key={board.id} value={board.title}>{board.title}</option>)}</select></div>
              <div><label>Title</label><input value={postForm.title} onChange={(event) => setPostForm({ ...postForm, title: event.target.value })} placeholder="Ask a question or share an update" /></div>
            </div>
            <label>Body</label>
            <textarea value={postForm.body} onChange={(event) => setPostForm({ ...postForm, body: event.target.value })} placeholder="Write your post here..." />
            {communityNotice && <p className="error-text">{communityNotice}</p>}
            <div className="modal-actions"><button className="ghost" type="button" onClick={() => setShowCreatePost(false)}>Cancel</button><button className="primary" type="submit">Publish Post</button></div>
          </form>
        </div>
      )}

      {activeCommentsPost && (
        <div className="modal-backdrop high-modal-backdrop">
          <div className="modal card community-comments-modal">
            <div className="section-title"><div><h3>{activeCommentsPost.title}</h3><p className="muted-text">Read and write comments without opening a large page.</p></div><button className="ghost" type="button" onClick={() => setActiveCommentsPostId(null)}>Close</button></div>
            <div className="comment-thread-modal">
              {(activeCommentsPost.comments || []).map(renderComment).length === 0 && <p className="muted-text">No comments yet. Start the conversation.</p>}
              {(activeCommentsPost.comments || []).map(renderComment).map((comment) => <p key={comment.id}><strong>{comment.author}:</strong> {comment.body}</p>)}
            </div>
            <div className="comment-box modal-comment-box">
              <textarea value={commentDrafts[activeCommentsPost.id] || ''} onChange={(event) => setCommentDrafts({ ...commentDrafts, [activeCommentsPost.id]: event.target.value })} placeholder="Write a comment..." />
              <button className="primary" type="button" onClick={() => addComment(activeCommentsPost.id)}>Comment</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}


function VideoPanelPage({ user, setUser }) {
  const [videoSearch, setVideoSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeVideo, setActiveVideo] = useState(null);
  const [pendingVideo, setPendingVideo] = useState(null);
  const [videoAd, setVideoAd] = useState(null);

  const [videoNotice, setVideoNotice] = useState('');
  const [view, setView] = useState('browse');
  const [uploadedVideos, setUploadedVideos] = useState([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoSaving, setVideoSaving] = useState('');
  const [uploadSaving, setUploadSaving] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ title: '', description: '', category: 'Design', level: 'Beginner', durationLabel: '15 min', priceCredits: 0, videoUrl: '', file: null });
  const isTeacher = canUserTeach(user);
  const ownedKey = `knowhow:ownedVideos:${user.id || 'guest'}`;
  const [ownedVideoIds, setOwnedVideoIds] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`knowhow:ownedVideos:${user.id || 'guest'}`) || '[]');
      return Array.from(new Set([...(Array.isArray(user.purchasedVideos) ? user.purchasedVideos : []), ...(Array.isArray(stored) ? stored : [])]));
    } catch {
      return Array.isArray(user.purchasedVideos) ? user.purchasedVideos : [];
    }
  });
  const purchasedVideos = ownedVideoIds;

  async function signedVideoUrl(storagePath) {
    if (!storagePath) return '';
    const { data, error } = await supabase.storage.from('lecture-videos').createSignedUrl(storagePath, 60 * 60);
    if (error) throw error;
    return data?.signedUrl || '';
  }

  function lectureRowToCard(row, videoUrl = '') {
    return {
      id: row.id,
      ownerId: row.owner_id,
      title: row.title,
      description: row.description || 'Teacher-uploaded lecture.',
      category: row.category || 'Other',
      level: row.level || 'Beginner',
      duration: row.duration_label || '—',
      priceCredits: Number(row.price_credits || 0),
      teacher: row.teacher_name || 'Teacher',
      videoUrl: videoUrl || row.external_url || '',
      poster: row.poster_url || '',
      badge: row.badge || (Number(row.price_credits || 0) > 0 ? 'Premium' : 'Free'),
      storagePath: row.storage_path || '',
      isUploaded: true,
    };
  }

  function mergeOwnedIds(...groups) {
    return Array.from(new Set(groups.flat().filter(Boolean).map(String)));
  }

  useEffect(() => {
    let cancelled = false;
    const localOwned = (() => {
      try {
        const stored = JSON.parse(localStorage.getItem(ownedKey) || '[]');
        return Array.isArray(stored) ? stored : [];
      } catch {
        return [];
      }
    })();
    const sessionOwned = Array.isArray(user.purchasedVideos) ? user.purchasedVideos : [];
    const startingOwned = mergeOwnedIds(sessionOwned, localOwned);
    setOwnedVideoIds(startingOwned);

    async function loadOwnerships() {
      if (!user.id || user.id === 'guest') return;
      try {
        const { data, error } = await supabase
          .from('video_ownerships')
          .select('video_id')
          .eq('user_id', user.id);
        if (error) throw error;
        const cloudOwned = (data || []).map((row) => row.video_id);
        const merged = mergeOwnedIds(startingOwned, cloudOwned);
        const missingCloudRows = merged
          .filter((videoId) => !cloudOwned.includes(videoId))
          .map((videoId) => ({ user_id: user.id, video_id: videoId, source: 'claimed' }));
        if (missingCloudRows.length) {
          await supabase.from('video_ownerships').upsert(missingCloudRows, { onConflict: 'user_id,video_id' });
        }
        if (cancelled) return;
        setOwnedVideoIds(merged);
        setUser((current) => ({ ...current, purchasedVideos: merged }));
        localStorage.setItem(ownedKey, JSON.stringify(merged));
      } catch (error) {
        console.warn('Could not load video ownerships', error);
      }
    }

    loadOwnerships();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  useEffect(() => {
    try { localStorage.setItem(ownedKey, JSON.stringify(purchasedVideos)); } catch {}
    if (Array.isArray(user.purchasedVideos) && user.purchasedVideos.join(',') === purchasedVideos.join(',')) return;
    setUser((current) => ({ ...current, purchasedVideos }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedKey, purchasedVideos.join(',')]);

  useEffect(() => {
    let cancelled = false;
    async function loadUploadedVideos() {
      if (!user.id) return;
      setVideoLoading(true);
      try {
        const { data, error } = await supabase
          .from('lecture_videos')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        const mapped = await Promise.all((data || []).map(async (row) => {
          let videoUrl = row.external_url || '';
          if (row.storage_path) {
            try { videoUrl = await signedVideoUrl(row.storage_path); }
            catch (signedError) { console.warn('Could not sign video URL', signedError); }
          }
          return lectureRowToCard(row, videoUrl);
        }));
        if (!cancelled) setUploadedVideos(mapped);
      } catch (error) {
        console.warn('Could not load uploaded videos', error);
        if (!cancelled) setVideoNotice(`Could not load uploaded videos: ${error.message || error}`);
      } finally {
        if (!cancelled) setVideoLoading(false);
      }
    }
    loadUploadedVideos();
    return () => { cancelled = true; };
  }, [user.id]);

  const allVideos = [...uploadedVideos, ...LECTURE_VIDEOS];
  const categories = ['All', ...Array.from(new Set(allVideos.map((video) => video.category)))];
  const normalizedSearch = normalizeText(videoSearch);
  const baseList = view === 'owned' ? allVideos.filter((video) => purchasedVideos.includes(video.id)) : allVideos;
  const filteredVideos = baseList.filter((video) => {
    const categoryOkay = selectedCategory === 'All' || video.category === selectedCategory;
    const searchOkay = !normalizedSearch || normalizeText([video.title, video.teacher, video.category, video.level, video.description].join(' ')).includes(normalizedSearch);
    return categoryOkay && searchOkay;
  });

  function isOwned(video) {
    return purchasedVideos.includes(video.id);
  }

  function openVideoWithAd(video) {
    setPendingVideo(video);
    setVideoAd(pickRandomAd());
  }

  async function saveVideoOwnership(videoId, source = 'claimed') {
    if (!user.id) throw new Error('Please sign in before saving videos.');
    const nextOwned = mergeOwnedIds(purchasedVideos, [videoId]);
    setOwnedVideoIds(nextOwned);
    setUser((current) => ({ ...current, purchasedVideos: mergeOwnedIds(current.purchasedVideos || [], [videoId]) }));
    localStorage.setItem(ownedKey, JSON.stringify(nextOwned));
    const { error } = await supabase
      .from('video_ownerships')
      .upsert({ user_id: user.id, video_id: String(videoId), source }, { onConflict: 'user_id,video_id' });
    if (error) throw error;
    return nextOwned;
  }

  async function claimOrBuy(video) {
    setVideoNotice('');
    if (isOwned(video)) {
      openVideoWithAd(video);
      return;
    }
    if (!user.id) {
      setVideoNotice('Please sign in before claiming videos.');
      return;
    }

    const currentCredits = Number(user.wallet?.current || 0);
    const priceCredits = Number(video.priceCredits || 0);
    if (priceCredits > 0 && currentCredits < priceCredits) {
      setVideoNotice(`You need ${formatCredits(priceCredits)} credits to unlock this lecture.`);
      return;
    }
    setVideoSaving(video.id);
    try {
      const nextCurrent = priceCredits > 0 ? Number((currentCredits - priceCredits).toFixed(2)) : currentCredits;
      const nextSpent = priceCredits > 0 ? Number((Number(user.wallet?.spent || 0) + priceCredits).toFixed(2)) : Number(user.wallet?.spent || 0);
      const nextLectureAccess = Number(user.wallet?.lectureAccess || 0) + 1;
      const { error: walletError } = await supabase
        .from('wallets')
        .update({
          current_credits: nextCurrent,
          spent_credits: nextSpent,
          lecture_access: nextLectureAccess,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
      if (walletError) throw walletError;
      if (priceCredits > 0) {
        await supabase.from('credit_transactions').insert({
          user_id: user.id,
          amount: -priceCredits,
          type: 'spent',
          description: `Video unlock: ${video.title}`,
          balance_after: nextCurrent,
        });
      }
      await saveVideoOwnership(video.id, priceCredits > 0 ? 'purchased' : 'claimed');
      setUser((current) => ({
        ...current,
        purchasedVideos: mergeOwnedIds(current.purchasedVideos || [], [video.id]),
        wallet: normalizeWallet({ ...current.wallet, current: nextCurrent, spent: nextSpent, lectureAccess: nextLectureAccess }),
      }));
      setVideoNotice(`${video.title} added to your Own Videos.`);
    } catch (error) {
      setVideoNotice(`Could not save video ownership: ${error.message || error}`);
    } finally {
      setVideoSaving('');
    }
  }

  async function submitUpload(event) {
    event.preventDefault();
    if (!isTeacher) return;
    if (!user.id) { setVideoNotice('Please sign in before uploading videos.'); return; }
    if (!uploadForm.title.trim()) { setVideoNotice('Please enter a title for your video.'); return; }
    if (!uploadForm.file && !uploadForm.videoUrl.trim()) { setVideoNotice('Please upload a video file.'); return; }
    setUploadSaving(true);
    setVideoNotice('');
    let storagePath = '';
    try {
      let videoUrl = uploadForm.videoUrl.trim();
      if (uploadForm.file) {
        const extension = (uploadForm.file.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
        const safeTitle = uploadForm.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'lecture-video';
        storagePath = `${user.id}/${Date.now()}-${safeTitle}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('lecture-videos')
          .upload(storagePath, uploadForm.file, {
            cacheControl: '3600',
            upsert: false,
            contentType: uploadForm.file.type || 'video/mp4',
          });
        if (uploadError) throw uploadError;
        videoUrl = await signedVideoUrl(storagePath);
      }
      if (!videoUrl) { setVideoNotice('Please upload a playable video file.'); return; }
      const priceCredits = Number(uploadForm.priceCredits) || 0;
      const { data: row, error: insertError } = await supabase
        .from('lecture_videos')
        .insert({
          owner_id: user.id,
          title: uploadForm.title.trim(),
          description: uploadForm.description.trim() || 'Teacher-uploaded lecture.',
          category: uploadForm.category,
          level: uploadForm.level,
          duration_label: uploadForm.durationLabel || '—',
          price_credits: priceCredits,
          teacher_name: user.fullName || 'Teacher',
          storage_path: storagePath || null,
          external_url: storagePath ? null : videoUrl,
          poster_url: null,
          badge: priceCredits > 0 ? 'Premium' : 'Free',
        })
        .select('*')
        .maybeSingle();
      if (insertError) throw insertError;
      const newVideo = lectureRowToCard(row, videoUrl);
      await saveVideoOwnership(newVideo.id, 'uploaded');
      setUploadedVideos((prev) => [newVideo, ...prev.filter((item) => item.id !== newVideo.id)]);
      setShowUpload(false);
      setUploadForm({ title: '', description: '', category: 'Design', level: 'Beginner', durationLabel: '15 min', priceCredits: 0, videoUrl: '', file: null });
      setVideoNotice(`"${newVideo.title}" uploaded successfully and saved to Own Videos.`);
      setView('owned');
    } catch (error) {
      if (storagePath) {
        supabase.storage.from('lecture-videos').remove([storagePath]).catch(() => {});
      }
      setVideoNotice(`Could not upload video: ${error.message || error}`);
    } finally {
      setUploadSaving(false);
    }
  }

  return (
    <section className="video-panel-page">
      <header className="community-directory-header community-feed-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2>Video</h2>
        </div>
        {isTeacher && (
          <button type="button" className="primary" onClick={() => setShowUpload(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden>⬆</span> Upload Video
          </button>
        )}
      </header>
      <div className="video-toolbar card">
        <div className="community-category-tabs video-tabs" style={{ marginBottom: 8 }}>
          <button className={view === 'browse' ? 'active' : ''} type="button" onClick={() => setView('browse')}>Browse</button>
          <button className={view === 'owned' ? 'active' : ''} type="button" onClick={() => setView('owned')}>Own Videos ({purchasedVideos.length})</button>
        </div>
        <label className="community-search-box"><span>⌕</span><input value={videoSearch} onChange={(event) => setVideoSearch(event.target.value)} placeholder="Search lecture videos..." /></label>
        <div className="community-category-tabs video-tabs">{categories.map((category) => <button key={category} className={selectedCategory === category ? 'active' : ''} type="button" onClick={() => setSelectedCategory(category)}>{category}</button>)}</div>
      </div>
      {videoLoading && <div className="notice compact-notice">Loading saved videos...</div>}
      {videoNotice && <div className="notice compact-notice">{videoNotice}</div>}
      {view === 'owned' && filteredVideos.length === 0 && (
        <div className="card" style={{ padding: 20, textAlign: 'center' }}><p className="muted-text">You haven't claimed any videos yet. Browse and claim free lectures or purchase premium ones to see them here.</p></div>
      )}
      {showUpload && (
        <div className="modal-backdrop" onClick={() => setShowUpload(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Upload Video</h3>
              <button type="button" className="ghost" onClick={() => setShowUpload(false)}>✕</button>
            </header>
            <form onSubmit={submitUpload} style={{ display: 'grid', gap: 10 }}>
              <label>Title<input required value={uploadForm.title} onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })} placeholder="e.g. Intro to UI Design" /></label>
              <label>Description<textarea rows={3} value={uploadForm.description} onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })} placeholder="What will learners take away?" /></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label>Category<select value={uploadForm.category} onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}>{['Design','Language','Programming','Creative','Business','Other'].map(c => <option key={c}>{c}</option>)}</select></label>
                <label>Level<select value={uploadForm.level} onChange={(e) => setUploadForm({ ...uploadForm, level: e.target.value })}>{['Beginner','Intermediate','Advanced','N5','N4'].map(c => <option key={c}>{c}</option>)}</select></label>
              </div>
              <label>Video file<input type="file" accept="video/*" onChange={(e) => {
                const file = e.target.files?.[0] || null;
                if (!file) { setUploadForm((prev) => ({ ...prev, file: null })); return; }
                const url = URL.createObjectURL(file);
                const probe = document.createElement('video');
                probe.preload = 'metadata';
                probe.src = url;
                probe.onloadedmetadata = () => {
                  const seconds = Math.max(1, Math.round(probe.duration || 0));
                  const minutes = Math.max(1, Math.ceil(seconds / 60));
                  const credits = Math.max(1, Math.ceil(minutes / 30));
                  const label = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
                  setUploadForm((prev) => ({ ...prev, file, durationLabel: label, priceCredits: credits }));
                  URL.revokeObjectURL(url);
                };
                probe.onerror = () => {
                  setUploadForm((prev) => ({ ...prev, file, durationLabel: '—', priceCredits: 1 }));
                  URL.revokeObjectURL(url);
                };
              }} /></label>
              {uploadForm.file && (
                <p className="muted-text" style={{ margin: 0 }}>Detected duration: <strong>{uploadForm.durationLabel}</strong> • Auto price: <strong>{uploadForm.priceCredits} credit{uploadForm.priceCredits === 1 ? '' : 's'}</strong> (1 credit per 30 min)</p>

              )}
              
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" className="ghost" onClick={() => setShowUpload(false)} disabled={uploadSaving}>Cancel</button>
                <button type="submit" className="primary" disabled={uploadSaving}>{uploadSaving ? 'Publishing...' : 'Publish'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="video-grid">
        {filteredVideos.map((video) => {
          const owned = isOwned(video);
          const isFree = video.priceCredits === 0;
          let label;
          if (owned) label = 'Watch';
          else if (isFree) label = 'Claim';
          else label = 'Buy';
          return (

            <article className="card video-card" key={video.id}>
              <div className="video-thumb" style={video.poster ? { backgroundImage: `url(${video.poster})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}><span>▶</span><b>{owned ? 'Owned' : video.badge}</b></div>
              <div className="video-card-body">
                <div className="post-meta"><span>{video.category}</span><span>{video.duration}</span><span>{video.level}</span></div>
                <h3>{video.title}</h3>
                <p>{video.description}</p>
                <MiniPill title="Teacher" text={video.teacher} />
                <div className="video-card-actions">
                  <strong>{isFree ? 'Free' : `${formatCredits(video.priceCredits)} credits`}</strong>
                  <button className="primary" type="button" onClick={() => claimOrBuy(video)} disabled={videoSaving === video.id}>{videoSaving === video.id ? 'Saving...' : label}</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {activeVideo && (
        <div className="modal-backdrop high-modal-backdrop">
          <div className="modal card video-watch-modal">
            <div className="section-title"><h3>{activeVideo.title}</h3><button className="ghost" type="button" onClick={() => setActiveVideo(null)}>Close</button></div>
            {activeVideo.videoUrl ? (
              <video
                key={activeVideo.id}
                className="video-player-frame"
                poster={activeVideo.poster}
                controls
                autoPlay
                playsInline
                preload="metadata"
                style={{ width: '100%', maxHeight: '70vh', aspectRatio: '16/9', borderRadius: 12, background: '#000', display: 'block' }}
                onError={(e) => { console.warn('video error', activeVideo.videoUrl, e?.currentTarget?.error); }}
              >
                <source src={activeVideo.videoUrl} />
                Your browser cannot play this video. <a href={activeVideo.videoUrl} target="_blank" rel="noreferrer">Open in new tab</a>
              </video>
            ) : (
              <div className="video-player-placeholder"><span>▶</span><strong>Lecture video preview</strong><small>{activeVideo.duration} • Teacher: {activeVideo.teacher}</small></div>
            )}
            <p className="muted-text">{activeVideo.duration} • Teacher: {activeVideo.teacher} • {activeVideo.category}</p>
          </div>
        </div>
      )}
      {videoAd && (
        <AdOverlay
          ad={videoAd}
          placement="Before video"
          onClose={() => {
            setVideoAd(null);
            if (pendingVideo) {
              setActiveVideo(pendingVideo);
              setPendingVideo(null);
            }
          }}
        />
      )}

    </section>
  );
}

function AdminShell({ adminAuthed, setAdminAuthed, setAdminMode, sessions, people, transactions, userTheme, teacherApplications, setTeacherApplications, setUser }) {
  function logoutAdmin() {
    localStorage.removeItem('knowhow-admin-token');
    supabase.auth.signOut().catch(() => {});
    setAdminAuthed(false);
    setAdminMode(false);
    window.history.pushState({}, '', '/');
  }
  function loginAdmin(token = 'cloud-admin') {
    localStorage.setItem('knowhow-admin-token', token);
    setAdminAuthed(true);
  }
  return (
    <div className={`app admin-only ${userTheme === 'dark' ? 'dark' : ''}`}>
      <main className="main admin-main">
        {adminAuthed ? <AdminPage sessions={sessions} people={people} transactions={transactions} teacherApplications={teacherApplications} setTeacherApplications={setTeacherApplications} setUser={setUser} onLogout={logoutAdmin} /> : <AdminLoginPage onSuccess={loginAdmin} />}
      </main>
    </div>
  );
}

function AdminLoginPage({ onSuccess }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function login(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    if (!form.email || !form.password) {
      setError('Please enter both your admin email and password.');
      setLoading(false);
      return;
    }
    try {
      const result = await cloudAdminLogin(form.email.trim(), form.password);
      onSuccess(result.token);
    } catch (err) {
      const msg = err?.message || '';
      if (err?.status === 403 || /admin access/i.test(msg)) {
        setError(msg || 'This account exists but does not have admin access.');
      } else if (/invalid login credentials/i.test(msg)) {
        setError('Incorrect email or password. Double-check your admin credentials and try again.');
      } else if (/email not confirmed/i.test(msg)) {
        setError('This email has not been confirmed yet. Please confirm your email before signing in.');
      } else if (/rate|too many/i.test(msg)) {
        setError('Too many sign-in attempts. Please wait a moment and try again.');
      } else {
        setError(msg || 'Unable to sign in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }
  return (
    <section>
      <PageHeader title="Admin Login" subtitle="This is a separate admin-only entry. It does not appear in normal learner/teacher accounts. Open /admin or #admin directly to access it." />
      <form className="card auth-card" onSubmit={login}>
        <h3>Admin Portal</h3>
        <label>Admin Email</label>
        <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="admin@knowhow.test" />
        <label>Password</label>
        <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Admin password" />
        {error && <p className="error-text">{error}</p>}
        <button className="primary full" type="submit" disabled={loading}>{loading ? 'Checking...' : 'Admin Login'}</button>
      </form>
    </section>
  );
}


function AdminPage({ sessions, people, transactions, teacherApplications, setTeacherApplications, setUser, onLogout }) {
  const normalizedApplications = (teacherApplications && teacherApplications.length ? teacherApplications : INITIAL_TEACHER_APPLICATIONS).map((item) => ({
    ...item,
    status: item.status || 'Pending',
    requestedRole: item.requestedRole || 'assistant_teacher',
    teacherLevelClaim: item.teacherLevelClaim || item.level || 'Not provided',
  }));
  const adminUsers = [
    {
      id: DEFAULT_USER.id || 'admin-u001', fullName: DEFAULT_USER.fullName, username: DEFAULT_USER.username, email: DEFAULT_USER.email, role: DEFAULT_USER.role, status: 'Active', license: DEFAULT_USER.licenseStatus, wallet: DEFAULT_USER.wallet,
      transactions: transactions.slice(0, 4), loan: { outstanding: DEFAULT_USER.wallet.loanOutstanding, limit: LOAN_POLICY.maxOutstanding, due: DEFAULT_USER.wallet.loanDueDate || 'No due date' }, purchases: ['No purchase yet'], languages: DEFAULT_USER.languages, interests: DEFAULT_USER.interests,
    },
    ...people.map((person, index) => ({
      id: person.id,
      fullName: person.fullName,
      username: person.username,
      email: `${person.username}@demo.knowhow`,
      role: index === 0 ? 'Teacher' : 'Learner',
      status: 'Active',
      license: index === 0 ? 'Approved' : 'Not submitted',
      wallet: { current: 3 + index, earned: person.hoursShared / 10, spent: index, loanOutstanding: index === 2 ? 2 : 0, loanDueDate: index === 2 ? '2026-07-05' : '', purchased: index === 3 ? 5 : 0, lectureAccess: index === 1 ? 1 : 0 },
      transactions: transactions.slice(index, index + 3),
      loan: { outstanding: index === 2 ? 2 : 0, limit: LOAN_POLICY.maxOutstanding, due: index === 2 ? '2026-07-05' : 'No active loan' },
      purchases: index === 3 ? ['5 Credit Points'] : index === 1 ? ['Lecture Video Pack'] : ['No purchase yet'],
      languages: person.languages,
      interests: person.interests,
    })),
    ...normalizedApplications
      .filter((app) => !people.some((person) => person.username === app.username) && app.username !== DEFAULT_USER.username)
      .map((app) => ({
        id: app.userId || app.id,
        fullName: app.userName,
        username: app.username,
        email: app.email,
        role: 'Learner / Applicant',
        status: 'Active',
        license: app.status,
        wallet: { current: 3, earned: 0, spent: 0, loanOutstanding: 0, loanDueDate: '', purchased: 0, lectureAccess: 0 },
        transactions: [],
        loan: { outstanding: 0, limit: LOAN_POLICY.maxOutstanding, due: 'No active loan' },
        purchases: ['No purchase yet'],
        languages: [],
        interests: [],
      })),
  ];
  const [selectedUserId, setSelectedUserId] = useState(adminUsers[0]?.id);
  const [selectedApplicationId, setSelectedApplicationId] = useState(normalizedApplications[0]?.id);
  const [applicationModalOpen, setApplicationModalOpen] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [adminNotice, setAdminNotice] = useState('');
  const [reports, setReports] = useState([]);
  const [reportsNotice, setReportsNotice] = useState('');
  const [profileModalUserId, setProfileModalUserId] = useState(null);
  const [removedUserIds, setRemovedUserIds] = useState(() => new Set());
  const [suspendedUserIds, setSuspendedUserIds] = useState(() => new Set());
  const [userActionBusy, setUserActionBusy] = useState(null);
  const profileModalUser = profileModalUserId ? adminUsers.find((item) => item.id === profileModalUserId) : null;

  async function loadReports() {
    try {
      const data = await adminApiRequest('/admin/reports');
      setReports(Array.isArray(data) ? data : []);
      setReportsNotice('');
    } catch (error) {
      setReportsNotice(`Could not load reports: ${error.message}`);
    }
  }

  useEffect(() => { loadReports(); }, []);

  async function updateReportStatus(id, status) {
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await adminApiRequest(`/admin/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status, adminNote: '' }) });
      setReportsNotice(`Report ${status}.`);
      const report = reports.find((r) => r.id === id);
      const reasonText = report?.reason ? `"${report.reason}"` : 'your report';
      if (report?.reporterId) {
        const reporterTitle = status === 'resolved'
          ? 'Your report was resolved'
          : status === 'dismissed'
            ? 'Your report was dismissed'
            : `Your report is now ${status}`;
        const reporterBody = status === 'resolved'
          ? `An admin reviewed and resolved ${reasonText}. Thanks for keeping the community safe.`
          : status === 'dismissed'
            ? `An admin reviewed ${reasonText} and dismissed it after investigation.`
            : `An admin updated the status of ${reasonText} to ${status}.`;
        await notify(report.reporterId, { category: 'report', title: reporterTitle, body: reporterBody });
      }
      if (report?.reportedUserId && report.reportedUserId !== report.reporterId) {
        await notify(report.reportedUserId, {
          category: 'report',
          title: `A report involving you was ${status}`,
          body: `An admin reviewed a report involving your account and marked it as ${status}.`,
        });
      }
      await loadReports();
    } catch (error) {
      setReportsNotice(`Failed to update report: ${error.message}`);
      await loadReports();
    }
  }
  const selectedUser = adminUsers.find((item) => item.id === selectedUserId) || adminUsers[0];
  const selectedApplication = normalizedApplications.find((item) => item.id === selectedApplicationId) || normalizedApplications[0];

  useEffect(() => {
    let active = true;
    async function loadRealApplications() {
      try {
        const backendApplications = await adminApiRequest('/admin/teacher-applications');
        if (!active || !Array.isArray(backendApplications)) return;
        const normalizedBackend = backendApplications.map(normalizeTeacherApplicationFromApi);
        const localOnly = normalizedApplications.filter((item) => item.source !== 'backend' && !normalizedBackend.some((backendItem) => backendItem.id === item.id));
        setTeacherApplications([...normalizedBackend, ...localOnly]);
        if (normalizedBackend[0]) setSelectedApplicationId(normalizedBackend[0].id);
        setAdminNotice('');
      } catch (error) {
        setAdminNotice('Could not load applications from Lovable Cloud. Showing local demo data.');
      }
    }
    loadRealApplications();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reviewApplication(id, status) {
    const actionLabel = status === 'Approved' ? 'Approved' : status === 'Rejected' ? 'Rejected' : 'Needs More Info';
    const reviewedBeforeUpdate = normalizedApplications.find((item) => item.id === id);
    let apiSynced = false;
    if (reviewedBeforeUpdate?.source === 'backend') {
      try {
        const updated = await adminApiRequest(`/admin/teacher-applications/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: statusToApi(actionLabel), adminNote: adminNote || `${actionLabel} by admin` }),
        });
        const normalizedUpdated = normalizeTeacherApplicationFromApi(updated);
        const merged = normalizedApplications.map((item) => item.id === id ? normalizedUpdated : item);
        setTeacherApplications(merged);
        apiSynced = true;
        setAdminNotice(`Backend application ${actionLabel.toLowerCase()} successfully.`);
      } catch (error) {
        setAdminNotice(`Backend review failed, saved local review instead: ${error.message}`);
      }
    }

    if (!apiSynced) {
      const nextApplications = normalizedApplications.map((item) => item.id === id ? {
        ...item,
        status: actionLabel,
        adminNote: adminNote || `${actionLabel} by admin`,
        reviewedAt: new Date().toISOString(),
        reviewTrail: [...(item.reviewTrail || []), { at: new Date().toISOString(), action: actionLabel, by: 'Admin', note: adminNote }],
      } : item);
      setTeacherApplications(nextApplications);
    }

    const reviewed = (apiSynced ? normalizedApplications : normalizedApplications.map((item) => item.id === id ? { ...item, status: actionLabel } : item)).find((item) => item.id === id);
    if ((apiSynced ? actionLabel : reviewed?.status) === 'Approved') {
      setUser((currentUser) => {
        if (!currentUser || (reviewed.userId && currentUser.id !== reviewed.userId && currentUser.username !== reviewed.username)) return currentUser;
        const role = reviewed.requestedRole === 'teacher' ? 'Teacher' : 'Assistant Teacher';
        return {
          ...currentUser,
          role,
          rawRole: reviewed.requestedRole,
          teacherLevel: reviewed.teacherLevelClaim,
          teacherPath: `${role} approved by admin`,
          licenseStatus: reviewed.licenseUrl || reviewed.authorityName ? 'Approved' : 'Approved without license proof',
        };
      });
    }
    setAdminNote('');
  }

  return (
    <section>
      <PageHeader title="Admin Dashboard" subtitle="Real-world admin review: user detail, wallet/loan/purchase audit inside account view, teaching authority applications, proof links, notes, and status trail." action={<button className="danger" onClick={onLogout}>Admin Logout</button>} />
      <div className="stats-grid">
        <StatCard label="Users" value={adminUsers.length} hint="Active demo users" />
        <StatCard label="Sessions" value={sessions.length} hint="Session records" />
        <StatCard label="Transactions" value={transactions.length} hint="Credit movement" />
        <StatCard label="Teacher Reviews" value={normalizedApplications.filter((item) => item.status === 'Pending').length} hint="Pending license checks" />
      </div>
      {adminNotice && <div className="notice">{adminNotice}</div>}
      <div className="card">
        <details className="user-mgmt-dropdown">
          <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', listStyle: 'none' }}>
            <h3 style={{ margin: 0 }}>User Management</h3>
            <span className="muted-text" style={{ fontSize: 13 }}>{adminUsers.filter((p) => !removedUserIds.has(p.id)).length} users ▾</span>
          </summary>
          <div className="list" style={{ marginTop: 12 }}>
          {adminUsers.filter((person) => !removedUserIds.has(person.id)).map((person) => {
            const isSuspended = suspendedUserIds.has(person.id);
            const busy = userActionBusy === person.id;
            return (
              <div className={`skill-row selectable ${selectedUserId === person.id ? 'selected' : ''}`} key={`${person.id}-${person.username}`} onClick={() => setSelectedUserId(person.id)}>
                <div><strong>{person.fullName}</strong><span>@{person.username} • {person.role} • {isSuspended ? 'Suspended' : person.status} • License: {person.license}</span></div>
                <div className="actions inline">
                  <button className="ghost" type="button" onClick={(event) => { event.stopPropagation(); setProfileModalUserId(person.id); }}>View</button>
                  <button className="ghost" type="button" disabled={busy} onClick={async (event) => {
                    event.stopPropagation();
                    setUserActionBusy(person.id);
                    try {
                      await adminApiRequest(`/admin/users/${person.id}/suspend`, { method: 'PATCH', body: JSON.stringify({ suspend: !isSuspended }) });
                      setSuspendedUserIds((prev) => {
                        const next = new Set(prev);
                        if (isSuspended) next.delete(person.id); else next.add(person.id);
                        return next;
                      });
                      setAdminNotice(`${person.fullName} ${isSuspended ? 'reactivated' : 'suspended'}.`);
                    } catch (error) {
                      setAdminNotice(`Suspend failed: ${error.message}`);
                    } finally {
                      setUserActionBusy(null);
                    }
                  }}>{isSuspended ? 'Unsuspend' : 'Suspend'}</button>
                  <button className="danger" type="button" disabled={busy} onClick={async (event) => {
                    event.stopPropagation();
                    if (!window.confirm(`Permanently delete ${person.fullName}? This removes their account and all related data.`)) return;
                    setUserActionBusy(person.id);
                    try {
                      await adminApiRequest(`/admin/users/${person.id}`, { method: 'DELETE' });
                      setRemovedUserIds((prev) => new Set(prev).add(person.id));
                      setAdminNotice(`${person.fullName} deleted.`);
                    } catch (error) {
                      setAdminNotice(`Delete failed: ${error.message}`);
                    } finally {
                      setUserActionBusy(null);
                    }
                  }}>Delete</button>
                </div>
              </div>
            );
          })}
          </div>
        </details>
      </div>


      <div className="card">
        <details className="user-mgmt-dropdown">
          <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', listStyle: 'none' }}>
            <h3 style={{ margin: 0 }}>Teacher / License Review</h3>
            <span className="muted-text" style={{ fontSize: 13 }}>{normalizedApplications.length} application(s) ▾</span>
          </summary>
          <div className="list" style={{ marginTop: 12 }}>
            {normalizedApplications.length === 0 && <p className="muted-text">No teaching applications yet.</p>}
            {normalizedApplications.map((item) => (
              <div className={`skill-row selectable ${selectedApplicationId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => { setSelectedApplicationId(item.id); setApplicationModalOpen(true); }}>
                <div><strong>{item.userName}</strong><span>{item.subject} • {item.requestedRole} • {item.status} • Submitted {String(item.submittedAt || '').slice(0, 10)}</span></div>
                <button className="primary" type="button" onClick={(e) => { e.stopPropagation(); setSelectedApplicationId(item.id); setApplicationModalOpen(true); }}>View</button>
              </div>
            ))}
          </div>
        </details>
      </div>
      {applicationModalOpen && selectedApplication && (
        <div className="modal-backdrop high-modal-backdrop" onClick={() => setApplicationModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="section-title"><h3>Review Detail</h3><StatusBadge status={selectedApplication.status} /></div>
            <div className="profile-head"><Avatar text={getInitials(selectedApplication.userName)} /><div><h2>{selectedApplication.userName}</h2><p>@{selectedApplication.username} • {selectedApplication.email}</p></div></div>
            <p><strong>Subject:</strong> {selectedApplication.subject}</p>
            <p><strong>Requested role:</strong> {selectedApplication.requestedRole}</p>
            <p><strong>Learner level:</strong> {selectedApplication.learnerLevel || 'Not provided'}</p>
            <p><strong>Teacher level claim:</strong> {selectedApplication.teacherLevelClaim}</p>
            <p><strong>Authority:</strong> {selectedApplication.authorityName || 'Not provided'}</p>
            <div className="proof-list">
              <MiniPill title="LinkedIn" text={selectedApplication.linkedInUrl || 'Not provided'} />
              <MiniPill title="CV / Portfolio" text={selectedApplication.cvUrl || 'Not provided'} />
              <MiniPill title="License Proof" text={selectedApplication.licenseUrl || 'Not provided'} />
            </div>
            <label>Admin review note</label>
            <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} placeholder="Write why you approved/rejected or what info is missing." />
            <div className="actions wrap">
              <button className="success" onClick={() => { reviewApplication(selectedApplication.id, 'Approved'); setApplicationModalOpen(false); }}>Accept</button>
              <button className="danger" onClick={() => { reviewApplication(selectedApplication.id, 'Rejected'); setApplicationModalOpen(false); }}>Reject</button>
              <button className="ghost" onClick={() => { reviewApplication(selectedApplication.id, 'Needs More Info'); setApplicationModalOpen(false); }}>Need More Info</button>
              <button className="ghost" onClick={() => setApplicationModalOpen(false)}>Close</button>
            </div>
            <h3>Review Trail</h3>
            <div className="list compact-view">{(selectedApplication.reviewTrail || []).map((trail, index) => <MiniPill key={`${trail.at}-${index}`} title={trail.action} text={`${String(trail.at).slice(0, 16)} • ${trail.by}${trail.note ? ` • ${trail.note}` : ''}`} />)}</div>
          </div>
        </div>
      )}
      <div className="card">
        <details>
          <summary className="section-title" style={{ cursor: 'pointer', listStyle: 'revert' }}><h3 style={{ display: 'inline' }}>User Reports</h3><span className="pill muted">{reports.length} report(s)</span></summary>
          <div style={{ marginTop: 12 }}>
            {reportsNotice && <div className="notice">{reportsNotice}</div>}
            {reports.length === 0 ? (
              <p className="muted-text">No user reports submitted yet.</p>
            ) : (
              <div className="list">
                {reports.map((report) => (
                  <div className="skill-row" key={report.id}>
                    <div>
                      <strong>{report.reportedFullName || report.reportedUsername || 'Unknown user'}</strong>
                      <span>
                        {report.reason} • {String(report.status || 'pending').toUpperCase()} • Submitted {String(report.createdAt || '').slice(0, 16)}
                      </span>
                      <p className="muted-text">{report.details}</p>
                      {report.adminNote && <p className="muted-text"><em>Admin note: {report.adminNote}</em></p>}
                    </div>
                    <div className="actions inline">
                      {String(report.status || 'pending').toLowerCase() === 'pending' ? (
                        <>
                          <button className="success" type="button" onClick={() => updateReportStatus(report.id, 'resolved')}>Mark Resolved</button>
                          <button className="danger" type="button" onClick={() => updateReportStatus(report.id, 'dismissed')}>Dismiss</button>
                        </>
                      ) : (
                        <button className="ghost" type="button" onClick={() => updateReportStatus(report.id, 'pending')}>Reopen</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>

      <div className="card">
        <details>
          <summary className="section-title" style={{ cursor: 'pointer', listStyle: 'revert' }}><h3 style={{ display: 'inline' }}>Session Monitoring</h3><span className="pill muted">{sessions.length} session(s)</span></summary>
          <div className="list" style={{ marginTop: 12 }}>{sessions.map((session) => <SessionMini key={session.id} session={session} />)}</div>
        </details>
      </div>

      {profileModalUser && (
        <div className="modal-backdrop high-modal-backdrop" onClick={() => setProfileModalUserId(null)}>
          <div className="modal card search-profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h3>User Profile</h3>
              <StatusBadge status={profileModalUser.status} />
            </div>
            <div className="profile-head">
              <Avatar text={getInitials(profileModalUser.fullName)} large />
              <div>
                <h2>{profileModalUser.fullName}</h2>
                <p>@{profileModalUser.username} • {profileModalUser.email || 'No email'} • {profileModalUser.role}</p>
              </div>
            </div>
            <div className="pill-wrap left">
              {(profileModalUser.languages || []).map((item) => <span className="pill muted" key={item}>{item}</span>)}
              {(profileModalUser.interests || []).map((item) => <span className="pill" key={item}>{item}</span>)}
            </div>
            <div className="stats-grid mini-stats">
              <StatCard label="Credits" value={profileModalUser.wallet.current} hint="Available" />
              <StatCard label="Loan" value={profileModalUser.loan.outstanding} hint={`Limit ${profileModalUser.loan.limit} • ${profileModalUser.loan.due}`} />
              <StatCard label="Purchased" value={profileModalUser.wallet.purchased} hint="Credit points" />
              <StatCard label="Videos" value={profileModalUser.wallet.lectureAccess} hint="Lecture access" />
            </div>
            <h3>License</h3>
            <p className="muted-text">{profileModalUser.license}</p>
            <h3>Recent Transactions</h3>
            <div className="list">
              {profileModalUser.transactions.length
                ? profileModalUser.transactions.map((item) => <TransactionItem key={`modal-${profileModalUser.id}-${item.id}`} item={item} />)
                : <p className="muted-text">No credit transactions yet.</p>}
            </div>
            <div className="modal-actions">
              <button className="ghost" type="button" onClick={() => setProfileModalUserId(null)}>Close</button>
              <button className="primary" type="button" onClick={() => { setSelectedUserId(profileModalUser.id); setProfileModalUserId(null); }}>Open in Panel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SkillEditor({ skill, onChange }) {
  return (
    <div className="editor-box">
      <input value={skill.name} onChange={(event) => onChange({ ...skill, name: event.target.value })} />
      <select value={skill.category} onChange={(event) => onChange({ ...skill, category: event.target.value })}>
        {CATEGORIES.filter((item) => item !== 'All').map((item) => <option key={item}>{item}</option>)}
      </select>
      <select value={skill.level} onChange={(event) => onChange({ ...skill, level: event.target.value })}>
        {LEVELS.filter((item) => item !== 'All').map((item) => <option key={item}>{item}</option>)}
      </select>
      <textarea value={skill.description} onChange={(event) => onChange({ ...skill, description: event.target.value })} />
    </div>
  );
}

function WantedSkillEditor({ skill, onChange }) {
  return (
    <div className="editor-box">
      <input value={skill.name} onChange={(event) => onChange({ ...skill, name: event.target.value })} />
      <select value={skill.category} onChange={(event) => onChange({ ...skill, category: event.target.value })}>
        {CATEGORIES.filter((item) => item !== 'All').map((item) => <option key={item}>{item}</option>)}
      </select>
      <select value={skill.target} onChange={(event) => onChange({ ...skill, target: event.target.value })}>
        {LEVELS.filter((item) => item !== 'All').map((item) => <option key={item}>{item}</option>)}
      </select>
      <textarea value={skill.goal} onChange={(event) => onChange({ ...skill, goal: event.target.value })} />
    </div>
  );
}

function generateSummary(session) {
  return `Session completed for ${session.topic}. Key points: reviewed core concepts, practiced examples, and agreed next homework. Suggested next step: book another ${getScheduledMinutes(session)}-minute follow-up session and track progress in learning history.`;
}

function PageHeader({ action }) {
  if (!action) return null;
  return <div className="page-header page-header-actions">{action}</div>;
}

function StatCard({ label, value, hint }) {
  return <div className="card stat"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function MiniPill({ title, text }) {
  return <div className="mini-pill"><strong>{title}</strong><span>{text}</span></div>;
}

function PersonCard({ person, user, onView }) {
  const score = calculateMatch(user, person);
  return (
    <div className="person-card selectable" onClick={onView} role={onView ? 'button' : undefined} tabIndex={onView ? 0 : undefined}>
      <Avatar text={person.avatar} />
      <div>
        <strong>{person.fullName}</strong>
        <span>@{person.username} • {person.region}</span>
        <p>{person.bio}</p>
        <div className="pill-wrap left">{(person.interests || []).slice(0, 3).map((interest) => <span className="pill muted" key={interest}>{interest}</span>)}</div>
        <small>{score.total}% fit • ⭐ {person.rating} • {person.hoursShared} hours shared</small>
        {onView && <button className="ghost compact-btn" type="button" onClick={(event) => { event.stopPropagation(); onView(); }}>View Profile</button>}
      </div>
    </div>
  );
}

function SessionMini({ session }) {
  return (
    <div className="session-mini">
      <div>
        <strong>{session.topic}</strong>
        <span>{session.date} • {session.time} • {formatCredits(session.credits)} Credits</span>
      </div>
      <StatusBadge status={session.status} />
    </div>
  );
}

function TransactionItem({ item }) {
  return (
    <div className="transaction">
      <div>
        <strong>{item.title}</strong>
        <span>{item.date} • {item.type}</span>
      </div>
      <b className={item.amount > 0 ? 'positive' : 'negative'}>{item.amount > 0 ? '+' : ''}{item.amount}</b>
    </div>
  );
}

function StatusBadge({ status }) {
  return <span className={`status ${String(status).toLowerCase()}`}>{status}</span>;
}

function Avatar({ text, large }) {
  return <div className={`avatar ${large ? 'large' : ''}`}>{text}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
