import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import {
  generateSpeakingSets,
  GeneratedSpeakingSet,
  MAX_SETS_PER_RUN,
} from '../agents/speakingSetAgent';

/**
 * Generating a set takes a minute or more (Claude writes it, OpenAI draws the
 * picture), so a batch runs in the background: POST starts a job and GET
 * reports on it. Jobs live in memory — a restart loses the report, but every
 * set already saved stays saved, because each one is inserted as it completes.
 */

type GenerationJob = {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  requested: number;
  level: string;
  publish: boolean;
  created: GeneratedSpeakingSet[];
  log: string[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

const jobs = new Map<string, GenerationJob>();
let activeJobId: string | null = null;

// POST /api/v1/questions/speaking/sets/generate  { count?, level?, publish? }
export function startSpeakingSetGeneration(req: Request, res: Response, next: NextFunction) {
  try {
    if (activeJobId) {
      return res.status(409).json({
        success: false,
        message: 'A generation job is already running.',
        data: jobs.get(activeJobId),
      });
    }

    const count = Number(req.body?.count ?? 5);
    if (!Number.isInteger(count) || count < 1 || count > MAX_SETS_PER_RUN) {
      return res
        .status(400)
        .json({ success: false, message: `count must be a whole number from 1 to ${MAX_SETS_PER_RUN}.` });
    }
    const level = String(req.body?.level ?? 'B1').toUpperCase();
    if (!['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(level)) {
      return res.status(400).json({ success: false, message: 'level must be a CEFR level (A1–C2).' });
    }
    const publish = req.body?.publish === true;

    const job: GenerationJob = {
      id: randomUUID(),
      status: 'running',
      requested: count,
      level,
      publish,
      created: [],
      log: [],
      error: null,
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    jobs.set(job.id, job);
    activeJobId = job.id;

    const log = (message: string) => {
      job.log.push(`${new Date().toISOString()} ${message}`);
      console.log(`[speaking-set-agent ${job.id.slice(0, 8)}] ${message}`);
    };

    void generateSpeakingSets({ count, level, publish, createdBy: req.user?.sub ?? null, log })
      .then((created) => {
        job.created = created;
        job.status = 'succeeded';
      })
      .catch((error: unknown) => {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        log(`failed: ${job.error}`);
      })
      .finally(() => {
        job.finished_at = new Date().toISOString();
        activeJobId = null;
      });

    return res.status(202).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/questions/speaking/sets/generate/:jobId
export function getSpeakingSetGeneration(req: Request, res: Response) {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, message: 'Generation job not found' });
  return res.json({ success: true, data: job });
}
