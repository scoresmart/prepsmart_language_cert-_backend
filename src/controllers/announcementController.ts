import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/announcements
export async function listAnnouncements(req: Request, res: Response, next: NextFunction) {
  try {
    const { scope, subject } = req.query as Record<string, string>;
    const userId = req.user!.sub;
    const role = req.user!.role;
    const now = new Date().toISOString();

    let query = getSupabase()
      .from('announcements')
      .select('*')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_at', { ascending: false });

    if (role === 'student') {
      // Fetch student's active subjects
      const { data: access } = await getSupabase()
        .from('student_access')
        .select('subject')
        .eq('student_id', userId)
        .eq('status', 'active');

      const subjects = (access || []).map((a: { subject: string }) => a.subject);

      // Filter: either scope is 'all', or subject_filter matches one of student's subjects
      if (subjects.length > 0) {
        query = query.or(
          `scope.eq.all,subject_filter.in.(${subjects.map((s) => `"${s}"`).join(',')})`
        );
      } else {
        query = query.eq('scope', 'all');
      }
    }

    if (scope) query = query.eq('scope', scope);
    if (subject) query = query.eq('subject_filter', subject);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/announcements
export async function createAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const userId = req.user!.sub;
    const { scope, subject_filter, class_type_filter, title, body, link, expires_at } = req.body;

    if (!title || !body || !scope) {
      return res.status(400).json({ success: false, message: 'title, body, and scope are required' });
    }

    const now = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('announcements')
      .insert({
        created_by: userId,
        scope,
        subject_filter: subject_filter || null,
        class_type_filter: class_type_filter || null,
        title,
        body,
        link: link || null,
        expires_at: expires_at || null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/v1/announcements/:id
export async function updateAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;
    const role = req.user!.role;

    const { data: existing, error: fetchError } = await getSupabase()
      .from('announcements')
      .select('id, created_by')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }

    if (role !== 'admin' && existing.created_by !== userId) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { scope, subject_filter, class_type_filter, title, body, link, expires_at } = req.body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (scope !== undefined) updates.scope = scope;
    if (subject_filter !== undefined) updates.subject_filter = subject_filter;
    if (class_type_filter !== undefined) updates.class_type_filter = class_type_filter;
    if (title !== undefined) updates.title = title;
    if (body !== undefined) updates.body = body;
    if (link !== undefined) updates.link = link;
    if (expires_at !== undefined) updates.expires_at = expires_at;

    const { data, error } = await getSupabase()
      .from('announcements')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/announcements/:id
export async function deleteAnnouncement(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const role = req.user!.role;

    if (role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { error } = await getSupabase().from('announcements').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true, message: 'Announcement deleted' });
  } catch (error) {
    next(error);
  }
}
