import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config/env.js';
import { HttpError } from '../errors.js';

export interface AuthedRequest extends Request {
  admin?: boolean;
  deviceToken?: string;
}

export function adminAuth(config: AppConfig) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || token !== config.adminApiKey) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Admin authentication failed. Send Authorization: Bearer <ADMIN_API_KEY>.'));
      return;
    }
    req.admin = true;
    next();
  };
}

export function readDeviceToken(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  if (header.startsWith('Device ')) req.deviceToken = header.slice(7).trim();
  next();
}
