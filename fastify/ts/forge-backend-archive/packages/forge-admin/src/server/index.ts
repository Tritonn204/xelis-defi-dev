import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import cors from 'cors';
import { ensureRedis, redis } from '@forge-backend/shared/adapters/redis';
import { loadConfig } from './config';
import { getPool } from './services/database';
import { CoreServices, createCoreServices } from './factory/core';
import { createAuthRoutes, buildAuthDeps } from './routes/auth';
import { buildUserDeps, createUserRoutes } from './routes/users';
import { buildDashboardDeps, createDashboardRoutes } from './routes/dashboard';
import { buildTablesDeps, createTablesRoutes } from './routes/tables';
import { buildMacrosDeps, createMacrosRoutes } from './routes/macros';
import { buildAuditDeps, createAuditRoutes } from './routes/audit';
import { buildSchemaDeps, createSchemaRoutes } from './routes/schema';
import { checkSecurityAlerts } from './services/security';
import { buildSuperAdminDeps, createSuperAdminRoutes } from './routes/super-admin';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const intervals: NodeJS.Timeout[] = [];

export async function createApp() {
  const config = loadConfig();
  const pool = getPool(config);
  await ensureRedis();
  
  // Create core services once
  const core = createCoreServices(pool, redis, config);
  
  const app = express();
  
  // Global middleware
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://forge-admin.neptuun.xyz',
    ],
    credentials: true,
  }));
  
  app.use('/api', core.globalRateLimit);
  
  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  
  const apiRouter = express.Router();
  
  apiRouter.use(createAuthRoutes(buildAuthDeps(core)));
  apiRouter.use(createUserRoutes(buildUserDeps(core)));
  apiRouter.use(createDashboardRoutes(buildDashboardDeps(core)));
  apiRouter.use(createTablesRoutes(buildTablesDeps(core)));
  apiRouter.use(createMacrosRoutes(buildMacrosDeps(core)));
  apiRouter.use(createAuditRoutes(buildAuditDeps(core)));
  apiRouter.use(createSchemaRoutes(buildSchemaDeps(core)));
  apiRouter.use(createSuperAdminRoutes(buildSuperAdminDeps(core)));
  
  app.use('/api', apiRouter);
  
  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.code === 'EBADCSRFTOKEN') {
      core.logAudit(null, 'csrf_validation_failed', {
        path: req.path,
        method: req.method,
        ip: core.getRealIP(req)
      }, req);
      
      res.status(403).json({ 
        error: 'Invalid or missing CSRF token',
        code: 'CSRF_INVALID'
      });
    } else {
      console.error('[error]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  intervals.push(setInterval(checkSecurityAlerts, 5 * 60 * 1000, core.pool));

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
      // Could move these to a separate archive table
      
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
    intervals.push(setInterval(cleanupAuditLogs, 24 * 60 * 60 * 1000));
  }, msUntilThreeAM);


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

  return app;
}

export async function startAdminServer() {
  const app = await createApp();
  const config = loadConfig();
  
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`[admin] Server running on port ${config.PORT}`);
  });
  
  const shutdown = async () => {
    console.log('[admin] Shutting down...');
    intervals.forEach(interval => clearInterval(interval));
    server.close();
    const { closePool } = await import('./services/database');
    await closePool();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startAdminServer().catch(console.error);
}