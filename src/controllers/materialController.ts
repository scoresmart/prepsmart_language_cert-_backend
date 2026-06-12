import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/materials
export async function listMaterials(req: Request, res: Response, next: NextFunction) {
  try {
    const { subject, category, file_type, is_approved } = req.query as Record<string, string>;
    const userId = req.user!.sub;
    const role = req.user!.role;

    let query = getSupabase().from('materials').select('*').order('created_at', { ascending: false });

    if (role === 'student') {
      // Students only see approved materials that match their subject access
      query = query.eq('is_approved', true);

      const { data: access } = await getSupabase()
        .from('student_access')
        .select('subject')
        .eq('student_id', userId)
        .eq('status', 'active');

      const subjects = (access || []).map((a: { subject: string }) => a.subject);
      if (subjects.length > 0) {
        query = query.in('subject', subjects);
      } else {
        // No active access — return empty
        return res.json({ success: true, data: [] });
      }
    }

    if (subject) query = query.eq('subject', subject);
    if (category) query = query.eq('category', category);
    if (file_type) query = query.eq('file_type', file_type);
    if (is_approved !== undefined && role !== 'student') {
      query = query.eq('is_approved', is_approved === 'true');
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/materials/:id
export async function getMaterialById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;
    const role = req.user!.role;

    const { data, error } = await getSupabase()
      .from('materials')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    if (role === 'student') {
      if (!data.is_approved) {
        return res.status(403).json({ success: false, message: 'Material not available' });
      }
      // Check subject access
      const { data: access } = await getSupabase()
        .from('student_access')
        .select('subject')
        .eq('student_id', userId)
        .eq('subject', data.subject)
        .eq('status', 'active')
        .maybeSingle();

      if (!access) {
        return res.status(403).json({ success: false, message: 'No access to this subject' });
      }
    }

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/materials
export async function createMaterial(req: Request, res: Response, next: NextFunction) {
  try {
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const userId = req.user!.sub;
    const { subject, category, title, description, file_type, storage_path, web_view_link } = req.body;

    if (!subject || !title || !file_type) {
      return res.status(400).json({ success: false, message: 'subject, title, and file_type are required' });
    }

    const now = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('materials')
      .insert({
        subject,
        category,
        title,
        description,
        file_type,
        storage_path,
        web_view_link,
        created_by: userId,
        is_approved: role === 'admin', // auto-approve for admins
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

// PATCH /api/v1/materials/:id
export async function updateMaterial(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;
    const role = req.user!.role;

    const { data: existing, error: fetchError } = await getSupabase()
      .from('materials')
      .select('id, created_by')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    if (role !== 'admin' && existing.created_by !== userId) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { subject, category, title, description, file_type, storage_path, web_view_link } = req.body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (subject !== undefined) updates.subject = subject;
    if (category !== undefined) updates.category = category;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (file_type !== undefined) updates.file_type = file_type;
    if (storage_path !== undefined) updates.storage_path = storage_path;
    if (web_view_link !== undefined) updates.web_view_link = web_view_link;

    const { data, error } = await getSupabase()
      .from('materials')
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

// PATCH /api/v1/materials/:id/approve
export async function approveMaterial(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const role = req.user!.role;

    if (role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { data, error } = await getSupabase()
      .from('materials')
      .update({
        is_approved: true,
        approved_by: req.user!.sub,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Material not found' });

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/materials/:id
export async function deleteMaterial(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const role = req.user!.role;

    if (role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { error } = await getSupabase().from('materials').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true, message: 'Material deleted' });
  } catch (error) {
    next(error);
  }
}
