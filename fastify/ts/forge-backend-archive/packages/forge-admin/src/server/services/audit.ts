import type { Pool } from 'pg';
import type { Request } from 'express';
import { getRealIP } from '../middleware/auth';
import type { User } from '../middleware/auth';

export function createAuditLogger(pool: Pool) {
  return async function logAudit(
    user: User | null,
    action: string,
    details: Record<string, any> = {},
    req: Request
  ): Promise<void> {
    try {
      const realIP = getRealIP(req);
      const threatScore = req.headers['cf-threat-score'] ? 
        parseInt(req.headers['cf-threat-score'] as string) : null;
      
      await pool.query(
        `INSERT INTO admin_audit_log 
         (user_id, user_email, action, details, ip_address, user_agent, 
          cf_ray, cf_country, cf_colo, threat_score, is_tor, success)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
        [
          user?.id || null,
          user?.email || 'anonymous',
          action,
          JSON.stringify(details),
          realIP,
          req.get('user-agent') || null,
          req.headers['cf-ray'] || null,
          req.headers['cf-ipcountry'] || null,
          req.headers['cf-colo'] || null,
          threatScore,
          req.headers['cf-tor'] === 'true',
        ]
      );
    } catch (error) {
      console.error('[audit] Failed to log:', error);
    }
  };
}