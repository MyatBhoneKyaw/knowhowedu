DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notif insert self or admin') THEN
    CREATE POLICY "notif insert self or admin"
      ON public.notifications FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notif delete own') THEN
    CREATE POLICY "notif delete own"
      ON public.notifications FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;