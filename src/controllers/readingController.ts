import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/questions/reading?part_type=part1a&page=1&limit=20
export async function getReadingQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const { part_type, page = '1', limit = '20' } = req.query as Record<string, string>;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;

    let query = getSupabase()
      .from('reading_part_questions')
      .select('id, part_type, title, passage, image_path, questions, word_bank, created_at', { count: 'exact' })
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (part_type) query = query.eq('part_type', part_type);

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

// GET /api/v1/questions/reading/:id
export async function getReadingQuestionById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('reading_part_questions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ success: false, message: 'Question not found' });
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/questions/reading
export async function createReadingQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { part_type, title, passage, image_path, questions, word_bank } = req.body;
    const { data, error } = await getSupabase()
      .from('reading_part_questions')
      .insert({ part_type, title, passage, image_path, questions, word_bank, created_by: req.user!.sub })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PUT /api/v1/questions/reading/:id
export async function updateReadingQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { part_type, title, passage, image_path, questions, word_bank } = req.body;
    const { data, error } = await getSupabase()
      .from('reading_part_questions')
      .update({ part_type, title, passage, image_path, questions, word_bank, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/questions/reading/:id
export async function deleteReadingQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from('reading_part_questions')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    if (error) throw error;
    return res.json({ success: true, message: 'Reading question deactivated' });
  } catch (error) {
    next(error);
  }
}
