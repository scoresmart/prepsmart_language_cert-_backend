import dotenv from 'dotenv';

dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  CORS_ORIGIN:
    process.env.CORS_ORIGIN ||
    'http://localhost:5174,http://localhost:5173,http://localhost:3000',
  CORS_ALLOW_VERCEL: process.env.CORS_ALLOW_VERCEL !== 'false',
  CORS_ALLOW_RAILWAY: process.env.CORS_ALLOW_RAILWAY !== 'false',
  CORS_ALLOW_LOCALHOST: process.env.CORS_ALLOW_LOCALHOST === 'true',

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',

  // JWT (Supabase JWT secret for verifying user tokens)
  JWT_SECRET: process.env.JWT_SECRET || 'change-this-secret-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
};
