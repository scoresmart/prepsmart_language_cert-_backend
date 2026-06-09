import { Router } from 'express';
import {
  getQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  syncQuestionsFromMcp,
} from '../controllers/questionController';
import { authenticate, authorize } from '../middleware/auth';
import { body, query } from 'express-validator';
import { validateRequest } from '../middleware/validate';

const router = Router();

router.use(authenticate);

// GET /api/v1/questions?certification=PTE&section=READING&difficulty=MEDIUM&page=1&limit=20
router.get(
  '/',
  [
    query('certification').optional().isIn(['PTE', 'IELTS', 'TOEFL', 'DUOLINGO']),
    query('section').optional().isIn(['SPEAKING', 'WRITING', 'READING', 'LISTENING']),
    query('difficulty').optional().isIn(['EASY', 'MEDIUM', 'HARD']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validateRequest,
  getQuestions
);

router.get('/:id', getQuestionById);

// Teacher / Admin only
router.post(
  '/',
  authorize('TEACHER', 'ADMIN'),
  [
    body('certification').isIn(['PTE', 'IELTS', 'TOEFL', 'DUOLINGO']),
    body('section').isIn(['SPEAKING', 'WRITING', 'READING', 'LISTENING']),
    body('questionType').notEmpty(),
    body('title').notEmpty(),
    body('content').notEmpty(),
    body('marks').isFloat({ min: 0 }),
  ],
  validateRequest,
  createQuestion
);

router.put('/:id', authorize('TEACHER', 'ADMIN'), updateQuestion);
router.delete('/:id', authorize('ADMIN'), deleteQuestion);

// Sync questions from MCP server (Admin only)
router.post('/sync/mcp', authorize('ADMIN'), syncQuestionsFromMcp);

export default router;
