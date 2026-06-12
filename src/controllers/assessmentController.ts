import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// GET /api/v1/assessments/me
export async function getMyAssessments(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub;

    const { data, error } = await getSupabase()
      .from('student_assessments')
      .select('*')
      .eq('student_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/assessments/student/:studentId
export async function getAssessmentsByStudent(req: Request, res: Response, next: NextFunction) {
  try {
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { studentId } = req.params;

    const { data, error } = await getSupabase()
      .from('student_assessments')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/assessments
export async function upsertAssessment(req: Request, res: Response, next: NextFunction) {
  try {
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const {
      student_id,
      course,
      target_score,
      previous_score,
      exam_date,
      mock_tests_count,
      pass_probability,
      tutor_assessment,
    } = req.body;

    if (!student_id || !course) {
      return res.status(400).json({ success: false, message: 'student_id and course are required' });
    }

    const now = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('student_assessments')
      .upsert(
        {
          student_id,
          course,
          target_score: target_score ?? null,
          previous_score: previous_score ?? null,
          exam_date: exam_date ?? null,
          mock_tests_count: mock_tests_count ?? null,
          pass_probability: pass_probability ?? null,
          tutor_assessment: tutor_assessment ?? null,
          updated_at: now,
          created_at: now,
        },
        { onConflict: 'student_id,course' }
      )
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/assessments/history/:studentId
export async function listAssessmentHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { studentId } = req.params;

    const { data, error } = await getSupabase()
      .from('assessment_history')
      .select('*')
      .eq('student_id', studentId)
      .order('assessment_date', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/assessments/history
export async function createAssessmentHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const role = req.user!.role;
    if (role !== 'tutor' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const tutorId = req.user!.sub;
    const { student_id, score, assessment_details } = req.body;

    if (!student_id || score === undefined) {
      return res.status(400).json({ success: false, message: 'student_id and score are required' });
    }

    const now = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('assessment_history')
      .insert({
        student_id,
        tutor_id: tutorId,
        assessment_date: now,
        score,
        assessment_details: assessment_details ?? null,
        created_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
