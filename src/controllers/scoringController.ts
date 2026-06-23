import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { scoreWritingResponse, transcribeAndScoreSpeaking, scoreSpeakingTranscript } from '../services/aiScoringService';
import { scoreObjectiveAnswers, StudentAnswerEntry } from '../services/objectiveScoringService';
import { CEFRLevel, WRITING_MARK_SCHEMES, SPEAKING_MARK_SCHEMES } from '../utils/languageCertMarkScheme';
import { getSupabase } from '../config/database';

const VALID_LEVELS: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// ─── Multer — in-memory audio upload (max 25MB) ───────────────────────────────

export const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/webm', 'audio/mp4'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio type: ${file.mimetype}. Supported: wav, mp3, ogg, webm, mp4`));
    }
  },
}).single('audio');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveScoreToAttempt(
  attemptId: string,
  studentId: string,
  score: number,
  total: number,
  scoreDetails: object,
  status: 'completed' | 'failed',
) {
  await getSupabase()
    .from('practice_attempts')
    .update({ score, total, score_details: scoreDetails, scoring_status: status })
    .eq('id', attemptId)
    .eq('student_id', studentId);
}

// ─── POST /api/v1/scoring/writing ─────────────────────────────────────────────

export async function scoreWriting(req: Request, res: Response, next: NextFunction) {
  try {
    const { question_text, candidate_response, level, task_type, attempt_id } = req.body;

    if (!question_text || !candidate_response || !level || !task_type) {
      return res.status(400).json({
        success: false,
        message: 'question_text, candidate_response, level, and task_type are required',
      });
    }

    if (!VALID_LEVELS.includes(level as CEFRLevel)) {
      return res.status(400).json({ success: false, message: `level must be one of: ${VALID_LEVELS.join(', ')}` });
    }

    if (!['task1', 'task2'].includes(task_type)) {
      return res.status(400).json({ success: false, message: 'task_type must be task1 or task2' });
    }

    // If attemptId provided, mark as scoring immediately so frontend can show loader
    if (attempt_id) {
      await getSupabase()
        .from('practice_attempts')
        .update({ scoring_status: 'scoring' })
        .eq('id', attempt_id)
        .eq('student_id', req.user!.sub);
    }

    const result = await scoreWritingResponse(
      question_text,
      candidate_response,
      level as CEFRLevel,
      task_type as 'task1' | 'task2',
    );

    // Persist score to attempt if attempt_id provided
    if (attempt_id) {
      await saveScoreToAttempt(
        attempt_id,
        req.user!.sub,
        result.scores.total,
        12,
        result,
        'completed',
      );
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/v1/scoring/speaking/audio (multipart upload) ──────────────────

export async function scoreSpeakingAudio(req: Request, res: Response, next: NextFunction) {
  // Run multer first
  audioUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    try {
      const { level, task_description, attempt_id } = req.body;

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Audio file is required (field name: audio)' });
      }

      if (!level || !task_description) {
        return res.status(400).json({ success: false, message: 'level and task_description are required' });
      }

      if (!VALID_LEVELS.includes(level as CEFRLevel)) {
        return res.status(400).json({ success: false, message: `level must be one of: ${VALID_LEVELS.join(', ')}` });
      }

      // Mark attempt as scoring immediately (frontend shows loader)
      if (attempt_id) {
        await getSupabase()
          .from('practice_attempts')
          .update({ scoring_status: 'scoring' })
          .eq('id', attempt_id)
          .eq('student_id', req.user!.sub);
      }

      const result = await transcribeAndScoreSpeaking(
        req.file.buffer,
        req.file.mimetype,
        task_description,
        level as CEFRLevel,
      );

      // Persist score
      if (attempt_id) {
        await saveScoreToAttempt(
          attempt_id,
          req.user!.sub,
          result.scores.scaledTotal,
          50,
          result,
          'completed',
        );
      }

      return res.json({ success: true, data: result });
    } catch (error: any) {
      // If attempt exists, mark as failed
      const { attempt_id } = req.body;
      if (attempt_id) {
        await getSupabase()
          .from('practice_attempts')
          .update({ scoring_status: 'failed' })
          .eq('id', attempt_id)
          .eq('student_id', req.user!.sub);
      }
      next(error);
    }
  });
}

// ─── POST /api/v1/scoring/speaking/transcript (text fallback) ────────────────

export async function scoreSpeakingFromTranscript(req: Request, res: Response, next: NextFunction) {
  try {
    const { task_description, transcript, level, attempt_id } = req.body;

    if (!task_description || !transcript || !level) {
      return res.status(400).json({ success: false, message: 'task_description, transcript, and level are required' });
    }

    if (!VALID_LEVELS.includes(level as CEFRLevel)) {
      return res.status(400).json({ success: false, message: `level must be one of: ${VALID_LEVELS.join(', ')}` });
    }

    if (attempt_id) {
      await getSupabase()
        .from('practice_attempts')
        .update({ scoring_status: 'scoring' })
        .eq('id', attempt_id)
        .eq('student_id', req.user!.sub);
    }

    const result = await scoreSpeakingTranscript(task_description, transcript, level as CEFRLevel);

    if (attempt_id) {
      await saveScoreToAttempt(attempt_id, req.user!.sub, result.scores.scaledTotal, 50, result, 'completed');
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/v1/scoring/objective ──────────────────────────────────────────

export async function scoreObjective(req: Request, res: Response, next: NextFunction) {
  try {
    const { section_id, section_type, student_answers, attempt_id } = req.body;

    if (!section_id || !section_type || !student_answers) {
      return res.status(400).json({ success: false, message: 'section_id, section_type, and student_answers are required' });
    }

    if (!['reading', 'listening'].includes(section_type)) {
      return res.status(400).json({ success: false, message: 'section_type must be reading or listening' });
    }

    // Fetch answer key from DB
    const table = section_type === 'reading' ? 'reading_part_questions' : 'listening_part_questions';
    const { data: section, error } = await getSupabase()
      .from(table)
      .select('answer_key, questions')
      .eq('id', section_id)
      .single();

    if (error || !section) {
      return res.status(404).json({ success: false, message: `${section_type} section not found` });
    }

    if (!section.answer_key || section.answer_key.length === 0) {
      return res.status(422).json({ success: false, message: 'Answer key not yet configured for this section' });
    }

    const result = scoreObjectiveAnswers(
      student_answers as StudentAnswerEntry[],
      section.answer_key,
    );

    // Persist score
    if (attempt_id) {
      await saveScoreToAttempt(
        attempt_id,
        req.user!.sub,
        result.score,
        result.total,
        result,
        'completed',
      );
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/v1/scoring/attempt/:attemptId ───────────────────────────────────

export async function getAttemptScore(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('practice_attempts')
      .select('id, score, total, score_details, scoring_status, question_type, created_at')
      .eq('id', req.params.attemptId)
      .eq('student_id', req.user!.sub)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Attempt not found' });
    }

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/v1/scoring/mark-schemes/writing/:level ─────────────────────────

export async function getWritingMarkScheme(req: Request, res: Response, next: NextFunction) {
  try {
    const { level } = req.params;
    if (!VALID_LEVELS.includes(level as CEFRLevel)) {
      return res.status(400).json({ success: false, message: `level must be one of: ${VALID_LEVELS.join(', ')}` });
    }
    return res.json({ success: true, data: WRITING_MARK_SCHEMES[level as CEFRLevel] });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/v1/scoring/mark-schemes/speaking/:level ────────────────────────

export async function getSpeakingMarkScheme(req: Request, res: Response, next: NextFunction) {
  try {
    const { level } = req.params;
    if (!VALID_LEVELS.includes(level as CEFRLevel)) {
      return res.status(400).json({ success: false, message: `level must be one of: ${VALID_LEVELS.join(', ')}` });
    }
    return res.json({ success: true, data: SPEAKING_MARK_SCHEMES[level as CEFRLevel] });
  } catch (error) {
    next(error);
  }
}
