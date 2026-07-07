-- LanguageCert speaking practice sets (one set = full 4-part bundle)
CREATE TABLE IF NOT EXISTS public.speaking_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  level text NOT NULL DEFAULT 'B1',
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  structure jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS speaking_sets_published_idx
  ON public.speaking_sets (is_published, sort_order);

ALTER TABLE public.speaking_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view published speaking sets" ON public.speaking_sets;
CREATE POLICY "Students can view published speaking sets"
  ON public.speaking_sets FOR SELECT
  USING (is_published = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can manage speaking sets" ON public.speaking_sets;
CREATE POLICY "Admins can manage speaking sets"
  ON public.speaking_sets FOR ALL
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin'::app_role, 'tutor'::app_role)
  );
