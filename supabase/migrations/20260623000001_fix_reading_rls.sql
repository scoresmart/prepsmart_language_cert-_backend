-- Fix conflicting RLS SELECT policies on reading_part_questions.
-- Two SELECT policies with OR logic caused confusion; replace with one combined policy.

DROP POLICY IF EXISTS "Authenticated users can view reading questions" ON public.reading_part_questions;
DROP POLICY IF EXISTS "Admins and tutors can view all reading questions" ON public.reading_part_questions;

-- Students see active questions; admins/tutors see all (including inactive).
CREATE POLICY "Select reading questions by role"
  ON public.reading_part_questions FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'tutor')
  );
