import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// ─── Writing Questions ────────────────────────────────────────────────────────

// GET /api/v1/questions/writing?task_type=task1
export async function getWritingQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const { task_type } = req.query;
    let query = getSupabase()
      .from('writing_task_questions')
      .select('id, task_type, question_text, image_path, created_at')
      .order('created_at', { ascending: false });

    if (task_type) query = query.eq('task_type', task_type);

    const { data, error } = await query;
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/questions/writing/:id
export async function getWritingQuestionById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('writing_task_questions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ success: false, message: 'Question not found' });
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/questions/writing
export async function createWritingQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { task_type, question_text, image_path } = req.body;
    const { data, error } = await getSupabase()
      .from('writing_task_questions')
      .insert({ task_type, question_text, image_path, created_by: req.user!.sub })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PUT /api/v1/questions/writing/:id
export async function updateWritingQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { task_type, question_text, image_path } = req.body;
    const { data, error } = await getSupabase()
      .from('writing_task_questions')
      .update({ task_type, question_text, image_path, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/questions/writing/:id
export async function deleteWritingQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from('writing_task_questions')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    return res.json({ success: true, message: 'Writing question deleted' });
  } catch (error) {
    next(error);
  }
}

// ─── Listening Questions ──────────────────────────────────────────────────────

// GET /api/v1/questions/listening?part_number=1&page=1&limit=20
export async function getListeningQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const { part_number, page = '1', limit = '20' } = req.query as Record<string, string>;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;

    let query = getSupabase()
      .from('listening_part_questions')
      .select('*', { count: 'exact' })
      .order('part_number', { ascending: true })
      .range(from, to);

    if (part_number) query = query.eq('part_number', parseInt(part_number));

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      success: true,
      data: {
        questions: data,
        total: count,
        page: parseInt(page),
        totalPages: Math.ceil((count || 0) / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/questions/listening/:id
export async function getListeningQuestionById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('listening_part_questions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ success: false, message: 'Question not found' });
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/questions/listening
export async function createListeningQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { part_number, audio_path, questions } = req.body;
    const { data, error } = await getSupabase()
      .from('listening_part_questions')
      .insert({ part_number, audio_path, questions, created_by: req.user!.sub })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PUT /api/v1/questions/listening/:id
export async function updateListeningQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { part_number, audio_path, questions } = req.body;
    const { data, error } = await getSupabase()
      .from('listening_part_questions')
      .update({ part_number, audio_path, questions, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/questions/listening/:id
export async function deleteListeningQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from('listening_part_questions')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    return res.json({ success: true, message: 'Listening question deleted' });
  } catch (error) {
    next(error);
  }
}
