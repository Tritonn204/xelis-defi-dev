import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createAuthRateLimit } from '../middleware/rate-limit';
import type { CoreServices } from '../factory/core';
import { getRealIP } from '../middleware/auth';

// This route's specific dependencies
export interface AuthRouteDeps {
  core: CoreServices;
  authRateLimit: ReturnType<typeof createAuthRateLimit>;
}

// Build this route's dependencies from core
export function buildAuthDeps(core: CoreServices): AuthRouteDeps {
  return {
    core,
    authRateLimit: createAuthRateLimit(core.logAudit),
  };
}

// Create the routes
export function createAuthRoutes(deps: AuthRouteDeps): Router {
  const router = Router();
  const { core, authRateLimit } = deps;
  
  // GET /api/csrf-token
  router.get('/csrf-token', core.csrfProtection, (req: Request, res: Response) => {
    res.json({ csrfToken: req.csrfToken() });
  });
  
  // POST /api/auth/login
  router.post('/auth/login', 
    authRateLimit, 
    core.csrfProtection, 
    async (req: Request, res: Response) => {
      try {
        const { email, password, totp } = req.body;

        if (!email || !password) {
          return res.status(400).json({ error: 'Email and password required' });
        }

        const { rows } = await core.pool.query(
          `SELECT id, email, password_hash, full_name, token_version,
                  totp_secret, is_2fa_enabled
          FROM admin_users 
          WHERE email = $1 AND is_active = true`,
          [email.toLowerCase().trim()]
        );

        if (!rows.length) {
          await bcrypt.compare(password, '$2b$10$abcdefghijklmnopqrstuv.dummy.hash');
          
          await core.logAudit(null, 'failed_login_invalid_user', { 
            email,
            ip: core.getRealIP(req)
          }, req);
          
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
          await core.logAudit(user, 'failed_login_invalid_password', { 
            ip: core.getRealIP(req)
          }, req);
          
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const realIP = core.getRealIP(req);
        const token = jwt.sign(
          { 
            id: user.id, 
            email: user.email,
            v: user.token_version,
            ip: realIP
          },
          core.config.JWT_SECRET,
          { expiresIn: '4h' }
        );

        res.cookie('auth_token', token, {
          httpOnly: true,
          secure: core.config.CSRF_SECURE_COOKIE,
          sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'strict',
          maxAge: 4 * 60 * 60 * 1000,
          path: '/',
        });

        await core.pool.query(
          `UPDATE admin_users 
          SET last_login = now(), last_login_ip = $1 
          WHERE id = $2`,
          [realIP, user.id]
        );

        await core.logAudit(user, 'login_success', { 
          ip: realIP,
          has_2fa: user.is_2fa_enabled
        }, req);

        res.json({
          user: { 
            id: user.id, 
            email: user.email, 
            full_name: user.full_name,
            has_2fa: user.is_2fa_enabled
          },
          csrfToken: req.csrfToken(),
          expiresAt: Date.now() + (4 * 60 * 60 * 1000)
        });

      } catch (error) {
        console.error('[login] Error:', error);
        res.status(500).json({ error: 'Login failed' });
      }
    }
  );
  
  // POST /api/auth/logout
  router.post('/auth/logout', 
    core.csrfProtection, 
    core.authenticate, 
    async (req: Request, res: Response) => {
      const user = (req as any).user;
      
      res.clearCookie('auth_token', {
        httpOnly: true,
        secure: core.config.CSRF_SECURE_COOKIE,
        sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'strict',
        path: '/'
      });
      
      await core.logAudit(user, 'logout', {}, req);
      
      res.json({ success: true, message: 'Logged out successfully' });
    }
  );
  
  // POST /api/auth/refresh
  router.post('/api/auth/refresh', 
    core.csrfProtection, 
    core.authenticate, 
    async (req, res) => {
      const user = (req as any).user;
      
      try {
        const { rows } = await core.pool.query(
          'SELECT id, email, token_version FROM admin_users WHERE id = $1 AND is_active = true',
          [user.id]
        );
        
        if (!rows.length) {
          return res.status(401).json({ error: 'User not found' });
        }
        
        const realIP = getRealIP(req);
        
        const newToken = jwt.sign(
          { 
            id: rows[0].id, 
            email: rows[0].email,
            v: rows[0].token_version,
            ip: realIP
          },
          core.config.JWT_SECRET,
          { expiresIn: '4h' }
        );
        
        res.cookie('auth_token', newToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'strict',
          maxAge: 4 * 60 * 60 * 1000,
          path: '/',
        });
        
        await core.logAudit(user, 'token_refresh', {}, req);
        
        res.json({ 
          success: true,
          expiresAt: Date.now() + (4 * 60 * 60 * 1000)
        });
        
      } catch (error) {
        console.error('[refresh] Error:', error);
        res.status(500).json({ error: 'Token refresh failed' });
      }
    }
  );
    
  // POST /api/auth/verify
  router.post('/api/auth/verify', 
    core.csrfProtection, 
    core.authenticate, 
    (req, res) => {
      res.json({ 
        user: (req as any).user,
        csrfToken: req.csrfToken ? req.csrfToken() : undefined
      });
    }
  );

  // GET /api/auth/permissions
  router.get('/api/auth/permissions', 
    core.authenticate, 
    core.checkSuperUser,
    (req, res) => {
      const user = (req as any).user;
      
      res.json({
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name
        },
        is_super_user: (req as any).isSuperUser || false,
        is_primary_maintainer: (req as any).isPrimaryMaintainer || false
      });
    }
  );

  return router;
}