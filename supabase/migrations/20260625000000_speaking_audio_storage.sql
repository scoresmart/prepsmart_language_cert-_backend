-- Public bucket for examiner prompt audio on speaking tasks
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'speaking-audio',
  'speaking-audio',
  true,
  26214400,
  ARRAY[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read speaking audio" ON storage.objects;
CREATE POLICY "Public read speaking audio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'speaking-audio');

DROP POLICY IF EXISTS "Admin upload speaking audio" ON storage.objects;
CREATE POLICY "Admin upload speaking audio"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'speaking-audio'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'::app_role
  );

DROP POLICY IF EXISTS "Admin update speaking audio" ON storage.objects;
CREATE POLICY "Admin update speaking audio"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'speaking-audio'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'::app_role
  )
  WITH CHECK (
    bucket_id = 'speaking-audio'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'::app_role
  );

DROP POLICY IF EXISTS "Admin delete speaking audio" ON storage.objects;
CREATE POLICY "Admin delete speaking audio"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'speaking-audio'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'::app_role
  );
