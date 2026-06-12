import { Router } from 'express';
import {
  getMyAccess,
  getAccessByStudent,
  upsertAccess,
  revokeAccess,
} from '../controllers/studentAccessController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/me', getMyAccess);
router.get('/student/:studentId', authorize('admin', 'tutor'), getAccessByStudent);
router.post('/', authorize('admin'), upsertAccess);
router.delete('/:id', authorize('admin'), revokeAccess);

export default router;
