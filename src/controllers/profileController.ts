import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/profiles/me
export async function getMyProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('*')
      .eq('id', req.user!.sub)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/v1/profiles/me
export async function updateMyProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, phone, subject_preferences } = req.body;

    const { data, error } = await getSupabase()
      .from('profiles')
      .update({ name, phone, subject_preferences, updated_at: new Date().toISOString() })
      .eq('id', req.user!.sub)
      .select('*')
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/profiles/:id  (admin/tutor only)
export async function getProfileById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/profiles  (admin only)
export async function listProfiles(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', role } = req.query as Record<string, string>;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;

    let query = getSupabase()
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (role) query = query.eq('role', role);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      success: true,
      data: {
        profiles: data,
        total: count,
        page: parseInt(page),
        totalPages: Math.ceil((count || 0) / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
}
