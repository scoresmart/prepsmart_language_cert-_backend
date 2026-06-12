import { Router } from 'express';
import {
  listMaterials,
  createMaterial,
  getMaterialById,
  updateMaterial,
  approveMaterial,
  deleteMaterial,
} from '../controllers/materialController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', listMaterials);
router.post('/', createMaterial);
router.get('/:id', getMaterialById);
router.patch('/:id', updateMaterial);
router.patch('/:id/approve', approveMaterial);
router.delete('/:id', deleteMaterial);

export default router;
