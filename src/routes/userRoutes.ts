import { Router } from 'express';
import { getMe, updateProfile, getAllUsers, deleteUser } from '../controllers/userController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/me', getMe);
router.put('/me', updateProfile);

// Admin only
router.get('/', authorize('admin'), getAllUsers);
router.delete('/:id', authorize('admin'), deleteUser);

export default router;
