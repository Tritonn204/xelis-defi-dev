import { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { Config } from '../config';
import type { User } from './auth';

// Extend request with permission flags
declare global {
  namespace Express {
    interface Request {
      isSuperUser?: boolean;
      isPrimaryMaintainer?: boolean;
      superUserInfo?: {
        granted_at: Date;
        granted_by_email: string;
        notes?: string;
      };
    }
  }
}

/**
 * Requires user to be the primary maintainer (from Docker secret)
 */
export function createRequirePrimaryMaintainer(
  config: Config,
  logAudit: (user: User | null, action: string, details: any, req: Request) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as User;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const primaryEmail = config.PRIMARY_MAINTAINER_EMAIL;
    
    if (!primaryEmail) {
      console.error('[permissions] PRIMARY_MAINTAINER_EMAIL not configured');
      return res.status(500).json({ 
        error: 'PRIMARY_MAINTAINER_EMAIL not configured' 
      });
    }
    
    if (user.email.toLowerCase() !== primaryEmail.toLowerCase()) {
      logAudit(user, 'unauthorized_primary_maintainer_access', {
        endpoint: req.path
      }, req);
      
      return res.status(403).json({ 
        error: 'Only the primary maintainer can access this endpoint',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }
    
    req.isPrimaryMaintainer = true;
    next();
  };
}

/**
 * Requires user to be primary maintainer OR in super_users table
 * Blocks request if neither
 */
export function createRequireSuperUser(
  pool: Pool,
  config: Config,
  logAudit: (user: User | null, action: string, details: any, req: Request) => Promise<void>
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as User;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
      // Check if primary maintainer
      const primaryEmail = config.PRIMARY_MAINTAINER_EMAIL;
      const isPrimaryMaintainer = primaryEmail && 
                                  user.email.toLowerCase() === primaryEmail.toLowerCase();
      
      if (isPrimaryMaintainer) {
        req.isSuperUser = true;
        req.isPrimaryMaintainer = true;
        return next();
      }
      
      // Check super_users table
      const { rows } = await pool.query(
        `SELECT su.id, su.granted_at, su.notes,
                g.email as granted_by_email, g.full_name as granted_by_name
         FROM admin_super_users su
         LEFT JOIN admin_users g ON g.id = su.granted_by
         WHERE su.user_id = $1`,
        [user.id]
      );
      
      if (rows.length > 0) {
        req.isSuperUser = true;
        req.isPrimaryMaintainer = false;
        req.superUserInfo = rows[0];
        return next();
      }
      
      // Not authorized
      await logAudit(user, 'unauthorized_super_user_access', {
        endpoint: req.path
      }, req);
      
      return res.status(403).json({ 
        error: 'Super user access required',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
      
    } catch (error) {
      console.error('[permissions] Super user check failed:', error);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/**
 * Non-blocking check - just sets flags on request
 * Used when UI needs to know permissions but doesn't block access
 */
export function createCheckSuperUser(
  pool: Pool,
  config: Config
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as User;
    
    if (!user) {
      req.isSuperUser = false;
      req.isPrimaryMaintainer = false;
      return next();
    }
    
    try {
      // Check if primary maintainer
      const primaryEmail = config.PRIMARY_MAINTAINER_EMAIL;
      const isPrimaryMaintainer = primaryEmail && 
                                  user.email.toLowerCase() === primaryEmail.toLowerCase();
      
      if (isPrimaryMaintainer) {
        req.isSuperUser = true;
        req.isPrimaryMaintainer = true;
      } else {
        // Check super_users table
        const { rows } = await pool.query(
          'SELECT id FROM admin_super_users WHERE user_id = $1',
          [user.id]
        );
        req.isSuperUser = rows.length > 0;
        req.isPrimaryMaintainer = false;
      }
      
    } catch (error) {
      console.error('[permissions] Check super user failed:', error);
      req.isSuperUser = false;
      req.isPrimaryMaintainer = false;
    }
    
    next();
  };
}