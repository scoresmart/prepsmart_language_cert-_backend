import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';
import {
  emptySpeakingSetStructure,
  resolveSetStructureAudio,
  validateSpeakingSetStructure,
  type SpeakingSetStructure,
} from '../utils/speakingSetStructure';

function normalizeStructure(raw: unknown): SpeakingSetStructure {
  if (!raw || typeof raw !== 'object') return emptySpeakingSetStructure();
  const s = raw as Partial<SpeakingSetStructure>;
  const base = emptySpeakingSetStructure();
  return {
    part1: Array.isArray(s.part1) && s.part1.length === 5 ? s.part1 : base.part1,
    part2: Array.isArray(s.part2) && s.part2.length === 2 ? s.part2 : base.part2,
    part3: {
      readAloud: { ...base.part3.readAloud, ...(s.part3?.readAloud ?? {}) },
      followUps:
        Array.isArray(s.part3?.followUps) && s.part3.followUps.length > 0
          ? s.part3.followUps
          : base.part3.followUps,
    },
    part4: {
      presentation: { ...base.part4.presentation, ...(s.part4?.presentation ?? {}) },
      followUps:
        Array.isArray(s.part4?.followUps) && s.part4.followUps.length === 2
          ? s.part4.followUps
          : base.part4.followUps,
    },
  };
}

function mapSetRow(row: Record<string, unknown>, resolveAudio: boolean) {
  const structure = normalizeStructure(row.structure);
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
    if (error) throw error;

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

    const normalized = normalizeStructure(structure);
    const validationError = validateSpeakingSetStructure(normalized);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const { data, error } = await getSupabase()
      .from('speaking_sets')
      .insert({
        title: title.trim(),
        level,
        sort_order,
        is_published: Boolean(is_published),
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
      const normalized = normalizeStructure(structure);
      const validationError = validateSpeakingSetStructure(normalized);
      if (validationError) {
        return res.status(400).json({ success: false, message: validationError });
      }
      updates.structure = normalized;
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
