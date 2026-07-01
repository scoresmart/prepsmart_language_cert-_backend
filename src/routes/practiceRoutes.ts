import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  savePracticeAttempt,
  getMyAttempts,
  getPracticeProgress,
  getAdminPracticeLogs,
} from '../controllers/practiceController';

const router = Router();

router.use(authenticate);

router.post('/attempts', savePracticeAttempt);
router.get('/attempts/mine', getMyAttempts);
router.get('/attempts/admin', authorize('admin', 'tutor'), getAdminPracticeLogs);
router.get('/progress', getPracticeProgress);

export default router;
