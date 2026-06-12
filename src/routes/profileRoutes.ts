import { Router } from 'express';
import { getMyProfile, updateMyProfile, getProfileById, listProfiles } from '../controllers/profileController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', authorize('admin'), listProfiles);
router.get('/me', getMyProfile);
router.patch('/me', updateMyProfile);
router.get('/:id', authorize('admin', 'tutor'), getProfileById);

export default router;
