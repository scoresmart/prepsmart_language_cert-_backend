import { Router } from 'express';
import {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../controllers/announcementController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', listAnnouncements);
router.post('/', createAnnouncement);
router.patch('/:id', updateAnnouncement);
router.delete('/:id', deleteAnnouncement);

export default router;
