import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { Question } from '../models/Question';
import { McpService } from '../services/mcpService';
import { CertificationType, DifficultyLevel, QuestionType, SkillSection } from '../types';

const mcpService = new McpService();

export async function getQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      certification,
      section,
      questionType,
      difficulty,
      search,
      page = '1',
      limit = '20',
    } = req.query as Record<string, string>;

    const where: Record<string, unknown> = { isActive: true };
    if (certification) where.certification = certification;
    if (section) where.section = section;
    if (questionType) where.questionType = questionType;
    if (difficulty) where.difficulty = difficulty;
    if (search) where.title = { [Op.iLike]: `%${search}%` };

    const pageNum = Math.max(parseInt(page, 10), 1);
    const limitNum = Math.min(parseInt(limit, 10), 100);
    const offset = (pageNum - 1) * limitNum;

    const { count, rows } = await Question.findAndCountAll({
      where,
      limit: limitNum,
      offset,
      order: [['createdAt', 'DESC']],
    });

    return res.json({
      success: true,
      data: {
        questions: rows,
        total: count,
        page: pageNum,
        totalPages: Math.ceil(count / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getQuestionById(req: Request, res: Response, next: NextFunction) {
  try {
    const question = await Question.findByPk(req.params.id);
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    return res.json({ success: true, data: question });
  } catch (error) {
    next(error);
  }
}

export async function createQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const question = await Question.create({ ...req.body, source: 'MANUAL' });
    return res.status(201).json({ success: true, data: question });
  } catch (error) {
    next(error);
  }
}

export async function updateQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const question = await Question.findByPk(req.params.id);
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    await question.update(req.body);
    return res.json({ success: true, data: question });
  } catch (error) {
    next(error);
  }
}

export async function deleteQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const question = await Question.findByPk(req.params.id);
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    await question.update({ isActive: false });
    return res.json({ success: true, message: 'Question deactivated' });
  } catch (error) {
    next(error);
  }
}

export async function syncQuestionsFromMcp(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      certification = 'PTE',
      section,
      questionType,
      difficulty,
      limit = 50,
    } = req.body as {
      certification?: CertificationType;
      section?: SkillSection;
      questionType?: QuestionType;
      difficulty?: DifficultyLevel;
      limit?: number;
    };

    const mcpQuestions = await mcpService.fetchQuestions({
      certification,
      section,
      questionType,
      difficulty,
      limit,
    });

    let created = 0;
    let updated = 0;

    for (const q of mcpQuestions) {
      const [instance, wasCreated] = await Question.findOrCreate({
        where: { externalId: q.externalId },
        defaults: { ...q, source: 'MCP', mcpFetchedAt: new Date() },
      });

      if (!wasCreated) {
        await instance.update({ ...q, mcpFetchedAt: new Date() });
        updated++;
      } else {
        created++;
      }
    }

    return res.json({
      success: true,
      message: `MCP sync complete: ${created} created, ${updated} updated`,
      data: { created, updated, total: mcpQuestions.length },
    });
  } catch (error) {
    next(error);
  }
}
