-- Ensure admins can insert/update speaking questions (WITH CHECK required for INSERT/UPDATE).
DROP POLICY IF EXISTS "Admins can manage speaking questions" ON public.speaking_part_questions;

CREATE POLICY "Admins can manage speaking questions"
  ON public.speaking_part_questions FOR ALL
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'::app_role
  )
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'::app_role
  );
