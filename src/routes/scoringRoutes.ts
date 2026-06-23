import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  scoreWriting,
  scoreSpeakingAudio,
  scoreSpeakingFromTranscript,
  scoreObjective,
  getAttemptScore,
  getWritingMarkScheme,
  getSpeakingMarkScheme,
} from '../controllers/scoringController';

const router = Router();

// ─── AI Scoring (authenticated) ──────────────────────────────────────────────

// Writing: POST { question_text, candidate_response, level, task_type, attempt_id? }
router.post('/writing', authenticate, scoreWriting);

// Speaking: multipart/form-data — fields: audio (file), level, task_description, attempt_id?
router.post('/speaking/audio', authenticate, scoreSpeakingAudio);

// Speaking fallback: POST { task_description, transcript, level, attempt_id? }
router.post('/speaking/transcript', authenticate, scoreSpeakingFromTranscript);

// Reading/Listening: POST { section_id, section_type, student_answers, attempt_id? }
router.post('/objective', authenticate, scoreObjective);

// Get attempt score/status: GET /scoring/attempt/:attemptId
router.get('/attempt/:attemptId', authenticate, getAttemptScore);

// ─── Mark Scheme Reference (public) ──────────────────────────────────────────

router.get('/mark-schemes/writing/:level', getWritingMarkScheme);
router.get('/mark-schemes/speaking/:level', getSpeakingMarkScheme);

export default router;
