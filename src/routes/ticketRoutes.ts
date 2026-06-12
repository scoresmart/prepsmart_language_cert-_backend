import { Router } from 'express';
import {
  listTickets,
  createTicket,
  getTicketById,
  updateTicket,
  addMessage,
  pinTicket,
  unpinTicket,
} from '../controllers/ticketController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', listTickets);
router.post('/', createTicket);
router.get('/:id', getTicketById);
router.patch('/:id', updateTicket);
router.post('/:id/messages', addMessage);
router.post('/:id/pin', pinTicket);
router.delete('/:id/pin', unpinTicket);

export default router;
