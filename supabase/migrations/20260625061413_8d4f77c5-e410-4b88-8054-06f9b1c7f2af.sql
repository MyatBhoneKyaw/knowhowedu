
-- Extend profiles with fields from the original User model
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reputation_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_rating numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_completion_rate numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS hours_shared numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'Beginner',
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_id text;

-- Make profiles publicly readable for directory/search (already-restricted columns stay safe; this matches the original public user listing)
DROP POLICY IF EXISTS "Profiles public read" ON public.profiles;
CREATE POLICY "Profiles public read" ON public.profiles FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.profiles TO anon;

-- Extend wallets
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS loan_limit numeric NOT NULL DEFAULT 5;

-- Generic updated_at trigger function already exists as public.touch_updated_at

-- =====================================================================
-- SKILLS OFFERED / WANTED
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.skills_offered (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  experience_level text NOT NULL DEFAULT 'Beginner',
  availability jsonb NOT NULL DEFAULT '{"days":[],"timeSlots":[]}'::jsonb,
  session_duration numeric NOT NULL DEFAULT 1,
  teaching_language text NOT NULL DEFAULT 'English',
  location_mode text NOT NULL DEFAULT 'online',
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.skills_offered TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills_offered TO authenticated;
GRANT ALL ON public.skills_offered TO service_role;
ALTER TABLE public.skills_offered ENABLE ROW LEVEL SECURITY;
CREATE POLICY "skills_offered public read" ON public.skills_offered FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "skills_offered owner insert" ON public.skills_offered FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "skills_offered owner update" ON public.skills_offered FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "skills_offered owner delete" ON public.skills_offered FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_skills_offered_updated BEFORE UPDATE ON public.skills_offered FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.skills_wanted (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  learning_goals text NOT NULL DEFAULT '',
  target_proficiency text NOT NULL DEFAULT 'Beginner',
  preferred_language text NOT NULL DEFAULT 'English',
  availability jsonb NOT NULL DEFAULT '{"days":[],"timeSlots":[]}'::jsonb,
  location_mode text NOT NULL DEFAULT 'online',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.skills_wanted TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills_wanted TO authenticated;
GRANT ALL ON public.skills_wanted TO service_role;
ALTER TABLE public.skills_wanted ENABLE ROW LEVEL SECURITY;
CREATE POLICY "skills_wanted public read" ON public.skills_wanted FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "skills_wanted owner insert" ON public.skills_wanted FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "skills_wanted owner update" ON public.skills_wanted FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "skills_wanted owner delete" ON public.skills_wanted FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_skills_wanted_updated BEFORE UPDATE ON public.skills_wanted FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- SESSIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_topic text NOT NULL,
  skill_category text NOT NULL DEFAULT '',
  teacher_id uuid NOT NULL,
  learner_id uuid,
  requested_by uuid NOT NULL,
  date timestamptz NOT NULL,
  duration_hours numeric NOT NULL,
  room_id text NOT NULL UNIQUE,
  meeting_link text NOT NULL DEFAULT '',
  meeting_provider text NOT NULL DEFAULT 'knowhow_room',
  meeting_space_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  credit_amount numeric NOT NULL,
  credit_rate_per_minute numeric NOT NULL DEFAULT (1.0/60.0),
  teacher_level text NOT NULL DEFAULT '',
  student_limit integer NOT NULL DEFAULT 0,
  seats_available integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  mentor_joined_at timestamptz,
  mentor_left_at timestamptz,
  learner_joined_at timestamptz,
  learner_left_at timestamptz,
  actual_duration_minutes numeric NOT NULL DEFAULT 0,
  verified_duration_minutes numeric NOT NULL DEFAULT 0,
  attendance_verified boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  learning_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions read involved or admin" ON public.sessions FOR SELECT TO authenticated
  USING (auth.uid() = teacher_id OR auth.uid() = learner_id OR auth.uid() = requested_by OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "sessions insert requester" ON public.sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = requested_by);
CREATE POLICY "sessions update involved or admin" ON public.sessions FOR UPDATE TO authenticated
  USING (auth.uid() = teacher_id OR auth.uid() = learner_id OR auth.uid() = requested_by OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.session_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL,
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  duration_minutes numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_attendance TO authenticated;
GRANT ALL ON public.session_attendance TO service_role;
ALTER TABLE public.session_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance read self or admin" ON public.session_attendance FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "attendance insert self" ON public.session_attendance FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "attendance update self" ON public.session_attendance FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- =====================================================================
-- MATCHES
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user uuid NOT NULL,
  to_user uuid NOT NULL,
  skill_offered_id uuid,
  skill_wanted_id uuid,
  action text NOT NULL,
  match_percentage numeric NOT NULL DEFAULT 0,
  compatibility_score numeric NOT NULL DEFAULT 0,
  is_mutual boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(from_user, to_user)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matches read involved" ON public.matches FOR SELECT TO authenticated
  USING (auth.uid() = from_user OR auth.uid() = to_user OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "matches insert self" ON public.matches FOR INSERT TO authenticated WITH CHECK (auth.uid() = from_user);
CREATE POLICY "matches update involved" ON public.matches FOR UPDATE TO authenticated
  USING (auth.uid() = from_user OR auth.uid() = to_user);
CREATE TRIGGER trg_matches_updated BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- MESSAGES
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  recipient_id uuid,
  session_id uuid,
  group_name text,
  message_type text NOT NULL DEFAULT 'private',
  schedule jsonb,
  body text NOT NULL,
  file_url text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivered_at timestamptz,
  read_at timestamptz,
  reaction text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON public.messages (sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_group ON public.messages (group_name, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages read involved or community" ON public.messages FOR SELECT TO authenticated
  USING (
    auth.uid() = sender_id
    OR auth.uid() = recipient_id
    OR message_type = 'community'
    OR public.has_role(auth.uid(),'admin')
  );
CREATE POLICY "messages send as self" ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "messages update involved" ON public.messages FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- =====================================================================
-- COMMUNITY
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  author_id uuid NOT NULL,
  votes integer NOT NULL DEFAULT 0,
  linked_quest_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.community_posts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_posts TO authenticated;
GRANT ALL ON public.community_posts TO service_role;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "posts public read" ON public.community_posts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "posts author insert" ON public.community_posts FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "posts author update" ON public.community_posts FOR UPDATE TO authenticated USING (auth.uid() = author_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "posts author delete" ON public.community_posts FOR DELETE TO authenticated USING (auth.uid() = author_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_posts_updated BEFORE UPDATE ON public.community_posts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL,
  votes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.community_comments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_comments TO authenticated;
GRANT ALL ON public.community_comments TO service_role;
ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments public read" ON public.community_comments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "comments author insert" ON public.community_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments author update" ON public.community_comments FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "comments author delete" ON public.community_comments FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.community_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  value integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id),
  UNIQUE(comment_id, user_id)
);
GRANT SELECT ON public.community_reactions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_reactions TO authenticated;
GRANT ALL ON public.community_reactions TO service_role;
ALTER TABLE public.community_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reactions public read" ON public.community_reactions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "reactions owner write" ON public.community_reactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reactions owner delete" ON public.community_reactions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =====================================================================
-- REVIEWS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  reviewee_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  written_review text NOT NULL DEFAULT '',
  skill_feedback text NOT NULL DEFAULT '',
  communication_feedback text NOT NULL DEFAULT '',
  session_quality_feedback text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, reviewer_id)
);
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews public read" ON public.reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "reviews insert reviewer" ON public.reviews FOR INSERT TO authenticated WITH CHECK (auth.uid() = reviewer_id);

-- =====================================================================
-- WALLET HISTORY / LOANS / PURCHASES
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL,
  description text NOT NULL,
  session_id uuid,
  balance_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tx read own or admin" ON public.credit_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0.1),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  repaid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.loans TO authenticated;
GRANT ALL ON public.loans TO service_role;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "loans read own or admin" ON public.loans FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_loans_updated BEFORE UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_type text NOT NULL,
  title text NOT NULL,
  credits numeric NOT NULL DEFAULT 0,
  amount_paid numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'paid',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchases read own or admin" ON public.purchases FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- =====================================================================
-- VERIFICATION REQUESTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  skill_id uuid,
  method text NOT NULL,
  badge_requested text NOT NULL,
  evidence_url text,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.verification_requests TO authenticated;
GRANT ALL ON public.verification_requests TO service_role;
ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "verif read own or admin" ON public.verification_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "verif insert self" ON public.verification_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "verif update admin" ON public.verification_requests FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_verif_updated BEFORE UPDATE ON public.verification_requests FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- NOTIFICATIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'general',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif read own" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif update own" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- =====================================================================
-- QUESTS / USER_QUESTS / BADGES
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  difficulty text NOT NULL DEFAULT 'small',
  reward_credits numeric NOT NULL CHECK (reward_credits >= 0.1),
  requester_id uuid NOT NULL,
  tutor_id uuid,
  status text NOT NULL DEFAULT 'open',
  linked_post_id uuid,
  solution_note text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.quests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quests TO authenticated;
GRANT ALL ON public.quests TO service_role;
ALTER TABLE public.quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quests public read" ON public.quests FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "quests insert requester" ON public.quests FOR INSERT TO authenticated WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "quests update involved" ON public.quests FOR UPDATE TO authenticated USING (auth.uid() = requester_id OR auth.uid() = tutor_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_quests_updated BEFORE UPDATE ON public.quests FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.user_quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  quest_id uuid NOT NULL REFERENCES public.quests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'accepted',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, quest_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_quests TO authenticated;
GRANT ALL ON public.user_quests TO service_role;
ALTER TABLE public.user_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uquests own" ON public.user_quests FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "uquests insert self" ON public.user_quests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "uquests update self" ON public.user_quests FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  xp_reward integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.badges TO anon, authenticated;
GRANT ALL ON public.badges TO service_role;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "badges public read" ON public.badges FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- WALLET FUNCTIONS (SECURITY DEFINER, callable by signed-in user)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.wallet_take_loan(_amount numeric, _due date)
RETURNS public.wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  w public.wallets;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO w FROM public.wallets WHERE user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet missing'; END IF;
  IF w.loan_outstanding + _amount > w.loan_limit THEN
    RAISE EXCEPTION 'Loan exceeds limit';
  END IF;
  UPDATE public.wallets
     SET current_credits = current_credits + _amount,
         loan_outstanding = loan_outstanding + _amount,
         loan_due_date = COALESCE(loan_due_date, _due),
         updated_at = now()
   WHERE user_id = uid
   RETURNING * INTO w;
  INSERT INTO public.loans (user_id, amount, due_date) VALUES (uid, _amount, _due);
  INSERT INTO public.credit_transactions (user_id, amount, type, description, balance_after)
    VALUES (uid, _amount, 'loan', 'Credit loan', w.current_credits);
  RETURN w;
END $$;
GRANT EXECUTE ON FUNCTION public.wallet_take_loan(numeric, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.wallet_repay_loan(_amount numeric)
RETURNS public.wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  w public.wallets;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO w FROM public.wallets WHERE user_id = uid FOR UPDATE;
  IF w.current_credits < _amount THEN RAISE EXCEPTION 'Insufficient credits'; END IF;
  IF _amount > w.loan_outstanding THEN RAISE EXCEPTION 'Repay exceeds loan'; END IF;
  UPDATE public.wallets
     SET current_credits = current_credits - _amount,
         loan_outstanding = loan_outstanding - _amount,
         loan_due_date = CASE WHEN loan_outstanding - _amount <= 0 THEN NULL ELSE loan_due_date END,
         updated_at = now()
   WHERE user_id = uid RETURNING * INTO w;
  INSERT INTO public.credit_transactions (user_id, amount, type, description, balance_after)
    VALUES (uid, -_amount, 'repayment', 'Loan repayment', w.current_credits);
  RETURN w;
END $$;
GRANT EXECUTE ON FUNCTION public.wallet_repay_loan(numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.wallet_purchase_credits(_credits numeric, _amount numeric, _currency text, _title text)
RETURNS public.wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); w public.wallets;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.wallets
     SET current_credits = current_credits + _credits,
         purchased_credits = purchased_credits + _credits,
         updated_at = now()
   WHERE user_id = uid RETURNING * INTO w;
  INSERT INTO public.purchases (user_id, product_type, title, credits, amount_paid, currency)
    VALUES (uid, 'credit_points', COALESCE(_title,'Credit purchase'), _credits, _amount, COALESCE(_currency,'USD'));
  INSERT INTO public.credit_transactions (user_id, amount, type, description, balance_after)
    VALUES (uid, _credits, 'purchase', COALESCE(_title,'Credit purchase'), w.current_credits);
  RETURN w;
END $$;
GRANT EXECUTE ON FUNCTION public.wallet_purchase_credits(numeric, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wallet_purchase_lecture(_amount numeric, _currency text, _title text)
RETURNS public.wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); w public.wallets;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.wallets
     SET lecture_access = lecture_access + 1,
         updated_at = now()
   WHERE user_id = uid RETURNING * INTO w;
  INSERT INTO public.purchases (user_id, product_type, title, amount_paid, currency)
    VALUES (uid, 'lecture_video', COALESCE(_title,'Lecture purchase'), _amount, COALESCE(_currency,'USD'));
  RETURN w;
END $$;
GRANT EXECUTE ON FUNCTION public.wallet_purchase_lecture(numeric, text, text) TO authenticated;

-- =====================================================================
-- SESSION COMPLETE: transfer credits learner -> teacher atomically
-- =====================================================================
CREATE OR REPLACE FUNCTION public.session_complete(_session_id uuid)
RETURNS public.sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  s public.sessions;
  wlearner public.wallets;
  wteacher public.wallets;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO s FROM public.sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF uid <> s.teacher_id AND uid <> s.learner_id AND NOT public.has_role(uid,'admin') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF s.status = 'completed' THEN RETURN s; END IF;

  IF s.learner_id IS NOT NULL THEN
    SELECT * INTO wlearner FROM public.wallets WHERE user_id = s.learner_id FOR UPDATE;
    SELECT * INTO wteacher FROM public.wallets WHERE user_id = s.teacher_id FOR UPDATE;
    IF wlearner.current_credits < s.credit_amount THEN
      RAISE EXCEPTION 'Learner has insufficient credits';
    END IF;
    UPDATE public.wallets SET current_credits = current_credits - s.credit_amount,
                              spent_credits = spent_credits + s.credit_amount,
                              updated_at = now()
      WHERE user_id = s.learner_id RETURNING * INTO wlearner;
    UPDATE public.wallets SET current_credits = current_credits + s.credit_amount,
                              earned_credits = earned_credits + s.credit_amount,
                              updated_at = now()
      WHERE user_id = s.teacher_id RETURNING * INTO wteacher;
    INSERT INTO public.credit_transactions (user_id, amount, type, description, session_id, balance_after)
      VALUES (s.learner_id, -s.credit_amount, 'spent', 'Session payment', s.id, wlearner.current_credits),
             (s.teacher_id, s.credit_amount, 'earned', 'Session earning', s.id, wteacher.current_credits);
    UPDATE public.profiles SET hours_shared = hours_shared + s.duration_hours WHERE id = s.teacher_id;
  END IF;

  UPDATE public.sessions SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE id = _session_id RETURNING * INTO s;
  RETURN s;
END $$;
GRANT EXECUTE ON FUNCTION public.session_complete(uuid) TO authenticated;

-- =====================================================================
-- SEAT JOIN with capacity check
-- =====================================================================
CREATE OR REPLACE FUNCTION public.session_join_seat(_session_id uuid)
RETURNS public.sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); s public.sessions;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO s FROM public.sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF s.student_limit > 0 AND s.seats_available <= 0 THEN RAISE EXCEPTION 'No seats available'; END IF;
  IF s.learner_id IS NULL THEN
    UPDATE public.sessions SET learner_id = uid,
                               seats_available = GREATEST(seats_available - 1, 0),
                               updated_at = now()
     WHERE id = _session_id RETURNING * INTO s;
  ELSE
    UPDATE public.sessions SET seats_available = GREATEST(seats_available - 1, 0), updated_at = now()
     WHERE id = _session_id RETURNING * INTO s;
  END IF;
  RETURN s;
END $$;
GRANT EXECUTE ON FUNCTION public.session_join_seat(uuid) TO authenticated;
