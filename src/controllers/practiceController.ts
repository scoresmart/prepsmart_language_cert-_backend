import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

const WRITING_TASK_TYPES = ['task1', 'task2'] as const;
const READING_PART_TYPES = ['part1a', 'part1b', 'part2', 'part3', 'part4'] as const;
const LISTENING_PARTS = [1, 2, 3, 4] as const;
const SPEAKING_PARTS = [1, 2, 3, 4] as const;

type PracticeModule = 'speaking' | 'writing' | 'reading' | 'listening';

function moduleForQuestionType(questionType: string): PracticeModule | null {
  if (questionType.startsWith('writing_')) return 'writing';
  if (/reading_part/i.test(questionType)) return 'reading';
  if (/listening_part/i.test(questionType)) return 'listening';
  if (/speaking/i.test(questionType)) return 'speaking';
  return null;
}

async function countRows(
  table: string,
  filters: Record<string, string | number | boolean>,
): Promise<number> {
  let query = getSupabase().from(table).select('id', { count: 'exact', head: true });
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

// GET /api/v1/practice/progress
export async function getPracticeProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const student_id = req.user!.sub;

    const [writingCounts, readingCounts, listeningCounts, speakingCounts, attemptsRes] = await Promise.all([
      Promise.all(WRITING_TASK_TYPES.map((task_type) => countRows('writing_task_questions', { task_type }))),
      Promise.all(READING_PART_TYPES.map((part_type) => countRows('reading_part_questions', { part_type, is_active: true }))),
      Promise.all(LISTENING_PARTS.map((part_number) => countRows('listening_part_questions', { part_number }))),
      Promise.all(
        SPEAKING_PARTS.map((part_number) =>
          getSupabase()
            .from('speaking_part_questions')
            .select('id', { count: 'exact', head: true })
            .eq('part_number', part_number)
            .eq('is_published', true)
            .then((r) => {
              if (r.error) throw r.error;
              return r.count ?? 0;
            }),
        ),
      ),
      getSupabase()
        .from('practice_attempts')
        .select('question_type, question_set_id')
        .eq('student_id', student_id),
    ]);

    if (attemptsRes.error) throw attemptsRes.error;

    const practicedByModule: Record<PracticeModule, Set<string>> = {
      speaking: new Set(),
      writing: new Set(),
      reading: new Set(),
      listening: new Set(),
    };

    for (const row of attemptsRes.data ?? []) {
      const module = moduleForQuestionType(row.question_type);
      if (module) practicedByModule[module].add(row.question_set_id);
    }

    const writingTotal = writingCounts.reduce((sum, n) => sum + n, 0);
    const readingTotal = readingCounts.reduce((sum, n) => sum + n, 0);
    const listeningTotal = listeningCounts.reduce((sum, n) => sum + n, 0);
    const speakingTotal = speakingCounts.reduce((sum, n) => sum + n, 0);

    const modules = {
      speaking: { total: speakingTotal, practiced: practicedByModule.speaking.size },
      writing: { total: writingTotal, practiced: practicedByModule.writing.size },
      reading: { total: readingTotal, practiced: practicedByModule.reading.size },
      listening: { total: listeningTotal, practiced: practicedByModule.listening.size },
    };

    const total = Object.values(modules).reduce((sum, m) => sum + m.total, 0);
    const practiced = Object.values(modules).reduce((sum, m) => sum + m.practiced, 0);

    return res.json({
      success: true,
      data: {
        modules,
        overall: { total, practiced },
      },
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/practice/attempts
export async function savePracticeAttempt(req: Request, res: Response, next: NextFunction) {
  try {
    const { question_type, question_set_id, score, total } = req.body;
    const student_id = req.user!.sub;

    const { data, error } = await getSupabase()
      .from('practice_attempts')
      .insert({ student_id, question_type, question_set_id, score, total })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/practice/attempts/mine
export async function getMyAttempts(req: Request, res: Response, next: NextFunction) {
  try {
    const { question_type } = req.query;
    let query = getSupabase()
      .from('practice_attempts')
      .select('*')
      .eq('student_id', req.user!.sub)
      .order('created_at', { ascending: false })
      .limit(100);

    if (question_type) query = query.eq('question_type', question_type as string);

    const { data, error } = await query;
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
