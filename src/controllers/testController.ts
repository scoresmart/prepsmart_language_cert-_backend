import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';
import { AppRole } from '../types';

function pickRandomId<T extends { id: string }>(rows: T[] | null | undefined): string | null {
  if (!rows?.length) return null;
  return rows[Math.floor(Math.random() * rows.length)].id;
}

async function pickListeningPart(partNumber: number): Promise<string | null> {
  const { data } = await getSupabase()
    .from('listening_part_questions')
    .select('id')
    .eq('part_number', partNumber);
  return pickRandomId(data);
}

async function pickReadingPart(partType: string): Promise<string | null> {
  const { data } = await getSupabase()
    .from('reading_part_questions')
    .select('id')
    .eq('part_type', partType)
    .eq('is_active', true);
  return pickRandomId(data);
}

async function pickWritingTask(taskType: string): Promise<string | null> {
  const { data } = await getSupabase()
    .from('writing_task_questions')
    .select('id')
    .eq('task_type', taskType);
  return pickRandomId(data);
}

// ─── Language Cert Mock Tests ─────────────────────────────────────────────────

// GET /api/v1/tests?page=1&limit=20&include_all=true (admin/tutor only)
export async function getTests(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', include_all } = req.query as Record<string, string>;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;
    const role = req.user?.role as AppRole | undefined;
    const showAll = include_all === 'true' && (role === 'admin' || role === 'tutor');

    let query = getSupabase()
      .from('language_cert_mock_tests')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (!showAll) {
      query = query.eq('is_active', true);
    }

    const { data, error, count } = await query.range(from, to);

    if (error) throw error;
    return res.json({
      success: true,
      data: { tests: data, total: count, page: parseInt(page), totalPages: Math.ceil((count || 0) / parseInt(limit)) },
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/tests/:id  — returns test metadata only
export async function getTestById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data: test, error } = await getSupabase()
      .from('language_cert_mock_tests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !test) return res.status(404).json({ success: false, message: 'Test not found' });
    return res.json({ success: true, data: test });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/tests/:id/structure
// Returns the complete structured mock test for the frontend to render:
// { test, listening: [{part, audio_path, questions}], reading: [{part_type, passage, questions}], writing: [{task_type, question_text}] }
export async function getTestStructure(req: Request, res: Response, next: NextFunction) {
  try {
    const { data: test, error } = await getSupabase()
      .from('language_cert_mock_tests')
      .select('*')
      .eq('id', req.params.id)
      .eq('is_active', true)
      .single();

    if (error || !test) return res.status(404).json({ success: false, message: 'Test not found' });

    const supabase = getSupabase();

    // Listening: Parts 1–4
    const listeningIds = [
      { part: 1, id: test.listening_part1_id },
      { part: 2, id: test.listening_part2_id },
      { part: 3, id: test.listening_part3_id },
      { part: 4, id: test.listening_part4_id },
    ].filter((p) => p.id);

    // Reading: Parts 1A, 1B, 2, 3, 4
    const readingIds = [
      { part_type: 'part1a', id: test.reading_part1a_id },
      { part_type: 'part1b', id: test.reading_part1b_id },
      { part_type: 'part2',  id: test.reading_part2_id },
      { part_type: 'part3',  id: test.reading_part3_id },
      { part_type: 'part4',  id: test.reading_part4_id },
    ].filter((p) => p.id);

    // Writing: Task 1, Task 2
    const writingIds = [
      { task: 1, id: test.writing_task1_id },
      { task: 2, id: test.writing_task2_id },
    ].filter((p) => p.id);

    // Fetch all sections in parallel
    const [listeningData, readingData, writingData] = await Promise.all([
      listeningIds.length
        ? supabase
            .from('listening_part_questions')
            .select('id, part_number, audio_path, questions')
            .in('id', listeningIds.map((p) => p.id))
        : Promise.resolve({ data: [] }),

      readingIds.length
        ? supabase
            .from('reading_part_questions')
            .select('id, part_type, title, passage, image_path, questions, word_bank')
            .in('id', readingIds.map((p) => p.id))
        : Promise.resolve({ data: [] }),

      writingIds.length
        ? supabase
            .from('writing_task_questions')
            .select('id, task_type, question_text, image_path')
            .in('id', writingIds.map((p) => p.id))
        : Promise.resolve({ data: [] }),
    ]);

    // Build ordered structure
    const structure = {
      id: test.id,
      title: test.title,
      description: test.description,
      sections: {
        listening: listeningIds.map((p) => ({
          part: p.part,
          ...((listeningData.data || []).find((q: any) => q.id === p.id) || {}),
        })),
        reading: readingIds.map((p) => ({
          part_type: p.part_type,
          ...((readingData.data || []).find((q: any) => q.id === p.id) || {}),
        })),
        writing: writingIds.map((p) => ({
          task: p.task,
          ...((writingData.data || []).find((q: any) => q.id === p.id) || {}),
        })),
      },
    };

    return res.json({ success: true, data: structure });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/tests/assemble-random  (admin/tutor — pick random question set per section)
export async function assembleRandomMockTest(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      title = `Mock Test ${new Date().toISOString().slice(0, 10)}`,
      description = 'LanguageCert Academic — auto-assembled practice mock test.',
    } = req.body as { title?: string; description?: string };

    const [
      listening_part1_id,
      listening_part2_id,
      listening_part3_id,
      listening_part4_id,
      reading_part1a_id,
      reading_part1b_id,
      reading_part2_id,
      reading_part3_id,
      reading_part4_id,
      writing_task1_id,
      writing_task2_id,
    ] = await Promise.all([
      pickListeningPart(1),
      pickListeningPart(2),
      pickListeningPart(3),
      pickListeningPart(4),
      pickReadingPart('part1a'),
      pickReadingPart('part1b'),
      pickReadingPart('part2'),
      pickReadingPart('part3'),
      pickReadingPart('part4'),
      pickWritingTask('task1'),
      pickWritingTask('task2'),
    ]);

    const assigned = [
      listening_part1_id,
      listening_part2_id,
      listening_part3_id,
      listening_part4_id,
      reading_part1a_id,
      reading_part1b_id,
      reading_part2_id,
      reading_part3_id,
      reading_part4_id,
      writing_task1_id,
      writing_task2_id,
    ].filter(Boolean);

    if (assigned.length === 0) {
      return res.status(422).json({
        success: false,
        message: 'No question sets found in the database. Add listening, reading, and writing questions first.',
      });
    }

    const { data, error } = await getSupabase()
      .from('language_cert_mock_tests')
      .insert({
        title,
        description,
        listening_part1_id,
        listening_part2_id,
        listening_part3_id,
        listening_part4_id,
        reading_part1a_id,
        reading_part1b_id,
        reading_part2_id,
        reading_part3_id,
        reading_part4_id,
        writing_task1_id,
        writing_task2_id,
        is_active: true,
        created_by: req.user!.sub,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      data,
      message: `Mock test created with ${assigned.length}/11 sections assigned.`,
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
