CREATE OR REPLACE FUNCTION public.sync_approved_teacher_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_role text;
  nice_label text;
  existing_teaching jsonb;
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.requested_role IS DISTINCT FROM NEW.requested_role OR OLD.teacher_level_claim IS DISTINCT FROM NEW.teacher_level_claim) THEN
    next_role := CASE WHEN NEW.requested_role = 'teacher' THEN 'teacher' ELSE COALESCE(NULLIF(NEW.requested_role, ''), 'assistant_teacher') END;
    nice_label := CASE
      WHEN next_role = 'teacher' THEN 'Teacher'
      WHEN next_role = 'assistant_teacher' THEN 'Assistant Teacher'
      ELSE initcap(replace(next_role, '_', ' '))
    END;

    SELECT COALESCE(teaching_profile, '{}'::jsonb)
      INTO existing_teaching
      FROM public.profiles
      WHERE id = NEW.user_id;

    UPDATE public.profiles
       SET raw_role = next_role,
           teaching_profile = COALESCE(existing_teaching, '{}'::jsonb) || jsonb_build_object(
             'level', COALESCE(NULLIF(NEW.teacher_level_claim, ''), nice_label),
             'approvedRole', next_role,
             'applicationStatus', 'approved',
             'licenseStatus', 'Approved',
             'approvedAt', COALESCE(NEW.reviewed_at, now())
           ),
           updated_at = now()
     WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teacher_applications_sync_approved_role ON public.teacher_applications;
CREATE TRIGGER teacher_applications_sync_approved_role
AFTER INSERT OR UPDATE OF status, requested_role, teacher_level_claim, reviewed_at
ON public.teacher_applications
FOR EACH ROW
EXECUTE FUNCTION public.sync_approved_teacher_application();

WITH latest_approved AS (
  SELECT DISTINCT ON (user_id)
    user_id,
    CASE WHEN requested_role = 'teacher' THEN 'teacher' ELSE COALESCE(NULLIF(requested_role, ''), 'assistant_teacher') END AS next_role,
    teacher_level_claim,
    reviewed_at
  FROM public.teacher_applications
  WHERE status = 'approved'
  ORDER BY user_id, COALESCE(reviewed_at, created_at) DESC
)
UPDATE public.profiles p
   SET raw_role = latest_approved.next_role,
       teaching_profile = COALESCE(p.teaching_profile, '{}'::jsonb) || jsonb_build_object(
         'level', COALESCE(NULLIF(latest_approved.teacher_level_claim, ''), CASE WHEN latest_approved.next_role = 'teacher' THEN 'Teacher' ELSE 'Assistant Teacher' END),
         'approvedRole', latest_approved.next_role,
         'applicationStatus', 'approved',
         'licenseStatus', 'Approved',
         'approvedAt', COALESCE(latest_approved.reviewed_at, now())
       ),
       updated_at = now()
  FROM latest_approved
 WHERE p.id = latest_approved.user_id;