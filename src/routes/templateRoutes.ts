import { Router } from 'express';
import {
  listPteTemplates,
  upsertPteTemplate,
  deletePteTemplate,
  listPtePredictions,
  upsertPtePrediction,
  deletePtePrediction,
  listLangCertTemplates,
  upsertLangCertTemplate,
  deleteLangCertTemplate,
} from '../controllers/templateController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// NOTE: /pte/predictions routes MUST be registered before /pte/:id to avoid
// Express matching "predictions" as an :id parameter segment.
router.get('/pte/predictions', listPtePredictions);
router.post('/pte/predictions', upsertPtePrediction);
router.delete('/pte/predictions/:id', deletePtePrediction);

router.get('/pte', listPteTemplates);
router.post('/pte', upsertPteTemplate);
router.delete('/pte/:id', deletePteTemplate);

router.get('/language-cert', listLangCertTemplates);
router.post('/language-cert', upsertLangCertTemplate);
router.delete('/language-cert/:id', deleteLangCertTemplate);

export default router;
