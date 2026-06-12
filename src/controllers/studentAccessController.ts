import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/access/me
export async function getMyAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('student_access')
      .select('*')
      .eq('student_id', req.user!.sub)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/access/student/:studentId  (admin/tutor only)
export async function getAccessByStudent(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId } = req.params;

    const { data, error } = await getSupabase()
      .from('student_access')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/access  (admin only)
export async function upsertAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      student_id,
      subject,
      allow_master,
      allow_quad,
      allow_one_to_one,
      expiry_date,
      one_to_one_quota,
      course_expiry_at,
      status,
    } = req.body;

    if (!student_id || !subject) {
      return res.status(400).json({ success: false, message: 'student_id and subject are required' });
    }

    const now = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('student_access')
      .upsert(
        {
          student_id,
          subject,
          allow_master: allow_master ?? false,
          allow_quad: allow_quad ?? false,
          allow_one_to_one: allow_one_to_one ?? false,
          expiry_date: expiry_date ?? null,
          one_to_one_quota: one_to_one_quota ?? 0,
          course_expiry_at: course_expiry_at ?? null,
          status: status ?? 'active',
          updated_at: now,
        },
        { onConflict: 'student_id,subject', ignoreDuplicates: false }
      )
      .select('*')
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/access/:id  (admin only)
export async function revokeAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const { error } = await getSupabase()
      .from('student_access')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.json({ success: true, message: 'Access record deleted' });
  } catch (error) {
    next(error);
  }
}
