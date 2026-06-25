REVOKE EXECUTE ON FUNCTION public.sync_approved_teacher_application() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_approved_teacher_application() TO service_role;