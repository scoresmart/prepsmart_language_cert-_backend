import type { CorsOptions } from 'cors';
import { env } from './env';

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const VERCEL_ORIGIN = /^https:\/\/[a-z0-9-]+([.][a-z0-9-]+)*\.vercel\.app$/i;
const RAILWAY_ORIGIN = /^https:\/\/[a-z0-9-]+([.][a-z0-9-]+)*\.up\.railway\.app$/i;

function parseExplicitOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function matchesPattern(origin: string, pattern: string): boolean {
  if (!pattern.includes('*')) return origin === pattern;
  const re = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    'i',
  );
  return re.test(origin);
}

function isExplicitlyAllowed(origin: string, allowed: string[]): boolean {
  return allowed.some((entry) => matchesPattern(origin, entry));
}

export function buildCorsOptions(): CorsOptions {
  const explicitOrigins = parseExplicitOrigins(env.CORS_ORIGIN);
  const allowVercel = env.CORS_ALLOW_VERCEL;
  const allowRailway = env.CORS_ALLOW_RAILWAY;
  const allowLocalhost = env.NODE_ENV !== 'production' || env.CORS_ALLOW_LOCALHOST;

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isExplicitlyAllowed(origin, explicitOrigins)) {
        callback(null, origin);
        return;
      }

      if (allowVercel && VERCEL_ORIGIN.test(origin)) {
        callback(null, origin);
        return;
      }

      if (allowRailway && RAILWAY_ORIGIN.test(origin)) {
        callback(null, origin);
        return;
      }

      if (allowLocalhost && LOCALHOST_ORIGIN.test(origin)) {
        callback(null, origin);
        return;
      }

      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}
