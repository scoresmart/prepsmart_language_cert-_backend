import { Router } from 'express';
import {
  getTests,
  getTestById,
  createTest,
  updateTest,
  deleteTest,
  startAttempt,
  submitAttempt,
  getAttemptResult,
  getMyAttempts,
} from '../controllers/testController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getTests);
router.get('/my-attempts', getMyAttempts);
router.get('/:id', getTestById);

// Tutor / Admin only
router.post('/', authorize('tutor', 'admin'), createTest);
router.put('/:id', authorize('tutor', 'admin'), updateTest);
router.delete('/:id', authorize('admin'), deleteTest);

// Student actions
router.post('/:id/attempt', startAttempt);
router.put('/:id/attempt/:attemptId/submit', submitAttempt);
router.get('/:id/attempt/:attemptId/result', getAttemptResult);

export default router;
