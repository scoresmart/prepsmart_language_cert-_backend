import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// ─── Shared helpers ────────────────────────────────────────────────────────────

async function listTemplates(
  table: string,
  section: string | undefined,
  res: Response,
  next: NextFunction
) {
  try {
    let query = getSupabase()
      .from(table)
      .select('*')
      .eq('is_active', true)
      .order('order_index', { ascending: true });

    if (section) query = query.eq('section', section);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function upsertTemplate(
  table: string,
  userId: string,
  body: Record<string, unknown>,
  res: Response,
  next: NextFunction
) {
  try {
    const { id, section, title, content, order_index } = body;

    if (!section || !title || !content) {
      return res.status(400).json({ success: false, message: 'section, title, and content are required' });
    }

    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      section,
      title,
      content,
      order_index: order_index ?? 0,
      is_active: true,
      created_by: userId,
      updated_at: now,
      created_at: now,
    };

    if (id) payload.id = id;

    const { data, error } = await getSupabase()
      .from(table)
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function deleteTemplate(
  table: string,
  id: string,
  res: Response,
  next: NextFunction
) {
  try {
    const { error } = await getSupabase().from(table).delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    next(error);
  }
}

// ─── PTE Templates ─────────────────────────────────────────────────────────────

// GET /api/v1/templates/pte
export async function listPteTemplates(req: Request, res: Response, next: NextFunction) {
  const { section } = req.query as Record<string, string>;
  return listTemplates('pte_templates', section, res, next);
}

// POST /api/v1/templates/pte
export async function upsertPteTemplate(req: Request, res: Response, next: NextFunction) {
  const role = req.user!.role;
  if (role !== 'admin' && role !== 'tutor') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }
  return upsertTemplate('pte_templates', req.user!.sub, req.body, res, next);
}

// DELETE /api/v1/templates/pte/:id
export async function deletePteTemplate(req: Request, res: Response, next: NextFunction) {
  const role = req.user!.role;
  if (role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  return deleteTemplate('pte_templates', req.params.id, res, next);
}

// ─── PTE Predictions ──────────────────────────────────────────────────────────

// GET /api/v1/templates/pte/predictions
export async function listPtePredictions(req: Request, res: Response, next: NextFunction) {
  const { section } = req.query as Record<string, string>;
  return listTemplates('pte_predictions', section, res, next);
}

// POST /api/v1/templates/pte/predictions
export async function upsertPtePrediction(req: Request, res: Response, next: NextFunction) {
  const role = req.user!.role;
  if (role !== 'admin' && role !== 'tutor') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }
  return upsertTemplate('pte_predictions', req.user!.sub, req.body, res, next);
}

// DELETE /api/v1/templates/pte/predictions/:id
export async function deletePtePrediction(req: Request, res: Response, next: NextFunction) {
  const role = req.user!.role;
  if (role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  return deleteTemplate('pte_predictions', req.params.id, res, next);
}

// ─── Language Cert Templates ──────────────────────────────────────────────────

// GET /api/v1/templates/language-cert
export async function listLangCertTemplates(req: Request, res: Response, next: NextFunction) {
  const { section } = req.query as Record<string, string>;
  return listTemplates('language_cert_templates', section, res, next);
}

// POST /api/v1/templates/language-cert
export async function upsertLangCertTemplate(req: Request, res: Response, next: NextFunction) {
  const role = req.user!.role;
  if (role !== 'admin' && role !== 'tutor') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }
  return upsertTemplate('language_cert_templates', req.user!.sub, req.body, res, next);
}

// DELETE /api/v1/templates/language-cert/:id
export async function deleteLangCertTemplate(req: Request, res: Response, next: NextFunction) {
  const role = req.user!.role;
  if (role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  return deleteTemplate('language_cert_templates', req.params.id, res, next);
}
