import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { getRealIP } from './auth';

export function createGlobalRateLimit() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function createAuthRateLimit(
  logAudit: (user: any, action: string, details: any, req: Request) => Promise<void>
) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    message: 'Too many login attempts',
    handler: async (req: Request, res: Response) => {
      await logAudit(null, 'excessive_login_attempts', {
        email: req.body.email,
        ip: getRealIP(req)
      }, req);
      res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }
  });
}