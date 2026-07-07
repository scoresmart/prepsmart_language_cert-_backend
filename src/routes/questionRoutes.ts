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
  createSpeakingQuestion,
  updateSpeakingQuestion,
  deleteSpeakingQuestion,
  uploadSpeakingAudio,
} from '../controllers/questionController';
import {
  getSpeakingSets,
  getSpeakingSetById,
  createSpeakingSet,
  updateSpeakingSet,
  deleteSpeakingSet,
} from '../controllers/speakingSetController';
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

// Speaking sets (full 4-part bundles) — register before /speaking/:id
router.get('/speaking/sets', getSpeakingSets);
router.get('/speaking/sets/:id', getSpeakingSetById);
router.post('/speaking/sets', authorize('tutor', 'admin'), createSpeakingSet);
router.put('/speaking/sets/:id', authorize('tutor', 'admin'), updateSpeakingSet);
router.delete('/speaking/sets/:id', authorize('admin'), deleteSpeakingSet);

// Speaking questions (legacy single prompts)
router.get('/speaking', getSpeakingQuestions);
router.post('/speaking/upload-audio', authorize('tutor', 'admin'), uploadSpeakingAudio);
router.get('/speaking/:id', getSpeakingQuestionById);
router.post('/speaking', authorize('tutor', 'admin'), createSpeakingQuestion);
router.put('/speaking/:id', authorize('tutor', 'admin'), updateSpeakingQuestion);
router.delete('/speaking/:id', authorize('admin'), deleteSpeakingQuestion);

export default router;
