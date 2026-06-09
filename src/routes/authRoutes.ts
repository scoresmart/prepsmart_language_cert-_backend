import { Router } from 'express';
import { register, login, refreshToken, logout } from '../controllers/authController';
import { validateRequest } from '../middleware/validate';
import { body } from 'express-validator';

const router = Router();

router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').optional().isIn(['STUDENT', 'TEACHER']).withMessage('Invalid role'),
  ],
  validateRequest,
  register
);

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  validateRequest,
  login
);

router.post('/refresh', refreshToken);
router.post('/logout', logout);

export default router;
