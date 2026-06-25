CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.lecture_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'Other',
  level text NOT NULL DEFAULT 'Beginner',
  duration_label text NOT NULL DEFAULT '—',
  price_credits numeric(10,2) NOT NULL DEFAULT 0,
  teacher_name text NOT NULL,
  storage_path text,
  external_url text,
  poster_url text,
  badge text NOT NULL DEFAULT 'Premium',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lecture_videos TO authenticated;
GRANT ALL ON public.lecture_videos TO service_role;

ALTER TABLE public.lecture_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can view lecture videos"
ON public.lecture_videos
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Teachers can add their own lecture videos"
ON public.lecture_videos
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = owner_id
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.raw_role IN ('teacher', 'assistant_teacher', 'community_mentor', 'administrator')
        OR (p.teaching_profile->>'applicationStatus') = 'approved'
        OR (p.teaching_profile->>'licenseStatus') = 'Approved'
      )
  )
);

CREATE POLICY "Teachers can update their own lecture videos"
ON public.lecture_videos
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Teachers can delete their own lecture videos"
ON public.lecture_videos
FOR DELETE
TO authenticated
USING (auth.uid() = owner_id);

CREATE TABLE public.video_ownerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_id text NOT NULL,
  source text NOT NULL DEFAULT 'claimed',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_ownerships TO authenticated;
GRANT ALL ON public.video_ownerships TO service_role;

ALTER TABLE public.video_ownerships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own video ownerships"
ON public.video_ownerships
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can add their own video ownerships"
ON public.video_ownerships
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own video ownerships"
ON public.video_ownerships
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own video ownerships"
ON public.video_ownerships
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER update_lecture_videos_updated_at
BEFORE UPDATE ON public.lecture_videos
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Signed-in users can view lecture video files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'lecture-videos');

CREATE POLICY "Teachers can upload lecture video files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'lecture-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.raw_role IN ('teacher', 'assistant_teacher', 'community_mentor', 'administrator')
        OR (p.teaching_profile->>'applicationStatus') = 'approved'
        OR (p.teaching_profile->>'licenseStatus') = 'Approved'
      )
  )
);

CREATE POLICY "Teachers can update their own lecture video files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'lecture-videos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'lecture-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Teachers can delete their own lecture video files"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'lecture-videos' AND (storage.foldername(name))[1] = auth.uid()::text);