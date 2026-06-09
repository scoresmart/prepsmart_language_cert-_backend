import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { env } from '../config/env';
import { ApiResponse, JwtPayload, UserRole } from '../types';

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, password, role = 'STUDENT' } = req.body;

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      const response: ApiResponse = { success: false, message: 'Email already registered' };
      return res.status(409).json(response);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash, role: role as UserRole });

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    const response: ApiResponse = {
      success: true,
      data: { user: user.toSafeJSON(), token },
      message: 'Registration successful',
    };
    return res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    return res.json({
      success: true,
      data: { user: user.toSafeJSON(), token },
    });
  } catch (error) {
    next(error);
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const newToken = signToken({ userId: decoded.userId, email: decoded.email, role: decoded.role });
    return res.json({ success: true, data: { token: newToken } });
  } catch (error) {
    next(error);
  }
}

export function logout(_req: Request, res: Response) {
  return res.json({ success: true, message: 'Logged out successfully' });
}
