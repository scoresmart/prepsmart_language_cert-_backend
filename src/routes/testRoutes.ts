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

// Teacher / Admin only
router.post('/', authorize('TEACHER', 'ADMIN'), createTest);
router.put('/:id', authorize('TEACHER', 'ADMIN'), updateTest);
router.delete('/:id', authorize('ADMIN'), deleteTest);

// Student actions
router.post('/:id/attempt', startAttempt);
router.post('/:id/attempt/:attemptId/submit', submitAttempt);
router.get('/:id/attempt/:attemptId/result', getAttemptResult);

export default router;
