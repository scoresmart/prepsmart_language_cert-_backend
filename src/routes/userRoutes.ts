import { Router } from 'express';
import { getMe, updateProfile, getAllUsers, deleteUser } from '../controllers/userController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/me', getMe);
router.put('/me', updateProfile);

// Admin only
router.get('/', authorize('ADMIN'), getAllUsers);
router.delete('/:id', authorize('ADMIN'), deleteUser);

export default router;
