import { ensureRedis } from '@forge-backend/shared/adapters/redis';
import type { Redis } from 'ioredis';
import { Redisish } from '../types/redis';

export type CacheGetter = <T>(
  key: string,
  queryFn: () => Promise<T>,
  ttl?: number
) => Promise<T>;

export type CacheInvalidator = (pattern: string) => Promise<void>;

export function createCacheService(redis: Redisish, defaultTTL: number) {
  const getCached: CacheGetter = async (key, queryFn, ttl = defaultTTL) => {
    const cached = await redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid JSON, continue to query
      }
    }

    const result = await queryFn();
    
    try {
      await redis.set(key, JSON.stringify(result), { EX: ttl });
    } catch (error) {
      console.error('[cache] Failed to cache result:', error);
    }

    return result;
  };

  const invalidateCache: CacheInvalidator = async (pattern) => {
    try {
      const keys = await redis.eval(
        `return redis.call('KEYS', ARGV[1])`,
        0,
        pattern
      ) as string[];
      
      if (Array.isArray(keys) && keys.length > 0) {
        for (const key of keys) {
          await redis.del(key);
        }
      }
    } catch (error) {
      console.error('[cache] Failed to invalidate:', error);
    }
  };

  return { getCached, invalidateCache };
}