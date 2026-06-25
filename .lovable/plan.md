## Goal
Recreate the entire Knowhow Express/Mongo backend on Lovable Cloud (Supabase) so the existing frontend keeps working unchanged. The frontend already routes through a single `apiRequest()` dispatcher in `src/knowhow/main.jsx` — I will extend that dispatcher rather than touching any UI.

## Backend inventory (from your upload)
**Models (18):** User, SkillOffered, SkillWanted, Session, Match, Message, CommunityPost, Review, Wallet, CreditTransaction, Loan, Purchase, TeacherApplication, VerificationRequest, Notification, Quest, Badge, GoogleOAuthToken
**Route groups (17):** auth, user, skill, session, match, message, community, review, wallet, quest, gamification, verification, qualification, search, notification, admin, google

## Migration plan

### Phase 1 — Database schema (one migration)
Create the missing Supabase tables, all with RLS + GRANTs, mirroring the Mongo schemas (field names normalized to snake_case, with view/helpers preserving the JSON shapes the frontend expects):
- `skills_offered`, `skills_wanted`
- `sessions` (+ `session_attendance` for the embedded attendance array)
- `matches`
- `messages` (with `attachments jsonb`)
- `community_posts`, `community_comments`, `community_reactions`
- `reviews`
- `credit_transactions`, `loans`, `purchases`
- `verification_requests`
- `notifications`
- `quests`, `user_quests`, `badges`
- Extend `profiles` with the missing scalar fields used by the original `User` model (reputation_score, average_rating, hours_shared, level, is_suspended, etc.)
- Extend `wallets` if any column is missing
- Triggers for `updated_at`, plus a credit-transfer SQL function used by session completion

Already-present tables (`profiles`, `wallets`, `user_roles`, `teacher_applications`) stay as-is.

### Phase 2 — Compatibility API layer (no UI changes)
In `src/knowhow/main.jsx`, expand the existing `apiRequest()` / `adminApiRequest()` dispatcher so every legacy `/auth/*`, `/users/*`, `/skills/*`, `/sessions/*`, `/messages/*`, `/community/*`, `/wallet/*`, `/reviews/*`, `/notifications/*`, `/quests/*`, `/verifications/*`, `/admin/*` path maps to a Supabase query. Each handler returns the exact JSON shape the original Express route produced, so no component code changes.

Real-time (sockets) → Supabase Realtime channels for messages and session presence.

### Phase 3 — Business logic kept server-side
For anything that must be atomic or privileged (credit transfer on session completion, teacher application approval, admin actions, seat join with capacity check), use Postgres functions (`SECURITY DEFINER`) called via RPC from the dispatcher. This preserves the original validation/business rules.

### Phase 4 — Cleanup
- Remove the `localhost:5000` fallback path entirely.
- Keep localStorage only for theme/UI toggles.
- Keep all existing UI, layout, modals, colors, navigation.

## What you'll see change
- **One DB migration** creating ~15 new tables + functions/triggers + RLS/GRANTs.
- **One file edited:** `src/knowhow/main.jsx` — only the `apiRequest` dispatcher and a few Supabase helper functions grow; JSX/UI untouched.
- **No new pages, no removed features.**

## Scope note
This is a large migration (18 models). I'll deliver it in two steps inside this same task:
1. The full migration (schema + RLS + functions) — you approve it.
2. The dispatcher rewrite in `main.jsx` wiring every endpoint to the new tables.

Approve and I'll start with the migration.