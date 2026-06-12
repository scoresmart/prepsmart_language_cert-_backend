import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/tutors
export async function listTutors(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('tutors')
      .select('*')
      .eq('is_active', true)
      .order('full_name', { ascending: true });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/tutors/:id
export async function getTutorById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('tutors')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/v1/tutors/:id  (admin or the tutor themselves)
export async function updateTutor(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const requestingRole = req.user!.role;
    const requestingId = req.user!.sub;

    // Only admin or the tutor with matching id may update
    if (requestingRole !== 'admin' && requestingId !== id) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const {
      full_name,
      phone,
      google_connected,
      calendar_email,
      default_daily_hours_start,
      default_daily_hours_end,
      default_break_minutes,
      is_active,
    } = req.body;

    const { data, error } = await getSupabase()
      .from('tutors')
      .update({
        full_name,
        phone,
        google_connected,
        calendar_email,
        default_daily_hours_start,
        default_daily_hours_end,
        default_break_minutes,
        is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/tutors/:id/working-hours
export async function getTutorWorkingHours(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('tutor_working_hours')
      .select('*')
      .eq('tutor_id', req.params.id)
      .order('day_of_week', { ascending: true });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/tutors/:id/working-hours  (admin only)
export async function upsertWorkingHours(req: Request, res: Response, next: NextFunction) {
  try {
    const tutorId = req.params.id;

    // Accept either a single object or an array of working hour records
    const records: Record<string, unknown>[] = Array.isArray(req.body) ? req.body : [req.body];

    const now = new Date().toISOString();
    const payload = records.map((r) => ({
      ...r,
      tutor_id: tutorId,
      updated_at: now,
    }));

    const { data, error } = await getSupabase()
      .from('tutor_working_hours')
      .upsert(payload, { onConflict: 'tutor_id,day_of_week', ignoreDuplicates: false })
      .select('*');

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/tutors/:id/breaks
export async function getTutorBreaks(req: Request, res: Response, next: NextFunction) {
  try {
    const { date } = req.query as Record<string, string>;

    let query = getSupabase()
      .from('tutor_breaks')
      .select('*')
      .eq('tutor_id', req.params.id)
      .order('break_date', { ascending: true });

    if (date) query = query.eq('break_date', date);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/tutors/:id/breaks
export async function createBreak(req: Request, res: Response, next: NextFunction) {
  try {
    const tutorId = req.params.id;
    const { break_date, start_time, end_time, duration_minutes, is_active } = req.body;

    if (!break_date || !start_time || !end_time) {
      return res.status(400).json({ success: false, message: 'break_date, start_time, and end_time are required' });
    }

    const { data, error } = await getSupabase()
      .from('tutor_breaks')
      .insert({
        tutor_id: tutorId,
        break_date,
        start_time,
        end_time,
        duration_minutes: duration_minutes ?? null,
        is_active: is_active ?? true,
      })
      .select('*')
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/tutors/:id/breaks/:breakId
export async function deleteBreak(req: Request, res: Response, next: NextFunction) {
  try {
    const { breakId } = req.params;

    const { error } = await getSupabase()
      .from('tutor_breaks')
      .delete()
      .eq('id', breakId);

    if (error) throw error;

    return res.json({ success: true, message: 'Break deleted' });
  } catch (error) {
    next(error);
  }
}
