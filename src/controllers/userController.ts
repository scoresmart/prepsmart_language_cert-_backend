import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/users/me
export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('id, name, email, role, phone, subject_preferences, target_score, previous_score, exam_deadline, timezone, approval_status, created_at')
      .eq('id', req.user!.sub)
      .single();

    if (error || !data) return res.status(404).json({ success: false, message: 'User not found' });

    // Fetch student access for language cert
    const { data: access } = await getSupabase()
      .from('student_access')
      .select('subject, status, expiry_date, mock_tests_count, mock_tests_scores, course_expiry_at')
      .eq('student_id', req.user!.sub);

    return res.json({ success: true, data: { ...data, access } });
  } catch (error) {
    next(error);
  }
}

// PUT /api/v1/users/me
export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, phone, target_score, previous_score, exam_deadline, timezone } = req.body;

    const { data, error } = await getSupabase()
      .from('profiles')
      .update({ name, phone, target_score, previous_score, exam_deadline, timezone, updated_at: new Date().toISOString() })
      .eq('id', req.user!.sub)
      .select('id, name, email, role, phone, target_score, previous_score, exam_deadline, timezone')
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/users  (admin only)
export async function getAllUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '20', role, search } = req.query as Record<string, string>;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;

    let query = getSupabase()
      .from('profiles')
      .select('id, name, email, role, phone, approval_status, subject_preferences, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (role) query = query.eq('role', role);
    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      success: true,
      data: { users: data, total: count, page: parseInt(page), totalPages: Math.ceil((count || 0) / parseInt(limit)) },
    });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/users/:id  (admin only)
export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    // Delete from auth.users via Supabase admin API — cascades to profiles
    const { error } = await getSupabase().auth.admin.deleteUser(req.params.id);
    if (error) throw error;
    return res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    next(error);
  }
}
