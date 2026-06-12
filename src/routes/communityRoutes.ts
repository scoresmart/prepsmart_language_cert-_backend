import { Router } from 'express';
import {
  listCommunities,
  getCommunityBySlug,
  listCommunityMessages,
  postMessage,
  joinCommunity,
  leaveCommunity,
} from '../controllers/communityController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', listCommunities);
router.get('/:slug', getCommunityBySlug);
router.get('/:slug/messages', listCommunityMessages);
router.post('/:slug/messages', postMessage);
router.post('/:slug/join', joinCommunity);
router.post('/:slug/leave', leaveCommunity);

export default router;
