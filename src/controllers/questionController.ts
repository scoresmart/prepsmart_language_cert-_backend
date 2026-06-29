import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { getSupabase } from '../config/database';
import { audioUpload } from './scoringController';
import {
  ensureSpeakingAudioBucket,
  speakingAudioPublicUrl,
  SPEAKING_AUDIO_BUCKET,
} from '../utils/ensureSpeakingAudioBucket';
import { normalizeSpeakingQuestion, withNormalizedSpeakingQuestions } from '../utils/speakingQuestionStructure';

function speakingAudioExtension(mime: string, originalName?: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
  };
  if (map[mime]) return map[mime];
  const fromName = originalName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return fromName || 'mp3';
}

// speakingAudioPublicUrl imported from ensureSpeakingAudioBucket

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
      .order('created_at', { ascending: false })
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

// ─── Speaking Questions ───────────────────────────────────────────────────────

// GET /api/v1/questions/speaking?part_number=1&include_all=true (admin/tutor)
export async function getSpeakingQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const { part_number, include_all } = req.query as Record<string, string>;
    const showAll =
      include_all === 'true' && ['admin', 'tutor'].includes(req.user?.role ?? '');

    let query = getSupabase()
      .from('speaking_part_questions')
      .select('id, part_number, task_type, title, level, content, audio_url, image_url, max_score, is_published, created_at')
      .order('created_at', { ascending: true });

    if (!showAll) query = query.eq('is_published', true);
    if (part_number) query = query.eq('part_number', parseInt(part_number, 10));

    const { data, error } = await query;
    if (error) throw error;
    return res.json({ success: true, data: withNormalizedSpeakingQuestions(data ?? []) });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/questions/speaking/:id
export async function getSpeakingQuestionById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('speaking_part_questions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ success: false, message: 'Question not found' });
    return res.json({
      success: true,
      data: normalizeSpeakingQuestion(data, data.part_number ?? 1),
    });
  } catch (error) {
    next(error);
  }
}

function partNumberFromTaskType(taskType: string): number {
  const match = taskType.match(/speaking_part_(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

// POST /api/v1/questions/speaking
export async function createSpeakingQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      title,
      task_type,
      part_number,
      level = 'B1',
      content,
      audio_url,
      image_url,
      max_score = 50,
      is_published = false,
    } = req.body;

    if (!title?.trim() || !task_type?.trim()) {
      return res.status(400).json({ success: false, message: 'title and task_type are required' });
    }

    const part = part_number ?? partNumberFromTaskType(task_type);

    const { data, error } = await getSupabase()
      .from('speaking_part_questions')
      .insert({
        title: title.trim(),
        task_type: task_type.trim(),
        part_number: part,
        level,
        content: content ?? null,
        audio_url: audio_url ?? null,
        image_url: image_url ?? null,
        max_score,
        is_published: Boolean(is_published),
        created_by: req.user!.sub,
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({
      success: true,
      data: normalizeSpeakingQuestion(data, data.part_number ?? 1),
    });
  } catch (error) {
    next(error);
  }
}

// PUT /api/v1/questions/speaking/:id
export async function updateSpeakingQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      title,
      task_type,
      part_number,
      level,
      content,
      audio_url,
      image_url,
      max_score,
      is_published,
    } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (task_type !== undefined) {
      updates.task_type = task_type;
      updates.part_number = part_number ?? partNumberFromTaskType(task_type);
    } else if (part_number !== undefined) {
      updates.part_number = part_number;
    }
    if (level !== undefined) updates.level = level;
    if (content !== undefined) updates.content = content;
    if (audio_url !== undefined) updates.audio_url = audio_url;
    if (image_url !== undefined) updates.image_url = image_url;
    if (max_score !== undefined) updates.max_score = max_score;
    if (is_published !== undefined) updates.is_published = is_published;

    const { data, error } = await getSupabase()
      .from('speaking_part_questions')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({
      success: true,
      data: normalizeSpeakingQuestion(data, data.part_number ?? 1),
    });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/questions/speaking/:id
export async function deleteSpeakingQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from('speaking_part_questions')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    return res.json({ success: true, message: 'Speaking question deleted' });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/questions/speaking/upload-audio (multipart)
export async function uploadSpeakingAudio(req: Request, res: Response, next: NextFunction) {
  audioUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        return res.status(400).json({ success: false, message: uploadErr.message });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No audio file provided' });
      }

      const ext = speakingAudioExtension(req.file.mimetype, req.file.originalname);
      const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

      await ensureSpeakingAudioBucket();

      const { error } = await getSupabase()
        .storage
        .from(SPEAKING_AUDIO_BUCKET)
        .upload(path, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (error) {
        return res.status(500).json({ success: false, message: error.message });
      }

      return res.status(201).json({
        success: true,
        data: {
          path,
          publicUrl: speakingAudioPublicUrl(path),
        },
      });
    } catch (error) {
      next(error);
    }
  });
}
