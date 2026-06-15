import { Router } from 'express';
import {
  getWritingQuestions,
  getWritingQuestionById,
  createWritingQuestion,
  updateWritingQuestion,
  deleteWritingQuestion,
  getListeningQuestions,
  getListeningQuestionById,
  createListeningQuestion,
  updateListeningQuestion,
  deleteListeningQuestion,
  getSpeakingQuestions,
  getSpeakingQuestionById,
} from '../controllers/questionController';
import {
  getReadingQuestions,
  getReadingQuestionById,
  createReadingQuestion,
  updateReadingQuestion,
  deleteReadingQuestion,
} from '../controllers/readingController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Writing questions
router.get('/writing', getWritingQuestions);
router.get('/writing/:id', getWritingQuestionById);
router.post('/writing', authorize('tutor', 'admin'), createWritingQuestion);
router.put('/writing/:id', authorize('tutor', 'admin'), updateWritingQuestion);
router.delete('/writing/:id', authorize('admin'), deleteWritingQuestion);

// Listening questions
router.get('/listening', getListeningQuestions);
router.get('/listening/:id', getListeningQuestionById);
router.post('/listening', authorize('tutor', 'admin'), createListeningQuestion);
router.put('/listening/:id', authorize('tutor', 'admin'), updateListeningQuestion);
router.delete('/listening/:id', authorize('admin'), deleteListeningQuestion);

// Reading questions
router.get('/reading', getReadingQuestions);
router.get('/reading/:id', getReadingQuestionById);
router.post('/reading', authorize('tutor', 'admin'), createReadingQuestion);
router.put('/reading/:id', authorize('tutor', 'admin'), updateReadingQuestion);
router.delete('/reading/:id', authorize('admin'), deleteReadingQuestion);

// Speaking questions
router.get('/speaking', getSpeakingQuestions);
router.get('/speaking/:id', getSpeakingQuestionById);

export default router;
