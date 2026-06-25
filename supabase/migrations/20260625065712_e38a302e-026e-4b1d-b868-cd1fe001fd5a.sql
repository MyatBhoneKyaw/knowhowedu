CREATE OR REPLACE FUNCTION public.session_join_seat_v2(_session_id uuid, _user_name text)
RETURNS public.sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.sessions;
  seats jsonb;
  already boolean;
  new_seat jsonb;
  next_summary jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO s FROM public.sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF s.student_limit > 0 AND s.seats_available <= 0 THEN RAISE EXCEPTION 'No seats available'; END IF;

  seats := COALESCE(s.learning_summary->'joinedSeats', '[]'::jsonb);
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(seats) e WHERE e->>'userId' = uid::text) INTO already;
  IF already THEN RAISE EXCEPTION 'Already joined'; END IF;

  new_seat := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'userId', uid::text,
    'userName', COALESCE(_user_name,''),
    'joinedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
  next_summary := COALESCE(s.learning_summary, '{}'::jsonb) || jsonb_build_object('joinedSeats', seats || jsonb_build_array(new_seat));

  UPDATE public.sessions
     SET learner_id = COALESCE(learner_id, uid),
         seats_available = GREATEST(seats_available - 1, 0),
         status = CASE WHEN status = 'Pending' THEN 'Accepted' ELSE status END,
         learning_summary = next_summary,
         updated_at = now()
   WHERE id = _session_id
   RETURNING * INTO s;
  RETURN s;
END $$;

REVOKE EXECUTE ON FUNCTION public.session_join_seat_v2(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_join_seat_v2(uuid, text) TO authenticated, service_role;