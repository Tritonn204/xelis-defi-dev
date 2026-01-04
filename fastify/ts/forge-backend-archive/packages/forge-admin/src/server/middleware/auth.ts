import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import type { Config } from '../config';

export interface User {
  id: number;
  email: string;
  full_name?: string;
}

export interface JWTPayload {
  id: number;
  email: string;
  v: number;
  ip?: string;
  iat?: number;
  exp?: number;
}

export function getRealIP(req: Request): string {
  return (req.headers['cf-connecting-ip'] as string) || 
         (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 
         (req.headers['x-real-ip'] as string) ||
         req.socket.remoteAddress ||
         req.ip ||
         'unknown';
}

export function createAuthMiddleware(
  pool: Pool, 
  config: Config,
  logAudit: (user: User | null, action: string, details: any, req: Request) => Promise<void>
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies.auth_token;
      
      if (!token) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const decoded = jwt.verify(token, config.JWT_SECRET) as JWTPayload;
      const realIP = getRealIP(req);
      
      if (config.STRICT_IP_CHECK && decoded.ip && decoded.ip !== realIP) {
        await logAudit(null, 'ip_mismatch_rejected', { 
          token_ip: decoded.ip,
          request_ip: realIP,
          user_email: decoded.email
        }, req);
        
        res.clearCookie('auth_token');
        return res.status(401).json({ 
          error: 'IP address changed. Please log in again.',
          code: 'IP_MISMATCH'
        });
      }
      
      const { rows } = await pool.query(
        `SELECT id, email, full_name, token_version 
         FROM admin_users 
         WHERE id = $1 AND is_active = true`,
        [decoded.id]
      );

      if (!rows.length) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }

      if (decoded.v !== rows[0].token_version) {
        await logAudit(null, 'token_version_mismatch', {
          user_email: decoded.email,
          token_version: decoded.v,
          current_version: rows[0].token_version
        }, req);
        
        res.clearCookie('auth_token');
        return res.status(401).json({ 
          error: 'Session invalidated. Please log in again.',
          code: 'TOKEN_REVOKED'
        });
      }

      (req as any).user = rows[0];
      next();
      
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.clearCookie('auth_token');
        return res.status(401).json({ 
          error: 'Token expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}