import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { fromEnvOrFile } from '@forge-backend/shared/utils/env';
import { ensureRedis, redis } from '@forge-backend/shared/adapters/redis';

import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config
const JWT_SECRET = fromEnvOrFile('JWT_SECRET') || 'change-me-in-production';
const DATABASE_URL = fromEnvOrFile('DATABASE_URL');
const PORT = parseInt(process.env.PORT || '3001');
const CACHE_TTL = 30 * 60; // 30 minutes

const CSRF_SECURE_COOKIE = fromEnvOrFile('CSRF_SECURE_COOKIE') === 'true';
const STRICT_IP_CHECK = fromEnvOrFile('STRICT_IP_CHECK') === 'true';
const ADMIN_ALLOWED_IPS = fromEnvOrFile('ADMIN_ALLOWED_IPS')
  ?.split(',')
  .map(ip => ip.trim())
  .filter(Boolean) || [];

const SENSITIVE_COLUMNS: Record<string, string[]> = {
  admin_users: ['password_hash', 'totp_secret', 'backup_codes'],
  // Add other tables as needed
};

const PRIMARY_MAINTAINER_EMAIL = 
  fromEnvOrFile('PRIMARY_MAINTAINER_EMAIL') || 
  fromEnvOrFile('admin_email');

function sanitizeResponse(tableName: string, data: any): any {
  if (!SENSITIVE_COLUMNS[tableName]) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(row => sanitizeRow(tableName, row));
  }

  return sanitizeRow(tableName, data);
}

function sanitizeRow(tableName: string, row: any): any {
  if (!row || typeof row !== 'object') {
    return row;
  }

  const sensitiveColumns = SENSITIVE_COLUMNS[tableName] || [];
  const sanitized = { ...row };

  sensitiveColumns.forEach(column => {
    delete sanitized[column];
  });

  return sanitized;
}

const SUPER_USER_DENY_PATTERNS = [
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

function validateSuperUserSQL(sql: string): { valid: boolean; error?: string } {
  for (const { pattern, message } of SUPER_USER_DENY_PATTERNS) {
    if (pattern.test(sql)) {
      return { valid: false, error: message };
    }
  }
  return { valid: true };
}

async function requireSuperUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as any).user;
  
  try {    
    const isPrimaryMaintainer = PRIMARY_MAINTAINER_EMAIL && 
                                user.email.toLowerCase() === PRIMARY_MAINTAINER_EMAIL.toLowerCase();
    
    if (isPrimaryMaintainer) {
      (req as any).isSuperUser = true;
      (req as any).isPrimaryMaintainer = true;
      return next();
    }
    
    // Check if user is in super_users table
    const { rows } = await pool.query(
      `SELECT su.id, su.granted_at, su.notes,
              g.email as granted_by_email, g.full_name as granted_by_name
       FROM admin_super_users su
       LEFT JOIN admin_users g ON g.id = su.granted_by
       WHERE su.user_id = $1`,
      [user.id]
    );
    
    if (rows.length > 0) {
      (req as any).isSuperUser = true;
      (req as any).isPrimaryMaintainer = false;
      (req as any).superUserInfo = rows[0];
      return next();
    }
    
    // Not a super user
    await logAudit(user, 'unauthorized_super_user_access', {
      endpoint: req.path
    }, req);
    
    return res.status(403).json({ 
      error: 'Super user access required',
      code: 'INSUFFICIENT_PERMISSIONS'
    });
    
  } catch (error) {
    console.error('[super-user-check] Error:', error);
    return res.status(500).json({ error: 'Permission check failed' });
  }
}

async function checkSuperUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as any).user;
  
  try {
    const isPrimaryMaintainer = PRIMARY_MAINTAINER_EMAIL && 
                                user.email.toLowerCase() === PRIMARY_MAINTAINER_EMAIL.toLowerCase();
    
    if (isPrimaryMaintainer) {
      (req as any).isSuperUser = true;
      (req as any).isPrimaryMaintainer = true;
    } else {
      const { rows } = await pool.query(
        'SELECT id FROM admin_super_users WHERE user_id = $1',
        [user.id]
      );
      (req as any).isSuperUser = rows.length > 0;
      (req as any).isPrimaryMaintainer = false;
    }
    
    next();
  } catch (error) {
    console.error('[check-super-user] Error:', error);
    next(); // Continue anyway, just without super user flag
  }
}

function requirePrimaryMaintainer(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as any).user;
  
  if (!PRIMARY_MAINTAINER_EMAIL) {
    return res.status(500).json({ 
      error: 'PRIMARY_MAINTAINER_EMAIL not configured' 
    });
  }
  
  if (user.email.toLowerCase() !== PRIMARY_MAINTAINER_EMAIL.toLowerCase()) {
    logAudit(user, 'unauthorized_invite_attempt', {}, req);
    return res.status(403).json({ 
      error: 'Only the primary maintainer can generate invites' 
    });
  }
  
  next();
}

function sanitizeAuditRow(row: any): any {
  const sanitized = { ...row };
  if (sanitized.created_by_email) {
    // These are already safe - just email and name
    // but sanitize if full admin_users object was included
  }
  return sanitized;
}

const intervals: NodeJS.Timeout[] = [];

// Consider for future
// async function canAccessTable(userId: number, tableName: string): Promise<boolean> {
//   const { rows } = await pool.query(
//     `SELECT allowed_tables FROM admin_users WHERE id = $1`,
//     [userId]
//   );
  
//   const allowedTables = rows[0]?.allowed_tables;
  
//   // NULL means access all tables (super admin)
//   if (!allowedTables) return true;
  
//   return allowedTables.includes(tableName);
// }

// // Use in endpoints:
// if (!await canAccessTable((req as any).user.id, tableName)) {
//   return res.status(403).json({ error: 'Access denied to this table' });
// }

// Log configuration (but not secrets!)
console.log('[admin] Configuration loaded:', {
  port: PORT,
  nodeEnv: process.env.NODE_ENV,
  csrfSecure: CSRF_SECURE_COOKIE,
  strictIPCheck: STRICT_IP_CHECK,
  allowedIPCount: ADMIN_ALLOWED_IPS.length,
  databaseHost: process.env.DATABASE_HOST || 'localhost',
});

// Get real IP from Cloudflare headers
function getRealIP(req: express.Request): string {
  // CF-Connecting-IP is Cloudflare's header for real visitor IP
  return (req.headers['cf-connecting-ip'] as string) || 
         (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 
         (req.headers['x-real-ip'] as string) ||
         req.socket.remoteAddress ||
         req.ip ||
         'unknown';
}

// Generate backup codes for 2FA
function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric codes
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

async function checkSecurityAlerts() {
  try {
    // Check for multiple failed logins from same IP
    const { rows: failedLogins } = await pool.query(
      `SELECT 
         ip_address,
         COUNT(*) as attempts,
         ARRAY_AGG(DISTINCT user_email) as emails_tried
       FROM admin_audit_log
       WHERE action IN ('failed_login_invalid_user', 'failed_login_invalid_password')
         AND created_at > NOW() - INTERVAL '1 hour'
       GROUP BY ip_address
       HAVING COUNT(*) > 5`
    );
    
    for (const row of failedLogins) {
      console.warn(`[SECURITY] Multiple failed logins from IP ${row.ip_address}: ${row.attempts} attempts`);
      // TODO: Send alert email/Slack/Discord
    }
    
    // Check for high threat scores
    const { rows: threats } = await pool.query(
      `SELECT DISTINCT ip_address, MAX(threat_score) as score, cf_country
       FROM admin_audit_log
       WHERE threat_score > 40
         AND created_at > NOW() - INTERVAL '1 hour'
       GROUP BY ip_address, cf_country`
    );
    
    for (const row of threats) {
      console.warn(`[SECURITY] High threat score ${row.score} from ${row.ip_address} (${row.cf_country})`);
      // TODO: Send alert
    }
    
  } catch (error) {
    console.error('[security-check] Error:', error);
  }
}

async function validateTableName(tableName: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables 
     WHERE schemaname = 'public' AND tablename = $1`,
    [tableName]
  );
  return rows.length > 0;
}

async function getPrimaryKey(tableName: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid 
       AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     LIMIT 1`,
    [tableName]  // ✅ Safe because regclass cast validates
  );
  return rows[0]?.attname || 'id';
}

// DB pool (separate from main indexer pool)
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5, // Limited pool for admin
});

// Types
interface User {
  id: number;
  email: string;
  full_name?: string;
}

interface JWTPayload {
  id: number;
  email: string;
  v: number;
  ip?: string;
  iat?: number;
  exp?: number;
}

// Middleware
async function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    // Read token from cookie instead of Authorization header
    const token = req.cookies.auth_token;
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    
    // Get real IP for comparison
    const realIP = getRealIP(req);
    
    // Optional: Verify IP hasn't changed (can disable in dev)
    const strictIPCheck = STRICT_IP_CHECK;
    if (strictIPCheck && decoded.ip && decoded.ip !== realIP) {
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
    
    // Verify user still exists and is active with correct token version
    const { rows } = await pool.query(
      `SELECT id, email, full_name, token_version 
       FROM admin_users 
       WHERE id = $1 AND is_active = true`,
      [decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Check token version (allows emergency revocation)
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

    // Attach user to request
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
}

// Audit logging helper
async function logAudit(
  user: User | null,
  action: string,
  details: Record<string, any> = {},
  req: express.Request
) {
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
}

// Cache helper using the redis proxy
async function getCached<T>(
  key: string,
  queryFn: () => Promise<T>,
  ttl = CACHE_TTL
): Promise<T> {
  // Try cache first
  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Invalid JSON, continue to query
    }
  }

  // Execute query
  const result = await queryFn();
  
  // Cache result
  try {
    await redis.set(key, JSON.stringify(result), { EX: ttl });
  } catch (error) {
    console.error('[cache] Failed to cache result:', error);
  }

  return result;
}

// Cache invalidation helper
async function invalidateCache(pattern: string) {
  try {
    // Note: This requires KEYS command which is O(N) - fine for admin dashboard
    // For production at scale, consider using separate key tracking
    const keys = await redis.eval(
      `return redis.call('KEYS', ARGV[1])`,
      { keys: [], arguments: [pattern] }
    );
    
    if (Array.isArray(keys) && keys.length > 0) {
      for (const key of keys) {
        await redis.del(key);
      }
    }
  } catch (error) {
    console.error('[cache] Failed to invalidate:', error);
  }
}

interface QueryMacro {
  id: number;
  name: string;
  description: string;
  sql: string;
  parameters?: { name: string; type: 'number' | 'string' | 'date' }[];
  created_by: number;
  created_at: Date;
  category: 'maintenance' | 'monitoring' | 'rollback' | 'custom';
  requires_confirmation: boolean;
}

const DENY_PATTERNS = [
  { pattern: /DROP\s+(TABLE|DATABASE|SCHEMA)/i, message: 'DROP operations not allowed' },
  { pattern: /TRUNCATE/i, message: 'TRUNCATE not allowed' },
  { pattern: /ALTER\s+TABLE/i, message: 'Schema changes not allowed (use migrations)' },
  { pattern: /CREATE\s+(TABLE|INDEX)/i, message: 'Schema changes not allowed' },
];

async function validateMacroSQL(sql: string): Promise<{ 
  valid: boolean; 
  error?: string; 
  requiresBatching?: boolean;
  estimatedRows?: number;
}> {
  // Check deny list first
  for (const { pattern, message } of DENY_PATTERNS) {
    if (pattern.test(sql)) {
      return { valid: false, error: message };
    }
  }

  const isSelect = /^\s*SELECT/i.test(sql.trim());
  const isWrite = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql.trim());
  const hasLimit = /LIMIT\s+\d+/i.test(sql);

  try {
    // Get query plan to estimate row count
    const { rows } = await pool.query(`EXPLAIN (FORMAT JSON) ${sql}`);
    const plan = rows[0]['QUERY PLAN'][0];
    const estimatedRows = plan?.Plan?.['Plan Rows'] || 0;

    // SELECT rules
    if (isSelect) {
      if (!hasLimit && estimatedRows > 1000) {
        return { 
          valid: false, 
          error: `SELECT query may return ${estimatedRows} rows. Add LIMIT clause (max 50000) or use batching.` 
        };
      }
      
      if (hasLimit) {
        const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
        const limitValue = parseInt(limitMatch?.[1] || '0');
        if (limitValue > 50000) {
          return { valid: false, error: 'SELECT LIMIT cannot exceed 50000 rows' };
        }
      }
    }

    // Write operation rules  
    if (isWrite && estimatedRows > 10000) {
      return {
        valid: true, // Allow it, but suggest batching
        requiresBatching: true,
        estimatedRows,
      };
    }

    return { valid: true, estimatedRows };

  } catch (err: any) {
    // If EXPLAIN fails, be permissive but cautious
    if (isSelect && !hasLimit) {
      return { valid: false, error: 'Cannot analyze query. Please add LIMIT clause to SELECT queries.' };
    }
    return { valid: false, error: `SQL Error: ${err.message}` };
  }
}

// Create app
function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  
  app.use(express.json());
  app.use(cookieParser());

  const corsOptions = {
    origin: (origin: any, callback: any) => {
      const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:3000',
        'https://forge-admin.neptuun.xyz',
      ];
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    exposedHeaders: ['Set-Cookie']
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  // TO BE TUNED
  const globalRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    // Store in memory (fine for single instance, use Redis for multiple)
    handler: (req, res) => {
      logAudit(null, 'rate_limit_exceeded', {
        path: req.path,
        ip: getRealIP(req)
      }, req);
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    }
  });

  // Strict rate limit for auth endpoints
  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes  
    max: 10, // Only 10 login attempts per window
    skipSuccessfulRequests: true, // Don't count successful logins
    message: 'Too many login attempts',
    handler: async (req, res) => {
      await logAudit(null, 'excessive_login_attempts', {
        email: req.body.email,
        ip: getRealIP(req)
      }, req);
      res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }
  });

  app.use((req, res, next) => {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Prevent caching of API responses
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    
    next();
  });

  const csrfProtection = csrf({
    cookie: {
      httpOnly: true,
      secure: CSRF_SECURE_COOKIE,
      sameSite: 'strict',
      maxAge: 4 * 60 * 60 * 1000
    }
  });

  app.use((req, res, next) => {
    const threatScore = req.headers['cf-threat-score'] ? 
      parseInt(req.headers['cf-threat-score'] as string) : 0;
    
    // Block high threat scores for admin
    if (threatScore > 50) {
      logAudit(null, 'high_threat_blocked', {
        threat_score: threatScore,
        path: req.path,
        ip: getRealIP(req)
      }, req);
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Block Tor for admin access
    if (req.headers['cf-tor'] === 'true') {
      logAudit(null, 'tor_blocked', {
        path: req.path,
        ip: getRealIP(req)
      }, req);
      return res.status(403).json({ error: 'Tor access not allowed for admin panel' });
    }
    
    next();
  });

  if (ADMIN_ALLOWED_IPS.length > 0 && process.env.NODE_ENV === 'production') {
    app.use('/api', (req, res, next) => {
      const clientIP = getRealIP(req);
      
      // Check if IP is allowed
      const isAllowed = ADMIN_ALLOWED_IPS.some(allowedIP => {
        // Support CIDR notation (requires 'ip-range-check' package)
        // For now, just do exact match
        return clientIP === allowedIP;
      });
      
      if (!isAllowed) {
        logAudit(null, 'ip_not_allowed', {
          ip: clientIP,
          path: req.path
        }, req);
        
        return res.status(403).json({ 
          error: 'Access denied',
          code: 'IP_NOT_ALLOWED'
        });
      }
      
      next();
    });
    
    console.log('[admin] IP allowlist enabled with', ADMIN_ALLOWED_IPS.length, 'IPs');
  }

  app.use('/api', globalRateLimit);
  app.use('/api/auth/login', authRateLimit);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/csrf-token', csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });

  // Auth endpoints
  app.post('/api/auth/login', authRateLimit, csrfProtection, async (req, res) => {
    try {
      const { email, password, totp } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
      }

      // 1. Fetch user
      const { rows } = await pool.query(
        `SELECT id, email, password_hash, full_name, token_version,
                totp_secret, is_2fa_enabled
        FROM admin_users 
        WHERE email = $1 AND is_active = true`,
        [email.toLowerCase().trim()]
      );

      if (!rows.length) {
        // Timing-safe dummy hash check
        await bcrypt.compare(password, '$2b$10$abcdefghijklmnopqrstuv.dummy.hash.XXXXXXXXXXXXXXXXXXXXXXX');
        
        await logAudit(null, 'failed_login_invalid_user', { 
          email,
          ip: getRealIP(req)
        }, req);
        
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = rows[0];

      // 2. Verify password
      const validPassword = await bcrypt.compare(password, user.password_hash);

      if (!validPassword) {
        await logAudit(user, 'failed_login_invalid_password', { 
          ip: getRealIP(req)
        }, req);
        
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // 3. Check 2FA if enabled (we'll implement full 2FA in Step 6)
      if (user.is_2fa_enabled) {
        if (!totp) {
          // Password correct, but need 2FA code
          // For now, we'll just log this - full 2FA implementation in Step 6
          await logAudit(user, 'login_requires_2fa', { 
            ip: getRealIP(req)
          }, req);
          
          return res.status(200).json({ 
            requiresTOTP: true,
            message: 'Please enter your 2FA code',
            // Temporary token or session ID could go here
          });
        }

        // TODO: Step 6 will add TOTP verification here
        // For now, just reject if 2FA is enabled
        return res.status(501).json({ 
          error: '2FA verification not yet implemented. Disable 2FA for this user first.' 
        });
      }

      // 4. Generate JWT with IP binding
      const realIP = getRealIP(req);
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email,
          v: user.token_version,
          ip: realIP
        },
        JWT_SECRET,
        { expiresIn: '4h' }  // Shorter expiry for security
      );

      // 5. Set secure HTTP-only cookie
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: CSRF_SECURE_COOKIE,  // Use config from secret
        sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'strict',
        maxAge: 4 * 60 * 60 * 1000,
        path: '/',
      });

      // 6. Update last login tracking
      await pool.query(
        `UPDATE admin_users 
        SET last_login = now(), last_login_ip = $1 
        WHERE id = $2`,
        [realIP, user.id]
      );

      // 7. Audit log
      await logAudit(user, 'login_success', { 
        ip: realIP,
        has_2fa: user.is_2fa_enabled
      }, req);

      // 8. Return user info + CSRF token (but NOT the JWT!)
      res.json({
        user: { 
          id: user.id, 
          email: user.email, 
          full_name: user.full_name,
          has_2fa: user.is_2fa_enabled
        },
        csrfToken: req.csrfToken(),  // Frontend needs this for future requests
        expiresAt: Date.now() + (4 * 60 * 60 * 1000)  // For frontend timer
      });

    } catch (error) {
      console.error('[login] Error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/auth/logout', csrfProtection, authenticate, async (req, res) => {
    const user = (req as any).user;
    
    // Clear the cookie
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'strict',
      path: '/'
    });
    
    await logAudit(user, 'logout', {}, req);
    
    res.json({ success: true, message: 'Logged out successfully' });
  });

  app.post('/api/admin/invite', 
    csrfProtection, 
    authenticate, 
    requirePrimaryMaintainer, 
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
        const { rows: existing } = await pool.query(
          'SELECT id FROM admin_users WHERE email = $1',
          [normalizedEmail]
        );
        
        if (existing.length > 0) {
          return res.status(400).json({ 
            error: 'User with this email already exists' 
          });
        }
        
        // Check for pending invite
        const { rows: pendingInvites } = await pool.query(
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
        const { rows: [invite] } = await pool.query(
          `INSERT INTO admin_user_invites 
          (email, token, invited_by, expires_at, full_name)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, token, expires_at`,
          [normalizedEmail, token, user.id, expiresAt, full_name || null]
        );
        
        // MARKER
        // Build registration URL
        const baseUrl = process.env.NODE_ENV === 'production' 
          ? 'https://forge-admin.neptuun.xyz'
          : 'http://localhost:5173';
        
        const registrationUrl = `${baseUrl}/register?token=${token}`;
        
        await logAudit(user, 'invite_created', {
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

  app.get('/api/register/validate/:token', async (req, res) => {
    try {
      const { token } = req.params;
      
      const { rows } = await pool.query(
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

  app.post('/api/register', csrfProtection, async (req, res) => {
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
      const client = await pool.connect();
      
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
        const realIP = getRealIP(req);
        await client.query(
          `UPDATE admin_user_invites 
          SET consumed_at = NOW(), consumed_by_ip = $1 
          WHERE id = $2`,
          [realIP, invite.id]
        );
        
        await client.query('COMMIT');
        
        // Log the registration
        await logAudit(newUser, 'user_registered', {
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

  app.get('/api/admin/invites', 
    authenticate, 
    requirePrimaryMaintainer, 
    async (req, res) => {
      try {
        const { rows } = await pool.query(
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

  app.delete('/api/admin/invites/:id', 
    csrfProtection,
    authenticate, 
    requirePrimaryMaintainer, 
    async (req, res) => {
      const user = (req as any).user;
      const { id } = req.params;
      
      try {
        const { rows } = await pool.query(
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
        
        await logAudit(user, 'invite_revoked', {
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

  app.get('/api/auth/permissions', authenticate, checkSuperUser, (req, res) => {
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
  });

  app.get('/api/admin/super-users', 
    authenticate, 
    requirePrimaryMaintainer, 
    async (req, res) => {
      try {
        const { rows } = await pool.query(
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

  app.post('/api/admin/super-users', 
    csrfProtection,
    authenticate, 
    requirePrimaryMaintainer, 
    async (req, res) => {
      const user = (req as any).user;
      const { user_id, notes } = req.body;
      
      try {
        if (!user_id) {
          return res.status(400).json({ error: 'user_id required' });
        }
        
        // Verify target user exists and is active
        const { rows: targetUsers } = await pool.query(
          'SELECT id, email, full_name FROM admin_users WHERE id = $1 AND is_active = true',
          [user_id]
        );
        
        if (!targetUsers.length) {
          return res.status(404).json({ error: 'User not found or inactive' });
        }
        
        // Grant super user access
        const { rows } = await pool.query(
          `INSERT INTO admin_super_users (user_id, granted_by, notes)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id) DO UPDATE SET
            granted_by = EXCLUDED.granted_by,
            granted_at = NOW(),
            notes = EXCLUDED.notes
          RETURNING id`,
          [user_id, user.id, notes || null]
        );
        
        await logAudit(user, 'grant_super_user', {
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

  app.delete('/api/admin/super-users/:userId', 
    csrfProtection,
    authenticate, 
    requirePrimaryMaintainer, 
    async (req, res) => {
      const user = (req as any).user;
      const { userId } = req.params;
      
      try {
        // Get user info before deleting
        const { rows: targetUsers } = await pool.query(
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
        const primaryMaintainerEmail = fromEnvOrFile('PRIMARY_MAINTAINER_EMAIL') || 
                                      fromEnvOrFile('admin_email');
        
        if (primaryMaintainerEmail && 
            targetUsers[0].email.toLowerCase() === primaryMaintainerEmail.toLowerCase()) {
          return res.status(403).json({ 
            error: 'Cannot revoke primary maintainer access' 
          });
        }
        
        // Revoke access
        await pool.query(
          'DELETE FROM admin_super_users WHERE user_id = $1',
          [userId]
        );
        
        await logAudit(user, 'revoke_super_user', {
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

  app.post('/api/admin/execute-sql', 
    csrfProtection,
    authenticate, 
    requireSuperUser,
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
          await logAudit(user, 'sql_execution_blocked', {
            reason: validation.error,
            sql: trimmedSql.substring(0, 500)
          }, req);
          
          return res.status(403).json({ 
            error: validation.error,
            code: 'SQL_BLOCKED'
          });
        }
        
        const client = await pool.connect();
        
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
          const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(trimmedSql);
          
          // Sanitize results if querying sensitive tables
          let sanitizedRows = result.rows;
          const tableMatch = trimmedSql.match(/FROM\s+(\w+)/i);
          if (tableMatch) {
            const tableName = tableMatch[1];
            sanitizedRows = sanitizeResponse(tableName, result.rows);
          }
          
          await logAudit(user, 'execute_raw_sql', {
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
        
        await logAudit(user, 'execute_raw_sql_failed', {
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

  app.post('/api/admin/validate-super-sql', 
    csrfProtection,
    authenticate, 
    requireSuperUser,
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
        const { rows } = await pool.query(`EXPLAIN ${trimmedSql}`);
        
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

  app.post('/api/auth/refresh', csrfProtection, authenticate, async (req, res) => {
    const user = (req as any).user;
    
    try {
      // Re-fetch user to get latest token_version
      const { rows } = await pool.query(
        'SELECT id, email, token_version FROM admin_users WHERE id = $1 AND is_active = true',
        [user.id]
      );
      
      if (!rows.length) {
        return res.status(401).json({ error: 'User not found' });
      }
      
      const realIP = getRealIP(req);
      
      // Generate new token with fresh expiry
      const newToken = jwt.sign(
        { 
          id: rows[0].id, 
          email: rows[0].email,
          v: rows[0].token_version,
          ip: realIP
        },
        JWT_SECRET,
        { expiresIn: '4h' }
      );
      
      // Update cookie
      res.cookie('auth_token', newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'strict',
        maxAge: 4 * 60 * 60 * 1000,
        path: '/',
      });
      
      await logAudit(user, 'token_refresh', {}, req);
      
      res.json({ 
        success: true,
        expiresAt: Date.now() + (4 * 60 * 60 * 1000)
      });
      
    } catch (error) {
      console.error('[refresh] Error:', error);
      res.status(500).json({ error: 'Token refresh failed' });
    }
  });

  app.post('/api/auth/verify', csrfProtection, authenticate, (req, res) => {
    res.json({ 
      user: (req as any).user,
      csrfToken: req.csrfToken ? req.csrfToken() : undefined  // Refresh CSRF if needed
    });
  });

  // Dashboard metrics
  app.get('/api/dashboard/metrics', authenticate, async (req, res) => {
    try {
      const metrics = await getCached('admin:metrics', async () => {
        const todayMs = Math.floor(Date.now() / 86400000) * 86400000;

        const [todayStats, totals, dbSize] = await Promise.all([
          pool.query(
            `SELECT 
               COUNT(*)::int as swap_count,
               COALESCE(SUM(base_in), 0)::float as volume,
               COUNT(DISTINCT pair_id)::int as active_pairs
             FROM swaps
             WHERE ts_ms >= $1`,
            [todayMs]
          ),
          pool.query(
            `SELECT 
               (SELECT COUNT(*) FROM swaps)::int as total_swaps,
               (SELECT COUNT(*) FROM pairs)::int as total_pairs,
               (SELECT COUNT(*) FROM assets)::int as total_assets`
          ),
          pool.query(
            `SELECT pg_size_pretty(pg_database_size(current_database())) as db_size`
          ),
        ]);

        return {
          swaps_today: todayStats.rows[0].swap_count,
          volume_today: todayStats.rows[0].volume,
          active_pairs_today: todayStats.rows[0].active_pairs,
          total_swaps: totals.rows[0].total_swaps,
          total_pairs: totals.rows[0].total_pairs,
          total_assets: totals.rows[0].total_assets,
          db_size: dbSize.rows[0].db_size,
        };
      });

      res.json(metrics);
    } catch (error) {
      console.error('[metrics] Error:', error);
      res.status(500).json({ error: 'Failed to fetch metrics' });
    }
  });

  // Recent swaps
  app.get('/api/dashboard/recent-swaps', authenticate, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      
      const swaps = await getCached(`admin:swaps:${limit}`, async () => {
        const { rows } = await pool.query(
          `SELECT 
             s.id, s.ts_ms, p.symbol, s.side, s.price, s.base_in, s.quote_out
           FROM swaps s
           JOIN pairs p ON p.id = s.pair_id
           ORDER BY s.ts_ms DESC
           LIMIT $1`,
          [limit]
        );
        return rows;
      }, 5 * 60); // 5 min cache

      res.json(swaps);
    } catch (error) {
      console.error('[swaps] Error:', error);
      res.status(500).json({ error: 'Failed to fetch swaps' });
    }
  });

  // Audit log
  app.get('/api/dashboard/audit-log', authenticate, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      
      const { rows } = await pool.query(
        `SELECT 
           id, user_email, action, target_table, target_id,
           details, success, error_message, created_at
         FROM admin_audit_log
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );

      res.json(rows);
    } catch (error) {
      console.error('[audit-log] Error:', error);
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  });

  // Table stats
  app.get('/api/dashboard/table-stats', authenticate, async (req, res) => {
    try {
      const stats = await getCached('admin:table-stats', async () => {
        const { rows } = await pool.query(
          `SELECT 
             tablename,
             pg_size_pretty(pg_total_relation_size('public.' || tablename)) as size,
             n_live_tup as row_count,
             n_dead_tup as dead_rows
           FROM pg_stat_user_tables
           WHERE schemaname = 'public'
           ORDER BY pg_total_relation_size('public.' || tablename) DESC
           LIMIT 20`
        );
        return rows;
      });

      res.json(stats);
    } catch (error) {
      console.error('[table-stats] Error:', error);
      res.status(500).json({ error: 'Failed to fetch table stats' });
    }
  });

  // Force cache refresh
  app.post('/api/dashboard/refresh-cache', csrfProtection, authenticate, async (req, res) => {
    try {
      await invalidateCache('admin:*');
      await logAudit((req as any).user, 'refresh_cache', {}, req);
      res.json({ success: true, message: 'Cache cleared' });
    } catch (error) {
      console.error('[refresh-cache] Error:', error);
      res.status(500).json({ error: 'Failed to refresh cache' });
    }
  });

  app.get('/api/schema/info', authenticate, async (req, res) => {
    const user = (req as any).user;
    await logAudit(user, 'view_schema', {}, req);

    const schema = await getCached('admin:schema-info', async () => {
      const { rows: tables } = await pool.query(`
        SELECT table_name
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);

      const tableDetails = await Promise.all(
        tables.map(async (table) => {
          const { rows: columns } = await pool.query(`
            SELECT 
              column_name,
              data_type,
              is_nullable,
              column_default
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = $1
            ORDER BY ordinal_position
          `, [table.table_name]);

          // Get indexes for this table
          const { rows: indexes } = await pool.query(`
            SELECT 
              i.relname as index_name,
              array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
              ix.indisunique as is_unique,
              ix.indisprimary as is_primary
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE t.relname = $1
            GROUP BY i.relname, ix.indisunique, ix.indisprimary
          `, [table.table_name]);

          return {
            name: table.table_name,
            columns: columns.map(col => ({
              name: col.column_name,
              type: col.data_type,
              nullable: col.is_nullable === 'YES',
              default: col.column_default,
            })),
            indexes: indexes.map(idx => ({
              name: idx.index_name,
              columns: idx.columns,
              unique: idx.is_unique,
              primary: idx.is_primary,
            }))
          };
        })
      );

      return { tables: tableDetails, version: Date.now() };
    }, 3600);

    res.json(schema);
  });

  app.post('/api/macros', csrfProtection, authenticate, async (req, res) => {
    const { name, description, sql, parameters, category } = req.body;
    
    // Validate SQL
    const validation = await validateMacroSQL(sql);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const { rows } = await pool.query(
      `INSERT INTO query_macros (name, description, sql, parameters, category, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [name, description, sql, JSON.stringify(parameters || []), category, (req as any).user.id]
    );

    await logAudit((req as any).user, 'create_macro', { macro_id: rows[0].id, name }, req);
    res.json(rows[0]);
  });

  // List all macros
  app.get('/api/macros', csrfProtection, authenticate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT 
          m.id, m.name, m.description, m.sql, m.parameters, 
          m.category, m.requires_confirmation, m.created_at,
          u.email as created_by_email, u.full_name as created_by_name
        FROM query_macros m
        LEFT JOIN admin_users u ON u.id = m.created_by
        ORDER BY m.created_at DESC`
      );
      res.json(rows);
    } catch (error) {
      console.error('[list-macros] Error:', error);
      res.status(500).json({ error: 'Failed to fetch macros' });
    }
  });

  // Get single macro
  app.get('/api/macros/:id', csrfProtection, authenticate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT 
          m.*,
          u.email as created_by_email,
          u.full_name as created_by_name
        FROM query_macros m
        LEFT JOIN admin_users u ON u.id = m.created_by
        WHERE m.id = $1`,
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Macro not found' });
      }

      res.json(rows[0]);
    } catch (error) {
      console.error('[get-macro] Error:', error);
      res.status(500).json({ error: 'Failed to fetch macro' });
    }
  });

  // Update macro
  app.put('/api/tables/:tableName/row/:id', csrfProtection, authenticate, async (req, res) => {
    const { tableName, id } = req.params;
    const updates = req.body;
    
    try {
      // ✅ Block direct admin_users updates
      if (tableName === 'admin_users') {
        return res.status(403).json({ 
          error: 'Cannot update admin_users directly. Use /api/admin/users/:id endpoint instead.' 
        });
      }

      if (!await validateTableName(tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }
      
      const columnNames = Object.keys(updates);
      
      // ✅ Check if trying to update sensitive columns
      const sensitiveColumns = SENSITIVE_COLUMNS[tableName] || [];
      const attemptedSensitive = columnNames.filter(col => sensitiveColumns.includes(col));
      
      if (attemptedSensitive.length > 0) {
        await logAudit((req as any).user, 'attempted_sensitive_column_update', {
          table: tableName,
          sensitive_columns: attemptedSensitive,
          id
        }, req);
        
        return res.status(403).json({ 
          error: `Cannot update sensitive columns: ${attemptedSensitive.join(', ')}` 
        });
      }
      
      // ✅ Validate all column names exist
      const { rows: validColumns } = await pool.query(
        `SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = $1 
          AND column_name = ANY($2)`,
        [tableName, columnNames]
      );
      
      if (validColumns.length !== columnNames.length) {
        return res.status(400).json({ error: 'Invalid column name(s)' });
      }
      
      const pkColumn = await getPrimaryKey(tableName);
      const values = Object.values(updates);
      const setClause = columnNames
        .map((col, idx) => `"${col}" = $${idx + 1}`)
        .join(', ');
      
      const { rows } = await pool.query(
        `UPDATE ${tableName} 
        SET ${setClause} 
        WHERE "${pkColumn}" = $${columnNames.length + 1} 
        RETURNING *`,
        [...values, id]
      );
      
      if (!rows.length) {
        return res.status(404).json({ error: 'Row not found' });
      }
      
      // ✅ Sanitize response before sending
      const sanitizedRow = sanitizeResponse(tableName, rows[0]);
      
      await logAudit((req as any).user, 'update_row', { 
        table: tableName, 
        id, 
        columns: columnNames 
      }, req);
      
      res.json(sanitizedRow);  // ✅ Sanitized
    } catch (error: any) {
      console.error('[update-row] Error:', error);
      res.status(500).json({ error: 'Failed to update row' });
    }
  });

  // Delete macro
  app.delete('/api/macros/:id', csrfProtection, authenticate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        'DELETE FROM query_macros WHERE id = $1 RETURNING name',
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Macro not found' });
      }

      await logAudit((req as any).user, 'delete_macro', { macro_id: req.params.id, name: rows[0].name }, req);
      res.json({ success: true });
    } catch (error) {
      console.error('[delete-macro] Error:', error);
      res.status(500).json({ error: 'Failed to delete macro' });
    }
  });

  // Get execution history for a macro
  app.get('/api/macros/:id/executions', authenticate, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      
      const { rows } = await pool.query(
        `SELECT 
          me.*,
          u.email as executed_by_email,
          u.full_name as executed_by_name
        FROM macro_executions me
        LEFT JOIN admin_users u ON u.id = me.executed_by
        WHERE me.macro_id = $1
        ORDER BY me.executed_at DESC
        LIMIT $2`,
        [req.params.id, limit]
      );

      res.json(rows);
    } catch (error) {
      console.error('[macro-executions] Error:', error);
      res.status(500).json({ error: 'Failed to fetch execution history' });
    }
  });

  // Batched execution for large write operations
  async function executeBatched(
    sql: string, 
    parameters: any[], 
    batchSize: number
  ): Promise<{
    success: boolean;
    totalRowsAffected: number;
    batchesExecuted: number;
    executionTimeMs: number;
  }> {
    const startTime = Date.now();
    let totalRowsAffected = 0;
    let batchesExecuted = 0;

    // Get a dedicated client from the pool for transaction
    const client = await pool.connect();

    try {
      // Start transaction
      await client.query('BEGIN');

      const batchedQuery = convertToBatchedQuery(sql, batchSize);
      
      while (true) {
        // Use client (not pool) for transactional queries
        const result = await client.query(batchedQuery, parameters);
        const rowsAffected = result.rowCount || 0;
        
        totalRowsAffected += rowsAffected;
        batchesExecuted++;
        
        if (rowsAffected === 0) break;
        
        if (batchesExecuted >= 1000) {
          throw new Error('Batch limit exceeded. Query may be too broad.');
        }
        
        // Small delay (outside of query execution)
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Commit all batches atomically
      await client.query('COMMIT');

      return {
        success: true,
        totalRowsAffected,
        batchesExecuted,
        executionTimeMs: Date.now() - startTime,
      };

    } catch (error) {
      // Rollback ALL batches on any failure
      await client.query('ROLLBACK');
      throw error;

    } finally {
      // Always return client to pool
      client.release();
    }
  }

  function convertToBatchedQuery(sql: string, batchSize: number): string {
    // Handle DELETE statements
    if (/^\s*DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)/i.test(sql)) {
      const match = sql.match(/^\s*DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)/i);
      if (match) {
        const [, tableName, whereClause] = match;
        return `
          DELETE FROM ${tableName} 
          WHERE id IN (
            SELECT id FROM ${tableName} 
            WHERE ${whereClause} 
            LIMIT ${batchSize}
          )
        `;
      }
    }
    
    // Handle UPDATE statements similarly
    if (/^\s*UPDATE\s+(\w+)\s+SET\s+(.+)\s+WHERE\s+(.+)/i.test(sql)) {
      const match = sql.match(/^\s*UPDATE\s+(\w+)\s+SET\s+(.+)\s+WHERE\s+(.+)/i);
      if (match) {
        const [, tableName, setClause, whereClause] = match;
        return `
          UPDATE ${tableName} 
          SET ${setClause}
          WHERE id IN (
            SELECT id FROM ${tableName} 
            WHERE ${whereClause} 
            LIMIT ${batchSize}
          )
        `;
      }
    }
    
    return sql; // Fallback to original
  }

  function isWriteQuery(sql: string): boolean {
    return /^\s*(INSERT|UPDATE|DELETE)/i.test(sql.trim());
  }

  app.post('/api/macros/:id/execute', csrfProtection, authenticate, async (req, res) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { parameters, batchSize = 1000, dryRun = false } = req.body;
    
    const startTime = Date.now();

    try {
      const { rows: [macro] } = await pool.query(
        'SELECT * FROM query_macros WHERE id = $1',
        [id]
      );

      if (!macro) {
        return res.status(404).json({ error: 'Macro not found' });
      }

      const validation = await validateMacroSQL(macro.sql);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      
      if (dryRun) {
        return res.json({
          estimatedRows: validation.estimatedRows,
          requiresBatching: validation.requiresBatching,
          recommendedBatchSize: Math.min(batchSize, 5000),
        });
      }

      if (validation.requiresBatching && isWriteQuery(macro.sql)) {
        const result = await executeBatched(macro.sql, parameters, batchSize);
        return res.json(result);
      }

      const result = await pool.query(macro.sql, parameters || []);
      const rowsAffected = result.rowCount || 0;

      const tableNameMatch = macro.sql.match(/FROM\s+(\w+)/i);
      const resultTableName = tableNameMatch ? tableNameMatch[1] : null;
      const sanitizedRows = resultTableName ? sanitizeResponse(resultTableName, result.rows) : result.rows;

      await pool.query(
        `INSERT INTO macro_executions 
        (macro_id, executed_by, parameters, rows_affected, execution_time_ms, success)
        VALUES ($1, $2, $3, $4, $5, true)`,
        [id, user.id, JSON.stringify(parameters), rowsAffected, Date.now() - startTime]
      );

      await logAudit(user, 'execute_macro', {
        macro_id: req.params.id,
        macro_name: macro.name,
        rows_affected: result.rowCount,
        batch_size: batchSize,
        has_parameters: !!parameters && parameters.length > 0
      }, req);

      res.json({ 
        success: true, 
        rowsAffected,
        data: sanitizedRows,
        executionTimeMs: Date.now() - startTime
      });

    } catch (err: any) {
      const executionTime = Date.now() - startTime;
      
      await pool.query(
        `INSERT INTO macro_executions 
        (macro_id, executed_by, parameters, execution_time_ms, success, error_message)
        VALUES ($1, $2, $3, $4, false, $5)`,
        [id, user.id, JSON.stringify(parameters), executionTime, err.message]
      );

      await logAudit(user, 'execute_macro_failed', {
        macro_id: req.params.id,
        error: err.message.substring(0, 200)
      }, req);

      res.status(500).json({ error: 'Macro execution failed', details: err.message });
    }
  });

  app.post('/api/schema/refresh', csrfProtection, authenticate, async (req, res) => {
    try {
      await invalidateCache('admin:schema-info');
      await logAudit((req as any).user, 'refresh_schema', {}, req);
      res.json({ success: true, message: 'Schema cache cleared' });
    } catch (error) {
      console.error('[refresh-schema] Error:', error);
      res.status(500).json({ error: 'Failed to refresh schema' });
    }
  });

  app.get('/api/audit/security-events', authenticate, async (req, res) => {
    const user = (req as any).user;
    const { hours = 24 } = req.query;
    
    try {
      const { rows } = await pool.query(
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
  app.get('/api/audit/suspicious-ips', authenticate, async (req, res) => {
    const user = (req as any).user;
    
    try {
      const { rows } = await pool.query(
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
  app.get('/api/audit/user-activity/:userId', authenticate, async (req, res) => {
    const user = (req as any).user;
    const { userId } = req.params;
    const { days = 7 } = req.query;
    
    try {
      const { rows } = await pool.query(
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


  app.get('/api/tables/:tableName/data', authenticate, async (req, res) => {
    const { tableName } = req.params;
    const { page = '1', pageSize = '50', sortBy, sortOrder = 'ASC' } = req.query;
    
    try {
      if (tableName === 'admin_users') {
        return res.status(403).json({ error: 'Cannot browse admin_users directly. Use /api/admin/users endpoint instead.' });
      }

      if (!await validateTableName(tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }

      const offset = (Number(page) - 1) * Number(pageSize);
      const limit = Math.min(Number(pageSize), 1000);
      
      let orderByClause = '';
      if (sortBy) {
        const { rows: columnCheck } = await pool.query(
          `SELECT column_name FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
          [tableName, sortBy]
        );
        
        if (columnCheck.length === 0) {
          return res.status(400).json({ error: 'Invalid sort column' });
        }
        
        const validatedOrder = sortOrder === 'DESC' ? 'DESC' : 'ASC';
        orderByClause = `ORDER BY "${sortBy as string}" ${validatedOrder}`;
      }
      
      const countQuery = `SELECT COUNT(*) as total FROM ${tableName}`;
      const { rows: countRows } = await pool.query(countQuery);
      
      const dataQuery = `
        SELECT * FROM ${tableName}
        ${orderByClause}
        LIMIT $1 OFFSET $2
      `;
      const { rows: data } = await pool.query(dataQuery, [limit, offset]);
      
      const sanitizedData = sanitizeResponse(tableName, data);
      
      await logAudit((req as any).user, 'browse_table', { 
        table: tableName,
        page,
        pageSize 
      }, req);
      
      res.json({
        data: sanitizedData,
        total: parseInt(countRows[0].total),
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(countRows[0].total / Number(pageSize))
      });
      
    } catch (error: any) {
      console.error('[browse-table] Error:', error);
      res.status(500).json({ error: 'Failed to fetch table data' });
    }
  });

  app.get('/api/tables/:tableName/row/:id', authenticate, async (req, res) => {
    const { tableName, id } = req.params;
    
    try {
      if (tableName === 'admin_users') {
        return res.status(403).json({ error: 'Cannot view admin_users directly. Use /api/admin/users/:id endpoint instead.' });
      }

      if (!await validateTableName(tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }
      
      const pkColumn = await getPrimaryKey(tableName);
      
      const { rows } = await pool.query(
        `SELECT * FROM ${tableName} WHERE "${pkColumn}" = $1`,
        [id]
      );
      
      if (!rows.length) {
        return res.status(404).json({ error: 'Row not found' });
      }
      
      const sanitizedRow = sanitizeResponse(tableName, rows[0]);
      
      res.json(sanitizedRow);
    } catch (error: any) {
      console.error('[get-row] Error:', error);
      res.status(500).json({ error: 'Failed to fetch row' });
    }
  });

  app.put('/api/tables/:tableName/row/:id', csrfProtection, authenticate, async (req, res) => {
    const { tableName, id } = req.params;
    const updates = req.body;
    
    try {
      if (!await validateTableName(tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }
      
      const pkColumn = await getPrimaryKey(tableName);
      
      const columnNames = Object.keys(updates);
      const { rows: validColumns } = await pool.query(
        `SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = $1 
          AND column_name = ANY($2)`,
        [tableName, columnNames]
      );
      
      if (validColumns.length !== columnNames.length) {
        return res.status(400).json({ error: 'Invalid column name(s)' });
      }
      
      const values = Object.values(updates);
      const setClause = columnNames
        .map((col, idx) => `"${col}" = $${idx + 1}`)
        .join(', ');
      
      const { rows } = await pool.query(
        `UPDATE ${tableName} 
        SET ${setClause} 
        WHERE "${pkColumn}" = $${columnNames.length + 1} 
        RETURNING *`,
        [...values, id]
      );
      
      if (!rows.length) {
        return res.status(404).json({ error: 'Row not found' });
      }
      
      await logAudit((req as any).user, 'update_row', { 
        table: tableName, 
        id, 
        columns: columnNames 
      }, req);
      
      res.json(rows[0]);
    } catch (error: any) {
      console.error('[update-row] Error:', error);
      res.status(500).json({ error: 'Failed to update row' });
    }
  });

  app.post('/api/tables/:tableName/row', csrfProtection, authenticate, async (req, res) => {
    const { tableName } = req.params;
    const data = req.body;
    
    try {
      if (tableName === 'admin_users') {
        return res.status(403).json({ 
          error: 'Cannot insert into admin_users directly. Use /api/admin/users endpoint instead.' 
        });
      }

      if (!await validateTableName(tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }
      
      const columnNames = Object.keys(data);
      
      const sensitiveColumns = SENSITIVE_COLUMNS[tableName] || [];
      const attemptedSensitive = columnNames.filter(col => sensitiveColumns.includes(col));
      
      if (attemptedSensitive.length > 0) {
        await logAudit((req as any).user, 'attempted_sensitive_column_insert', {
          table: tableName,
          sensitive_columns: attemptedSensitive
        }, req);
        
        return res.status(403).json({ 
          error: `Cannot insert sensitive columns: ${attemptedSensitive.join(', ')}` 
        });
      }
      
      const { rows: validColumns } = await pool.query(
        `SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = $1 
          AND column_name = ANY($2)`,
        [tableName, columnNames]
      );
      
      if (validColumns.length !== columnNames.length) {
        return res.status(400).json({ error: 'Invalid column name(s)' });
      }
      
      const values = Object.values(data);
      const placeholders = columnNames.map((_, idx) => `$${idx + 1}`).join(', ');
      const quotedColumns = columnNames.map(col => `"${col}"`).join(', ');
      
      const { rows } = await pool.query(
        `INSERT INTO ${tableName} (${quotedColumns}) 
        VALUES (${placeholders}) 
        RETURNING *`,
        values
      );
      
      const sanitizedRow = sanitizeResponse(tableName, rows[0]);
      
      await logAudit((req as any).user, 'insert_row', { 
        table: tableName, 
        columns: columnNames 
      }, req);
      
      res.json(sanitizedRow);
    } catch (error: any) {
      console.error('[insert-row] Error:', error);
      res.status(500).json({ error: 'Failed to insert row' });
    }
  });

  app.delete('/api/tables/:tableName/row/:id', csrfProtection, authenticate, async (req, res) => {
    const { tableName, id } = req.params;
    
    if (tableName === 'admin_users') {
      return res.status(403).json({ 
        error: 'Cannot delete admin_users directly.' 
      });
    }

    try {
      if (!await validateTableName(tableName)) {
        return res.status(404).json({ error: 'Table not found' });
      }
      
      const pkColumn = await getPrimaryKey(tableName);
      
      const { rowCount } = await pool.query(
        `DELETE FROM ${tableName} WHERE "${pkColumn}" = $1`,
        [id]
      );
      
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Row not found' });
      }
      
      await logAudit((req as any).user, 'delete_row', { 
        table: tableName, 
        id 
      }, req);
      
      res.json({ success: true });
    } catch (error: any) {
      console.error('[delete-row] Error:', error);
      res.status(500).json({ error: 'Failed to delete row' });
    }
  });

  app.post('/api/query', csrfProtection, authenticate, async (req, res) => {
    const { sql } = req.body;
    
    try {
      // ✅ Prevent querying sensitive admin tables directly
      if (/FROM\s+admin_users/i.test(sql) || /FROM\s+admin_audit_log/i.test(sql)) {
        return res.status(403).json({ 
          error: 'Cannot query admin tables directly. Use dedicated endpoints instead.' 
        });
      }

      if (!/^\s*SELECT/i.test(sql.trim())) {
        return res.status(400).json({ 
          error: 'Only SELECT queries allowed. Use macros for write operations.' 
        });
      }
      
      const safeSql = /LIMIT\s+\d+/i.test(sql) ? sql : `${sql} LIMIT 1000`;
      
      const result = await pool.query(safeSql);
      
      // ✅ Try to extract table name and sanitize
      const tableNameMatch = safeSql.match(/FROM\s+(\w+)/i);
      const tableName = tableNameMatch ? tableNameMatch[1] : null;
      const sanitizedRows = tableName ? sanitizeResponse(tableName, result.rows) : result.rows;
      
      await logAudit((req as any).user, 'execute_query', { 
        query: sql.substring(0, 200) 
      }, req);
      
      res.json({
        rows: sanitizedRows,  // ✅ Sanitized
        rowCount: result.rowCount,
        fields: result.fields.map((f: any) => ({
          name: f.name,
          dataTypeID: f.dataTypeID
        }))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/admin/users', authenticate, async (req, res) => {
    const user = (req as any).user;
    
    try {
      const { rows } = await pool.query(
        `SELECT 
          id, email, full_name, is_active, is_2fa_enabled,
          last_login, last_login_ip, created_at, updated_at
        FROM admin_users
        ORDER BY created_at DESC`
      );
      
      await logAudit(user, 'list_admin_users', {}, req);
      res.json(rows);
    } catch (error) {
      console.error('[admin-users] Error:', error);
      res.status(500).json({ error: 'Failed to fetch admin users' });
    }
  });

  app.get('/api/admin/users/:id', authenticate, async (req, res) => {
    const user = (req as any).user;
    const { id } = req.params;
    
    try {
      const { rows } = await pool.query(
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
      
      await logAudit(user, 'view_admin_user', { target_user_id: id }, req);
      res.json(rows[0]);
    } catch (error) {
      console.error('[admin-user] Error:', error);
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.code === 'EBADCSRFTOKEN') {
      // CSRF token validation failed
      logAudit(null, 'csrf_validation_failed', {
        path: req.path,
        method: req.method,
        ip: getRealIP(req)
      }, req);
      
      res.status(403).json({ 
        error: 'Invalid or missing CSRF token',
        code: 'CSRF_INVALID'
      });
    } else {
      // Pass to default error handler
      next(err);
    }
  });

  intervals.push(setInterval(checkSecurityAlerts, 5 * 60 * 1000));

  // Serve static files in production
  if (process.env.NODE_ENV === 'production') {
    const clientPath = path.join(__dirname, '../client');
    app.use(express.static(clientPath));
    
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(clientPath, 'index.html'));
      } else {
        res.status(404).json({ error: 'Not found' });
      }
    });
  }

  async function cleanupAuditLogs() {
    try {
      // Keep detailed logs for 90 days
      const { rowCount } = await pool.query(
        `DELETE FROM admin_audit_log 
        WHERE created_at < NOW() - INTERVAL '90 days'
          AND action NOT IN (
            'login_success',
            'execute_macro',
            'delete_macro',
            'user_created',
            'user_deleted'
          )`
      );
      
      if (rowCount || 0 > 0) {
        console.log(`[audit-cleanup] Deleted ${rowCount} old audit entries`);
      }
      
      // Archive important events older than 90 days (optional)
      // You could move these to a separate archive table
      
    } catch (error) {
      console.error('[audit-cleanup] Error:', error);
    }
  }

  // Schedule daily cleanup at 3 AM
  const now = new Date();
  const threAM = new Date(now);
  threAM.setHours(3, 0, 0, 0);
  if (threAM <= now) {
    threAM.setDate(threAM.getDate() + 1);
  }
  const msUntilThreeAM = threAM.getTime() - now.getTime();

  setTimeout(() => {
    cleanupAuditLogs(); // Run first cleanup
    setInterval(cleanupAuditLogs, 24 * 60 * 60 * 1000); // Then every 24 hours
  }, msUntilThreeAM);

  return app;
}

// Start server
export async function startAdminServer() {
  // Initialize Redis connection
  await ensureRedis();
  console.log('[admin] Redis connected');
  
  const app = createApp();
  
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[admin] Server running on port ${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[admin] API: http://localhost:3001/api');
      console.log('[admin] Frontend dev server: http://localhost:5173');
    }
  });

  const shutdown = async () => {
    console.log('[admin] Shutting down...');
    intervals.forEach(interval => clearInterval(interval));
    server.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  startAdminServer().catch(console.error);
}