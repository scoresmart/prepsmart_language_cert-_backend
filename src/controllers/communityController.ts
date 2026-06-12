import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/communities
export async function listCommunities(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('communities')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/communities/:slug
export async function getCommunityBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    const { slug } = req.params;

    const { data: community, error: communityError } = await getSupabase()
      .from('communities')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (communityError || !community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    const { count, error: countError } = await getSupabase()
      .from('community_members')
      .select('id', { count: 'exact', head: true })
      .eq('community_id', community.id)
      .eq('is_active', true);

    if (countError) throw countError;

    return res.json({ success: true, data: { ...community, member_count: count ?? 0 } });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/communities/:slug/messages
export async function listCommunityMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const { slug } = req.params;
    const userId = req.user!.sub;
    const role = req.user!.role;
    const { page = '1', limit = '50' } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const { data: community, error: communityError } = await getSupabase()
      .from('communities')
      .select('id')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (communityError || !community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    // Check membership unless admin
    if (role !== 'admin') {
      const { data: membership } = await getSupabase()
        .from('community_members')
        .select('id')
        .eq('community_id', community.id)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      if (!membership) {
        return res.status(403).json({ success: false, message: 'You must be an active member to view messages' });
      }
    }

    const { data: messages, error: msgError, count } = await getSupabase()
      .from('community_messages')
      .select('*', { count: 'exact' })
      .eq('community_id', community.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (msgError) throw msgError;

    return res.json({
      success: true,
      data: {
        messages,
        total: count,
        page: pageNum,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/communities/:slug/messages
export async function postMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const { slug } = req.params;
    const userId = req.user!.sub;
    const { body: messageBody, is_announcement = false } = req.body;

    if (!messageBody) {
      return res.status(400).json({ success: false, message: 'body is required' });
    }

    const { data: community, error: communityError } = await getSupabase()
      .from('communities')
      .select('id')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (communityError || !community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    // Only active members can post
    const { data: membership } = await getSupabase()
      .from('community_members')
      .select('id, role')
      .eq('community_id', community.id)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!membership) {
      return res.status(403).json({ success: false, message: 'You must be an active member to post messages' });
    }

    const { data, error } = await getSupabase()
      .from('community_messages')
      .insert({
        community_id: community.id,
        sender_id: userId,
        body: messageBody,
        is_announcement: Boolean(is_announcement),
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/communities/:slug/join
export async function joinCommunity(req: Request, res: Response, next: NextFunction) {
  try {
    const { slug } = req.params;
    const userId = req.user!.sub;

    const { data: community, error: communityError } = await getSupabase()
      .from('communities')
      .select('id')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (communityError || !community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    const { data, error } = await getSupabase()
      .from('community_members')
      .upsert(
        {
          community_id: community.id,
          user_id: userId,
          role: 'member',
          is_active: true,
          joined_at: new Date().toISOString(),
        },
        { onConflict: 'community_id,user_id' }
      )
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/communities/:slug/leave
export async function leaveCommunity(req: Request, res: Response, next: NextFunction) {
  try {
    const { slug } = req.params;
    const userId = req.user!.sub;

    const { data: community, error: communityError } = await getSupabase()
      .from('communities')
      .select('id')
      .eq('slug', slug)
      .single();

    if (communityError || !community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    const { error } = await getSupabase()
      .from('community_members')
      .update({ is_active: false })
      .eq('community_id', community.id)
      .eq('user_id', userId);

    if (error) throw error;

    return res.json({ success: true, message: 'Left community' });
  } catch (error) {
    next(error);
  }
}
