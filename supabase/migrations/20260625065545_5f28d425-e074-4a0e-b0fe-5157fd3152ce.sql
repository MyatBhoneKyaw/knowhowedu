-- Allow all authenticated users to browse non-completed sessions so learners can discover and join.
CREATE POLICY "sessions browse active to authenticated"
  ON public.sessions
  FOR SELECT
  TO authenticated
  USING (status IS NULL OR lower(status) NOT IN ('completed','cancelled'));