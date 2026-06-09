import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../config/database';

// POST /api/v1/auth/register
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, password, role = 'student' } = req.body;
    const supabase = getSupabase();

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });

    if (authError) {
      return res.status(400).json({ success: false, message: authError.message });
    }

    // Profile is auto-created via Supabase DB trigger; update name and role
    await supabase
      .from('profiles')
      .update({ name, role })
      .eq('id', authData.user.id);

    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: { userId: authData.user.id, email: authData.user.email },
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/auth/login
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;

    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    return res.json({
      success: true,
      data: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user: {
          id: data.user.id,
          email: data.user.email,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/auth/refresh
export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ success: false, message: 'refresh_token is required' });
    }

    const { data, error } = await getSupabase().auth.refreshSession({ refresh_token });
    if (error || !data.session) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    return res.json({
      success: true,
      data: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/auth/logout
export function logout(_req: Request, res: Response) {
  // Supabase tokens are stateless JWTs — client discards tokens on logout
  return res.json({ success: true, message: 'Logged out successfully' });
}

