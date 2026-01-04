import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { Config } from '../config';
import type { RequestHandler } from 'express';

// Middleware creators
import { createAuthMiddleware, getRealIP, type User } from '../middleware/auth';
import { createCsrfMiddleware } from '../middleware/csrf';
import { createGlobalRateLimit } from '../middleware/rate-limit';
import { 
  createRequirePrimaryMaintainer, 
  createRequireSuperUser, 
  createCheckSuperUser 
} from '../middleware/permissions';

// Service creators
import { createAuditLogger } from '../services/audit';
import { createCacheService, type CacheGetter, type CacheInvalidator } from '../services/cache';
import { Redisish } from '../types/redis';

/**
 * Core services shared across all/most routes
 */
export interface CoreServices {
  // ========== RAW RESOURCES ==========
  pool: Pool;
  redis: Redisish;
  config: Config;
  
  // ========== AUTHENTICATION ==========
  authenticate: RequestHandler;
  getRealIP: typeof getRealIP;
  
  // ========== AUTHORIZATION ==========
  requirePrimaryMaintainer: RequestHandler;
  requireSuperUser: RequestHandler;
  checkSuperUser: RequestHandler;  // Non-blocking version
  
  // ========== SECURITY ==========
  csrfProtection: RequestHandler;
  globalRateLimit: RequestHandler;
  
  // ========== SERVICES ==========
  logAudit: ReturnType<typeof createAuditLogger>;
  getCached: CacheGetter;
  invalidateCache: CacheInvalidator;
}

/**
 * Creates all core services that are shared across routes
 */
export function createCoreServices(
  pool: Pool,
  redis: Redisish,
  config: Config
): CoreServices {
  // Create services first (some middleware depends on them)
  const logAudit = createAuditLogger(pool);
  const { getCached, invalidateCache } = createCacheService(redis, config.CACHE_TTL);
  
  // Create middleware
  const authenticate = createAuthMiddleware(pool, config, logAudit);
  const csrfProtection = createCsrfMiddleware(config);
  const globalRateLimit = createGlobalRateLimit();
  
  // Permission checks (depend on pool, config, logAudit)
  const requirePrimaryMaintainer = createRequirePrimaryMaintainer(config, logAudit);
  const requireSuperUser = createRequireSuperUser(pool, config, logAudit);
  const checkSuperUser = createCheckSuperUser(pool, config);
  
  return {
    // Raw resources
    pool,
    redis,
    config,
    
    // Authentication
    authenticate,
    getRealIP,
    
    // Authorization
    requirePrimaryMaintainer,
    requireSuperUser,
    checkSuperUser,
    
    // Security
    csrfProtection,
    globalRateLimit,
    
    // Services
    logAudit,
    getCached,
    invalidateCache,
  };
}

/**
 * Re-export types that routes commonly need
 */
export type { User } from '../middleware/auth';
export type { CacheGetter, CacheInvalidator } from '../services/cache';