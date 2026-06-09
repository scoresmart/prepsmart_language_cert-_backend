import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await User.findByPk(req.user!.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, data: user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, targetCertification, targetScore } = req.body;
    const user = await User.findByPk(req.user!.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await user.update({ name, targetCertification, targetScore });
    return res.json({ success: true, data: user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
}

export async function getAllUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await User.findAndCountAll({
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      attributes: { exclude: ['passwordHash'] },
    });

    return res.json({
      success: true,
      data: { users: rows, total: count, page, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await user.destroy();
    return res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    next(error);
  }
}
