import { Router } from 'express';
import {
  listQuadSlots,
  getQuadSlotById,
  createQuadSlot,
  updateQuadSlot,
  deleteQuadSlot,
  bookQuadSlot,
  listMyQuadBookings,
  listQuadBookingsBySlot,
  cancelQuadBooking,
  listO2OSlots,
  createO2OSlot,
  updateO2OSlot,
  deleteO2OSlot,
} from '../controllers/slotController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// ─── Quad Slots ───────────────────────────────────────────────────────────────

// Static quad sub-routes must come before /:id param routes to avoid conflicts
router.get('/quad/bookings/mine', listMyQuadBookings);
router.patch('/quad/bookings/:bookingId/cancel', cancelQuadBooking);

router.get('/quad', listQuadSlots);
router.post('/quad', authorize('admin', 'tutor'), createQuadSlot);
router.get('/quad/:id', getQuadSlotById);
router.patch('/quad/:id', authorize('admin', 'tutor'), updateQuadSlot);
router.delete('/quad/:id', authorize('admin'), deleteQuadSlot);
router.post('/quad/:id/book', authorize('student'), bookQuadSlot);
router.get('/quad/:id/bookings', authorize('admin', 'tutor'), listQuadBookingsBySlot);

// ─── One-to-One Slots ─────────────────────────────────────────────────────────

router.get('/o2o', listO2OSlots);
router.post('/o2o', authorize('admin', 'tutor'), createO2OSlot);
router.patch('/o2o/:id', authorize('admin', 'tutor'), updateO2OSlot);
router.delete('/o2o/:id', authorize('admin'), deleteO2OSlot);

export default router;
