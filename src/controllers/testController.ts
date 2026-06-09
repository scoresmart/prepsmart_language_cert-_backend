import { Request, Response, NextFunction } from 'express';
import { Test, TestAttempt } from '../models/Test';
import { Question } from '../models/Question';

export async function getTests(req: Request, res: Response, next: NextFunction) {
  try {
    const { certification, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { isPublished: true };
    if (certification) where.certification = certification;

    const pageNum = Math.max(parseInt(page, 10), 1);
    const limitNum = Math.min(parseInt(limit, 10), 50);
    const { count, rows } = await Test.findAndCountAll({
      where,
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      order: [['createdAt', 'DESC']],
    });

    return res.json({
      success: true,
      data: { tests: rows, total: count, page: pageNum, totalPages: Math.ceil(count / limitNum) },
    });
  } catch (error) {
    next(error);
  }
}

export async function getTestById(req: Request, res: Response, next: NextFunction) {
  try {
    const test = await Test.findByPk(req.params.id);
    if (!test) return res.status(404).json({ success: false, message: 'Test not found' });
    return res.json({ success: true, data: test });
  } catch (error) {
    next(error);
  }
}

export async function createTest(req: Request, res: Response, next: NextFunction) {
  try {
    const test = await Test.create(req.body);
    return res.status(201).json({ success: true, data: test });
  } catch (error) {
    next(error);
  }
}

export async function updateTest(req: Request, res: Response, next: NextFunction) {
  try {
    const test = await Test.findByPk(req.params.id);
    if (!test) return res.status(404).json({ success: false, message: 'Test not found' });
    await test.update(req.body);
    return res.json({ success: true, data: test });
  } catch (error) {
    next(error);
  }
}

export async function deleteTest(req: Request, res: Response, next: NextFunction) {
  try {
    const test = await Test.findByPk(req.params.id);
    if (!test) return res.status(404).json({ success: false, message: 'Test not found' });
    await test.destroy();
    return res.json({ success: true, message: 'Test deleted' });
  } catch (error) {
    next(error);
  }
}

export async function startAttempt(req: Request, res: Response, next: NextFunction) {
  try {
    const test = await Test.findByPk(req.params.id);
    if (!test || !test.isPublished) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }

    const existing = await TestAttempt.findOne({
      where: { userId: req.user!.userId, testId: test.id, status: 'IN_PROGRESS' },
    });
    if (existing) {
      return res.json({ success: true, data: existing, message: 'Resuming existing attempt' });
    }

    const attempt = await TestAttempt.create({
      userId: req.user!.userId,
      testId: test.id,
      status: 'IN_PROGRESS',
      startedAt: new Date(),
    });

    // Fetch questions for this test
    const questions = await Question.findAll({
      where: { id: test.questionIds, isActive: true },
      attributes: { exclude: ['correctAnswer', 'explanation'] },
    });

    return res.status(201).json({ success: true, data: { attempt, questions } });
  } catch (error) {
    next(error);
  }
}

export async function submitAttempt(req: Request, res: Response, next: NextFunction) {
  try {
    const attempt = await TestAttempt.findOne({
      where: {
        id: req.params.attemptId,
        userId: req.user!.userId,
        testId: req.params.id,
      },
    });

    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
    if (attempt.status === 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'Attempt already submitted' });
    }

    const { answers } = req.body;

    await attempt.update({
      answers,
      status: 'COMPLETED',
      completedAt: new Date(),
    });

    return res.json({ success: true, data: attempt, message: 'Test submitted successfully' });
  } catch (error) {
    next(error);
  }
}

export async function getAttemptResult(req: Request, res: Response, next: NextFunction) {
  try {
    const attempt = await TestAttempt.findOne({
      where: {
        id: req.params.attemptId,
        userId: req.user!.userId,
      },
    });
    if (!attempt) return res.status(404).json({ success: false, message: 'Result not found' });
    return res.json({ success: true, data: attempt });
  } catch (error) {
    next(error);
  }
}

export async function getMyAttempts(req: Request, res: Response, next: NextFunction) {
  try {
    const attempts = await TestAttempt.findAll({
      where: { userId: req.user!.userId },
      order: [['createdAt', 'DESC']],
    });
    return res.json({ success: true, data: attempts });
  } catch (error) {
    next(error);
  }
}
