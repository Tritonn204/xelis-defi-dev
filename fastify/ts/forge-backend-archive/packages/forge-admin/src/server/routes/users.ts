import { Router, Request, Response } from 'express';
import { CoreServices } from '../factory/core';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export interface UserRouteDeps {
  core: CoreServices,
}

export function buildUserDeps(core: CoreServices): UserRouteDeps {
  return {
    core,
  };
}

export function createUserRoutes(deps: UserRouteDeps): Router {
  const router = Router();
  const { core } = deps;

  router.get('/admin/users', core.authenticate, async (req, res) => {
    const user = (req as any).user;
    
    try {
      const { rows } = await core.pool.query(
        `SELECT 
          id, email, full_name, is_active, is_2fa_enabled,
          last_login, last_login_ip, created_at, updated_at
        FROM admin_users
        ORDER BY created_at DESC`
      );
      
      await core.logAudit(user, 'list_admin_users', {}, req);
      res.json(rows);
    } catch (error) {
      console.error('[admin-users] Error:', error);
      res.status(500).json({ error: 'Failed to fetch admin users' });
    }
  });

  router.get('/admin/users/:id', core.authenticate, async (req, res) => {
    const user = (req as any).user;
    const { id } = req.params;
    
    try {
      const { rows } = await core.pool.query(
        `SELECT 
          id, email, full_name, is_active, is_2fa_enabled,
          last_login, last_login_ip, created_at, updated_at
        FROM admin_users
        WHERE id = $1`,
        [id]
      );
      
      if (!rows.length) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      await core.logAudit(user, 'view_admin_user', { target_user_id: id }, req);
      res.json(rows[0]);
    } catch (error) {
      console.error('[admin-user] Error:', error);
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  });

  router.post('/admin/invite', 
    core.csrfProtection, 
    core.authenticate, 
    core.requirePrimaryMaintainer, 
    async (req, res) => {
      const { email, full_name } = req.body;
      const user = (req as any).user;
      
      try {
        // Validate email
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: 'Valid email required' });
        }
        
        const normalizedEmail = email.toLowerCase().trim();
        
        // Check if user already exists
        const { rows: existing } = await core.pool.query(
          'SELECT id FROM admin_users WHERE email = $1',
          [normalizedEmail]
        );
        
        if (existing.length > 0) {
          return res.status(400).json({ 
            error: 'User with this email already exists' 
          });
        }
        
        // Check for pending invite
        const { rows: pendingInvites } = await core.pool.query(
          `SELECT id FROM admin_user_invites 
          WHERE email = $1 
            AND consumed_at IS NULL 
            AND expires_at > NOW()`,
          [normalizedEmail]
        );
        
        if (pendingInvites.length > 0) {
          return res.status(400).json({ 
            error: 'Active invite already exists for this email' 
          });
        }
        
        // Generate cryptographically secure token
        const token = crypto.randomBytes(32).toString('base64url');
        
        // 7 day expiry
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        
        // Store invite
        const { rows: [invite] } = await core.pool.query(
          `INSERT INTO admin_user_invites 
          (email, token, invited_by, expires_at, full_name)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, token, expires_at`,
          [normalizedEmail, token, user.id, expiresAt, full_name || null]
        );
        
        // MARKER
        // Build registration URL
        const registrationUrl = `${core.config.BASE_URL}/register?token=${token}`;
        
        await core.logAudit(user, 'invite_created', {
          invite_id: invite.id,
          invited_email: normalizedEmail,
          expires_at: expiresAt
        }, req);
        
        // TODO: Send email here (see email integration below)
        // For now, return the URL (you'll copy-paste it)
        
        res.json({
          success: true,
          invite_id: invite.id,
          email: normalizedEmail,
          registration_url: registrationUrl,
          expires_at: expiresAt,
          message: 'Registration link generated. Send this URL to the user via secure channel.'
        });
        
      } catch (error) {
        console.error('[invite] Error:', error);
        res.status(500).json({ error: 'Failed to generate invite' });
      }
    }
  );

  router.get('/admin/invites', 
    core.authenticate, 
    core.requirePrimaryMaintainer, 
    async (req, res) => {
      try {
        const { rows } = await core.pool.query(
          `SELECT 
            i.id, i.email, i.full_name, i.invited_at, i.expires_at,
            i.consumed_at, i.consumed_by_ip,
            u.email as invited_by_email, u.full_name as invited_by_name,
            CASE 
              WHEN i.consumed_at IS NOT NULL THEN 'consumed'
              WHEN i.expires_at < NOW() THEN 'expired'
              ELSE 'active'
            END as status
          FROM admin_user_invites i
          LEFT JOIN admin_users u ON u.id = i.invited_by
          ORDER BY i.invited_at DESC
          LIMIT 100`
        );
        
        res.json(rows);
      } catch (error) {
        console.error('[list-invites] Error:', error);
        res.status(500).json({ error: 'Failed to fetch invites' });
      }
    }
  );

  router.delete('/admin/invites/:id', 
    core.csrfProtection,
    core.authenticate, 
    core.requirePrimaryMaintainer, 
    async (req, res) => {
      const user = (req as any).user;
      const { id } = req.params;
      
      try {
        const { rows } = await core.pool.query(
          `DELETE FROM admin_user_invites 
          WHERE id = $1 
            AND consumed_at IS NULL
          RETURNING email`,
          [id]
        );
        
        if (!rows.length) {
          return res.status(404).json({ 
            error: 'Invite not found or already consumed' 
          });
        }
        
        await core.logAudit(user, 'invite_revoked', {
          invite_id: id,
          email: rows[0].email
        }, req);
        
        res.json({ success: true });
      } catch (error) {
        console.error('[revoke-invite] Error:', error);
        res.status(500).json({ error: 'Failed to revoke invite' });
      }
    }
  );

  router.get('/register/validate/:token', async (req, res) => {
    try {
      const { token } = req.params;
      
      const { rows } = await core.pool.query(
        `SELECT email, full_name, expires_at 
        FROM admin_user_invites 
        WHERE token = $1 
          AND consumed_at IS NULL 
          AND expires_at > NOW()`,
        [token]
      );
      
      if (!rows.length) {
        return res.status(404).json({ 
          error: 'Invalid or expired registration link',
          code: 'INVALID_TOKEN'
        });
      }
      
      res.json({
        valid: true,
        email: rows[0].email,
        full_name: rows[0].full_name,
        expires_at: rows[0].expires_at
      });
      
    } catch (error) {
      console.error('[validate-token] Error:', error);
      res.status(500).json({ error: 'Token validation failed' });
    }
  });

  router.post('/register', core.csrfProtection, async (req, res) => {
    const { token, password, full_name } = req.body;
    
    try {
      // Validate inputs
      if (!token || !password) {
        return res.status(400).json({ 
          error: 'Token and password required' 
        });
      }
      
      if (password.length < 12) {
        return res.status(400).json({ 
          error: 'Password must be at least 12 characters' 
        });
      }
      
      // Use a transaction to ensure atomicity
      const client = await core.pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Get and lock the invite
        const { rows: invites } = await client.query(
          `SELECT id, email, full_name, invited_by
          FROM admin_user_invites 
          WHERE token = $1 
            AND consumed_at IS NULL 
            AND expires_at > NOW()
          FOR UPDATE`,
          [token]
        );
        
        if (!invites.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ 
            error: 'Invalid or expired registration link',
            code: 'INVALID_TOKEN'
          });
        }
        
        const invite = invites[0];
        
        // Check if user was created in the meantime
        const { rows: existingUsers } = await client.query(
          'SELECT id FROM admin_users WHERE email = $1',
          [invite.email]
        );
        
        if (existingUsers.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ 
            error: 'User already exists. Please login instead.' 
          });
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Create user
        const { rows: [newUser] } = await client.query(
          `INSERT INTO admin_users 
          (email, password_hash, full_name, is_active, token_version)
          VALUES ($1, $2, $3, true, 0)
          RETURNING id, email, full_name`,
          [
            invite.email, 
            passwordHash, 
            full_name || invite.full_name || null
          ]
        );
        
        // Mark invite as consumed
        const realIP = core.getRealIP(req);
        await client.query(
          `UPDATE admin_user_invites 
          SET consumed_at = NOW(), consumed_by_ip = $1 
          WHERE id = $2`,
          [realIP, invite.id]
        );
        
        await client.query('COMMIT');
        
        // Log the registration
        await core.logAudit(newUser, 'user_registered', {
          invited_by: invite.invited_by,
          ip: realIP
        }, req);
        
        res.json({
          success: true,
          message: 'Registration complete. You can now log in.',
          user: {
            id: newUser.id,
            email: newUser.email,
            full_name: newUser.full_name
          }
        });
        
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[register] Error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  return router;
}