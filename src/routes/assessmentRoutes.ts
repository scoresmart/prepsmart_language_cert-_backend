import { Router } from 'express';
import {
  getMyAssessments,
  getAssessmentsByStudent,
  upsertAssessment,
  listAssessmentHistory,
  createAssessmentHistory,
} from '../controllers/assessmentController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/me', getMyAssessments);
router.get('/student/:studentId', getAssessmentsByStudent);
router.post('/', upsertAssessment);
router.get('/history/:studentId', listAssessmentHistory);
router.post('/history', createAssessmentHistory);

export default router;
