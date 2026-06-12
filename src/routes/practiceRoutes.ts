import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { savePracticeAttempt, getMyAttempts, getPracticeProgress } from '../controllers/practiceController';

const router = Router();

router.use(authenticate);

router.post('/attempts', savePracticeAttempt);
router.get('/attempts/mine', getMyAttempts);
router.get('/progress', getPracticeProgress);

export default router;
