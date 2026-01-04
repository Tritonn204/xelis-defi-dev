import { Router } from 'express';
import type { CoreServices } from '../factory/core';
import { sanitizeResponse } from '../services/sanitization';
import { isWriteQuery } from '../services/sql';

// Local SQL validation for super-admin
function validateSuperUserSQL(sql: string): { valid: boolean; error?: string } {
  // Super-admin specific validation
  const DENY_PATTERNS = [
    { 
      pattern: /DROP\s+DATABASE/i, 
      message: 'DROP DATABASE not allowed. Use CLI for database operations.' 
    },
    { 
      pattern: /DROP\s+SCHEMA/i, 
      message: 'DROP SCHEMA not allowed. Use migrations for schema changes.' 
    },
    { 
      pattern: /(admin_users\.password_hash|admin_users\.totp_secret|admin_users\.backup_codes)/i,
      message: 'Direct access to sensitive authentication columns not allowed'
    },
    {
      pattern: /DELETE\s+FROM\s+admin_users/i,
      message: 'Use dedicated user management endpoint for deleting admin users'
    }
  ];
  
  for (const { pattern, message } of DENY_PATTERNS) {
    if (pattern.test(sql)) {
      return { valid: false, error: message };
    }
  }
  return { valid: true };
}

export interface SuperAdminRouteDeps {
  core: CoreServices;
}

export function buildSuperAdminDeps(core: CoreServices): SuperAdminRouteDeps {
  return {
    core,
  };
}

export function createSuperAdminRoutes(deps: SuperAdminRouteDeps): Router {
  const router = Router();
  const { core } = deps;
  
  router.get('/admin/super-users', 
    core.authenticate, 
    core.requirePrimaryMaintainer, 
    async (req, res) => {
      try {
        const { rows } = await core.pool.query(
          `SELECT 
            su.id, su.granted_at, su.notes,
            u.id as user_id, u.email, u.full_name, u.is_active,
            g.email as granted_by_email, g.full_name as granted_by_name
          FROM admin_super_users su
          JOIN admin_users u ON u.id = su.user_id
          LEFT JOIN admin_users g ON g.id = su.granted_by
          ORDER BY su.granted_at DESC`
        );
        
        res.json(rows);
      } catch (error) {
        console.error('[list-super-users] Error:', error);
        res.status(500).json({ error: 'Failed to fetch super users' });
      }
    }
  );

  router.post('/admin/super-users', 
    core.csrfProtection,
    core.authenticate, 
    core.requirePrimaryMaintainer, 
    async (req, res) => {
      const user = (req as any).user;
      const { user_id, notes } = req.body;
      
      try {
        if (!user_id) {
          return res.status(400).json({ error: 'user_id required' });
        }
        
        // Verify target user exists and is active
        const { rows: targetUsers } = await core.pool.query(
          'SELECT id, email, full_name FROM admin_users WHERE id = $1 AND is_active = true',
          [user_id]
        );
        
        if (!targetUsers.length) {
          return res.status(404).json({ error: 'User not found or inactive' });
        }
        
        // Grant super user access
        const { rows } = await core.pool.query(
          `INSERT INTO admin_super_users (user_id, granted_by, notes)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id) DO UPDATE SET
            granted_by = EXCLUDED.granted_by,
            granted_at = NOW(),
            notes = EXCLUDED.notes
          RETURNING id`,
          [user_id, user.id, notes || null]
        );
        
        await core.logAudit(user, 'grant_super_user', {
          target_user_id: user_id,
          target_email: targetUsers[0].email,
          notes
        }, req);
        
        res.json({
          success: true,
          id: rows[0].id,
          message: `Super user access granted to ${targetUsers[0].email}`
        });
        
      } catch (error) {
        console.error('[grant-super-user] Error:', error);
        res.status(500).json({ error: 'Failed to grant super user access' });
      }
    }
  );

  router.delete('/admin/super-users/:userId', 
    core.csrfProtection,
    core.authenticate, 
    core.requirePrimaryMaintainer, 
    async (req, res) => {
      const user = (req as any).user;
      const { userId } = req.params;
      
      try {
        // Get user info before deleting
        const { rows: targetUsers } = await core.pool.query(
          `SELECT u.email, u.full_name
          FROM admin_users u
          JOIN admin_super_users su ON su.user_id = u.id
          WHERE u.id = $1`,
          [userId]
        );
        
        if (!targetUsers.length) {
          return res.status(404).json({ error: 'Super user entry not found' });
        }
        
        // Prevent revoking primary maintainer's access
        const primaryMaintainerEmail = core.config.PRIMARY_MAINTAINER_EMAIL;

        if (primaryMaintainerEmail && 
            targetUsers[0].email.toLowerCase() === primaryMaintainerEmail.toLowerCase()) {
          return res.status(403).json({ 
            error: 'Cannot revoke primary maintainer access' 
          });
        }
        
        // Revoke access
        await core.pool.query(
          'DELETE FROM admin_super_users WHERE user_id = $1',
          [userId]
        );
        
        await core.logAudit(user, 'revoke_super_user', {
          target_user_id: userId,
          target_email: targetUsers[0].email
        }, req);
        
        res.json({ success: true });
        
      } catch (error) {
        console.error('[revoke-super-user] Error:', error);
        res.status(500).json({ error: 'Failed to revoke super user access' });
      }
    }
  );
  
  router.post('/admin/execute-sql', 
    core.csrfProtection,
    core.authenticate, 
    core.requireSuperUser,
    async (req, res) => {
      const user = (req as any).user;
      const { sql, useTransaction = true } = req.body;
      
      const startTime = Date.now();
      
      try {
        if (!sql || typeof sql !== 'string') {
          return res.status(400).json({ error: 'SQL query required' });
        }
        
        const trimmedSql = sql.trim();
        
        if (!trimmedSql) {
          return res.status(400).json({ error: 'Empty SQL query' });
        }
        
        // Validate against deny patterns
        const validation = validateSuperUserSQL(trimmedSql);
        if (!validation.valid) {
          await core.logAudit(user, 'sql_execution_blocked', {
            reason: validation.error,
            sql: trimmedSql.substring(0, 500)
          }, req);
          
          return res.status(403).json({ 
            error: validation.error,
            code: 'SQL_BLOCKED'
          });
        }
        
        const client = await core.pool.connect();
        
        try {
          if (useTransaction) {
            await client.query('BEGIN');
          }
          
          // Execute the query
          const result = await client.query(trimmedSql);
          
          if (useTransaction) {
            await client.query('COMMIT');
          }
          
          const executionTime = Date.now() - startTime;
          const isWrite = isWriteQuery(trimmedSql);
          
          // Sanitize results if querying sensitive tables
          let sanitizedRows = result.rows;
          const tableMatch = trimmedSql.match(/FROM\s+(\w+)/i);
          if (tableMatch) {
            const tableName = tableMatch[1];
            sanitizedRows = sanitizeResponse(tableName, result.rows);
          }
          
          await core.logAudit(user, 'execute_raw_sql', {
            sql: trimmedSql.substring(0, 500),
            execution_time_ms: executionTime,
            rows_affected: result.rowCount,
            is_write: isWrite,
            used_transaction: useTransaction
          }, req);
          
          res.json({
            success: true,
            rowCount: result.rowCount || 0,
            rows: sanitizedRows,
            fields: result.fields?.map(f => ({
              name: f.name,
              dataTypeID: f.dataTypeID
            })),
            executionTimeMs: executionTime,
            command: result.command
          });
          
        } catch (execError: any) {
          if (useTransaction) {
            await client.query('ROLLBACK');
          }
          throw execError;
        } finally {
          client.release();
        }
        
      } catch (error: any) {
        const executionTime = Date.now() - startTime;
        
        await core.logAudit(user, 'execute_raw_sql_failed', {
          sql: sql?.substring(0, 500),
          error: error.message,
          execution_time_ms: executionTime
        }, req);
        
        res.status(500).json({ 
          error: 'SQL execution failed',
          details: error.message,
          code: error.code,
          position: error.position
        });
      }
    }
  );

  router.post('/admin/validate-sql', 
    core.csrfProtection,
    core.authenticate, 
    core.requireSuperUser,
    async (req, res) => {
      const { sql } = req.body;
      
      try {
        if (!sql || typeof sql !== 'string') {
          return res.status(400).json({ error: 'SQL query required' });
        }
        
        const trimmedSql = sql.trim();
        
        // Check deny patterns
        const validation = validateSuperUserSQL(trimmedSql);
        if (!validation.valid) {
          return res.json({
            valid: false,
            blocked: true,
            error: validation.error
          });
        }
        
        // Use EXPLAIN to validate syntax without executing
        const { rows } = await core.pool.query(`EXPLAIN ${trimmedSql}`);
        
        const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(trimmedSql);
        
        res.json({
          valid: true,
          blocked: false,
          isWrite,
          plan: rows
        });
        
      } catch (error: any) {
        res.json({
          valid: false,
          error: error.message,
          code: error.code,
          position: error.position
        });
      }
    }
  );

  return router;
}