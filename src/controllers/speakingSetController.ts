import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';
import {
  normalizeSpeakingSetStructure,
  resolveSetStructureAudio,
  validateSpeakingSetStructure,
} from '../utils/speakingSetStructure';

function isMissingSpeakingSetsTable(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === 'PGRST205' &&
    (error.message?.includes('speaking_sets') ?? false)
  );
}

function mapSetRow(row: Record<string, unknown>, resolveAudio: boolean) {
  const structure = normalizeSpeakingSetStructure(row.structure);
  return {
    id: row.id,
    title: row.title,
    level: row.level,
    sort_order: row.sort_order,
    is_published: row.is_published,
    structure: resolveAudio ? resolveSetStructureAudio(structure) : structure,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/v1/questions/speaking/sets?include_all=true
export async function getSpeakingSets(req: Request, res: Response, next: NextFunction) {
  try {
    const { include_all } = req.query as Record<string, string>;
    const showAll =
      include_all === 'true' && ['admin', 'tutor'].includes(req.user?.role ?? '');

    let query = getSupabase()
      .from('speaking_sets')
      .select('id, title, level, sort_order, is_published, structure, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (!showAll) query = query.eq('is_published', true);

    const { data, error } = await query;
    if (error) {
      // Migration not applied yet — fall back to legacy per-part speaking questions.
      if (isMissingSpeakingSetsTable(error)) {
        return res.json({ success: true, data: [] });
      }
      throw error;
    }

    return res.json({
      success: true,
      data: (data ?? []).map((row) => mapSetRow(row, !showAll)),
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/questions/speaking/sets/:id
export async function getSpeakingSetById(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from('speaking_sets')
      .select('id, title, level, sort_order, is_published, structure, created_at, updated_at')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Speaking set not found' });
    }

    const showAll = ['admin', 'tutor'].includes(req.user?.role ?? '');
    if (!showAll && !data.is_published) {
      return res.status(404).json({ success: false, message: 'Speaking set not found' });
    }

    return res.json({
      success: true,
      data: mapSetRow(data, !showAll),
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/questions/speaking/sets
export async function createSpeakingSet(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, level = 'B1', sort_order = 0, is_published = false, structure } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }

    const normalized = normalizeSpeakingSetStructure(structure);
    const publishing = Boolean(is_published);
    if (publishing) {
      const validationError = validateSpeakingSetStructure(normalized);
      if (validationError) {
        return res.status(400).json({ success: false, message: validationError });
      }
    }

    const { data, error } = await getSupabase()
      .from('speaking_sets')
      .insert({
        title: title.trim(),
        level,
        sort_order,
        is_published: publishing,
        structure: normalized,
        created_by: req.user?.sub,
      })
      .select('id, title, level, sort_order, is_published, structure, created_at, updated_at')
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data: mapSetRow(data, false) });
  } catch (error) {
    next(error);
  }
}

// PUT /api/v1/questions/speaking/sets/:id
export async function updateSpeakingSet(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, level, sort_order, is_published, structure } = req.body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (title !== undefined) updates.title = String(title).trim();
    if (level !== undefined) updates.level = level;
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (is_published !== undefined) updates.is_published = Boolean(is_published);

    if (structure !== undefined) {
      const normalized = normalizeSpeakingSetStructure(structure);
      if (is_published === true) {
        const validationError = validateSpeakingSetStructure(normalized);
        if (validationError) {
          return res.status(400).json({ success: false, message: validationError });
        }
      }
      updates.structure = normalized;
    }

    if (is_published === true && structure === undefined) {
      const { data: existing } = await getSupabase()
        .from('speaking_sets')
        .select('structure')
        .eq('id', req.params.id)
        .single();
      if (existing) {
        const validationError = validateSpeakingSetStructure(
          normalizeSpeakingSetStructure(existing.structure),
        );
        if (validationError) {
          return res.status(400).json({ success: false, message: validationError });
        }
      }
    }

    const { data, error } = await getSupabase()
      .from('speaking_sets')
      .update(updates)
      .eq('id', req.params.id)
      .select('id, title, level, sort_order, is_published, structure, created_at, updated_at')
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Speaking set not found' });
    }

    return res.json({ success: true, data: mapSetRow(data, false) });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/questions/speaking/sets/:id
export async function deleteSpeakingSet(req: Request, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase().from('speaking_sets').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true, message: 'Speaking set deleted' });
  } catch (error) {
    next(error);
  }
}
