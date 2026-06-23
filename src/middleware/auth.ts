import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';
import { AppRole, JwtPayload } from '../types';

const ADMIN_EMAILS = ['contact@scoresmartpte.com', 'scoresmartpte@gmail.com'];

function resolveRole(email: string | undefined, profileRole: AppRole | undefined): AppRole {
  if (email && ADMIN_EMAILS.includes(email.toLowerCase())) {
    return 'admin';
  }
  return profileRole || 'student';
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    // Verify against Supabase — this also checks expiry
    const { data, error } = await getSupabase().auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    // Pull role from profiles table
    const { data: profile } = await getSupabase()
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    req.user = {
      sub: data.user.id,
      email: data.user.email,
      role: resolveRole(data.user.email, profile?.role as AppRole | undefined),
    };
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

export function authorize(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role as AppRole)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    return next();
  };
}
