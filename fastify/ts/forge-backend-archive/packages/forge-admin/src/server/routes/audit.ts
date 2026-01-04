import { Router } from 'express';
import type { CoreServices } from '../factory/core';

export interface AuditRouteDeps {
  core: CoreServices;
}

export function buildAuditDeps(core: CoreServices): AuditRouteDeps {
  return {
    core,
  };
}

export function createAuditRoutes(deps: AuditRouteDeps): Router {
  const router = Router();
  const { core } = deps;
  router.get('/audit/security-events', core.authenticate, async (req, res) => {
    const user = (req as any).user;
    const { hours = 24 } = req.query;
    
    try {
      const { rows } = await core.pool.query(
        `SELECT 
          action,
          COUNT(*) as count,
          COUNT(DISTINCT ip_address) as unique_ips,
          COUNT(DISTINCT user_email) as unique_users,
          MAX(threat_score) as max_threat_score,
          BOOL_OR(is_tor) as had_tor_access
        FROM admin_audit_log
        WHERE created_at > NOW() - INTERVAL '${parseInt(hours as string)} hours'
          AND action IN (
            'failed_login_invalid_user',
            'failed_login_invalid_password', 
            'csrf_validation_failed',
            'rate_limit_exceeded',
            'ip_mismatch_rejected',
            'token_version_mismatch',
            'high_threat_blocked',
            'tor_blocked'
          )
        GROUP BY action
        ORDER BY count DESC`,
        []
      );
      
      res.json(rows);
    } catch (error) {
      console.error('[security-events] Error:', error);
      res.status(500).json({ error: 'Failed to fetch security events' });
    }
  });

  // Get suspicious IPs
  router.get('/audit/suspicious-ips', core.authenticate, async (req, res) => {
    const user = (req as any).user;
    
    try {
      const { rows } = await core.pool.query(
        `SELECT 
          ip_address,
          COUNT(*) as total_requests,
          COUNT(DISTINCT user_email) as users_attempted,
          COUNT(DISTINCT action) as unique_actions,
          MAX(threat_score) as max_threat_score,
          BOOL_OR(is_tor) as used_tor,
          ARRAY_AGG(DISTINCT cf_country) as countries,
          MIN(created_at) as first_seen,
          MAX(created_at) as last_seen
        FROM admin_audit_log
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND (
            threat_score > 30 OR
            is_tor = true OR
            action LIKE 'failed_%' OR
            action LIKE '%blocked%'
          )
        GROUP BY ip_address
        HAVING COUNT(*) > 5
        ORDER BY total_requests DESC
        LIMIT 50`,
        []
      );
      
      res.json(rows);
    } catch (error) {
      console.error('[suspicious-ips] Error:', error);
      res.status(500).json({ error: 'Failed to fetch suspicious IPs' });
    }
  });

  // User activity summary
  router.get('/audit/user-activity/:userId', core.authenticate, async (req, res) => {
    const user = (req as any).user;
    const { userId } = req.params;
    const { days = 7 } = req.query;
    
    try {
      const { rows } = await core.pool.query(
        `SELECT 
          DATE(created_at) as date,
          action,
          COUNT(*) as count,
          COUNT(DISTINCT ip_address) as unique_ips,
          ARRAY_AGG(DISTINCT cf_country) as countries
        FROM admin_audit_log
        WHERE user_id = $1
          AND created_at > NOW() - INTERVAL '${parseInt(days as string)} days'
        GROUP BY DATE(created_at), action
        ORDER BY date DESC, count DESC`,
        [userId]
      );
      
      res.json(rows);
    } catch (error) {
      console.error('[user-activity] Error:', error);
      res.status(500).json({ error: 'Failed to fetch user activity' });
    }
  });

  return router;
}