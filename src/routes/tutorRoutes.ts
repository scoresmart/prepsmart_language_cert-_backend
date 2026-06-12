import { Router } from 'express';
import {
  listTutors,
  getTutorById,
  updateTutor,
  getTutorWorkingHours,
  upsertWorkingHours,
  getTutorBreaks,
  createBreak,
  deleteBreak,
} from '../controllers/tutorController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', listTutors);
router.get('/:id', getTutorById);
router.patch('/:id', updateTutor);

router.get('/:id/working-hours', getTutorWorkingHours);
router.post('/:id/working-hours', authorize('admin'), upsertWorkingHours);

router.get('/:id/breaks', getTutorBreaks);
router.post('/:id/breaks', createBreak);
router.delete('/:id/breaks/:breakId', deleteBreak);

export default router;
