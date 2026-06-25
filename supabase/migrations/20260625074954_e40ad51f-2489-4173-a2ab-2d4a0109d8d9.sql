CREATE OR REPLACE FUNCTION public.session_settle_verified(_session_id uuid, _learner_id uuid, _credits numeric)
 RETURNS sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  s public.sessions;
  wlearner public.wallets;
  wteacher public.wallets;
  pay numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO s FROM public.sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF uid <> s.teacher_id AND uid <> _learner_id AND NOT public.has_role(uid,'admin') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _credits IS NULL OR _credits <= 0 THEN RETURN s; END IF;
  IF _learner_id = s.teacher_id THEN RETURN s; END IF;
  SELECT * INTO wlearner FROM public.wallets WHERE user_id = _learner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Learner wallet missing'; END IF;
  SELECT * INTO wteacher FROM public.wallets WHERE user_id = s.teacher_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Teacher wallet missing'; END IF;
  pay := round(LEAST(_credits, wlearner.current_credits)::numeric, 2);
  IF pay <= 0 THEN RETURN s; END IF;
  UPDATE public.wallets SET current_credits = round((current_credits - pay)::numeric, 2),
                            spent_credits = round((spent_credits + pay)::numeric, 2),
                            updated_at = now()
    WHERE user_id = _learner_id RETURNING * INTO wlearner;
  UPDATE public.wallets SET current_credits = round((current_credits + pay)::numeric, 2),
                            earned_credits = round((earned_credits + pay)::numeric, 2),
                            updated_at = now()
    WHERE user_id = s.teacher_id RETURNING * INTO wteacher;
  INSERT INTO public.credit_transactions (user_id, amount, type, description, session_id, balance_after)
    VALUES (_learner_id, -pay, 'spent', 'Session payment (verified minutes)', s.id, wlearner.current_credits),
           (s.teacher_id, pay, 'earned', 'Session earning (verified minutes)', s.id, wteacher.current_credits);
  RETURN s;
END $function$;