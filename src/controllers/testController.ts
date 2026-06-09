import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// ─── Language Cert Mock Tests ─────────────────────────────────────────────────

// GET /api/v1/tests?page=1&limit=20
export async function getTests(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;

    const { data, error, count } = await getSupabase()
      .from('language_cert_mock_tests')
      .select('*', { count: 'exact' })
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    return res.json({
      success: true,
      data: { tests: data, total: count, page: parseInt(page), totalPages: Math.ceil((count || 0) / parseInt(limit)) },
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/tests/:id  — returns test with all linked question parts
export async function getTestById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data: test, error } = await getSupabase()
      .from('language_cert_mock_tests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !test) return res.status(404).json({ success: false, message: 'Test not found' });

    // Fetch all linked listening parts
    const listeningIds = [
      test.listening_part1_id, test.listening_part2_id,
      test.listening_part3_id, test.listening_part4_id,
    ].filter(Boolean);

    const writingIds = [test.writing_task1_id, test.writing_task2_id].filter(Boolean);

    const [listeningRes, writingRes] = await Promise.all([
      listeningIds.length
        ? getSupabase().from('listening_part_questions').select('*').in('id', listeningIds)
        : Promise.resolve({ data: [], error: null }),
      writingIds.length
        ? getSupabase().from('writing_task_questions').select('*').in('id', writingIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    return res.json({
      success: true,
      data: {
        test,
        listening_parts: listeningRes.data,
        writing_tasks: writingRes.data,
      },
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/tests  (admin/tutor only)
export async function createTest(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('language_cert_mock_tests')
      .insert({ ...req.body, created_by: req.user!.sub })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PUT /api/v1/tests/:id
export async function updateTest(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('language_cert_mock_tests')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/tests/:id  — soft delete via is_active flag
export async function deleteTest(req: Request, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from('language_cert_mock_tests')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    if (error) throw error;
    return res.json({ success: true, message: 'Test deactivated' });
  } catch (error) {
    next(error);
  }
}

// ─── Practice Attempts ────────────────────────────────────────────────────────

// POST /api/v1/tests/:id/attempt  — record a new attempt
export async function startAttempt(req: Request, res: Response, next: NextFunction) {
  try {
    const { question_type, question_set_id } = req.body;

    const { data, error } = await getSupabase()
      .from('practice_attempts')
      .insert({
        student_id: req.user!.sub,
        question_type,
        question_set_id: question_set_id || req.params.id,
        score: 0,
        total: 0,
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PUT /api/v1/tests/:id/attempt/:attemptId/submit
export async function submitAttempt(req: Request, res: Response, next: NextFunction) {
  try {
    const { score, total, score_details } = req.body;

    const { data, error } = await getSupabase()
      .from('practice_attempts')
      .update({ score, total, score_details })
      .eq('id', req.params.attemptId)
      .eq('student_id', req.user!.sub)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data, message: 'Attempt submitted' });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/tests/:id/attempt/:attemptId/result
export async function getAttemptResult(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('practice_attempts')
      .select('*')
      .eq('id', req.params.attemptId)
      .eq('student_id', req.user!.sub)
      .single();

    if (error || !data) return res.status(404).json({ success: false, message: 'Result not found' });
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/tests/my-attempts
export async function getMyAttempts(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('practice_attempts')
      .select('*')
      .eq('student_id', req.user!.sub)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
