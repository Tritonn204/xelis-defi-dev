import { ensureRedis } from '@forge-backend/shared/adapters/redis';
import type { Bar } from '@forge-backend/shared/utils/types';

const REDIS_CMD_TIMEOUT_MS = 400; // Match your liveCache timeout

const REDIS_TTL = {
  '1': {
    last_24h: 1 * 60,      // 1 minute (fresh data)
    last_7d: 5 * 60,       // 5 minutes
    last_30d: 30 * 60,     // 30 minutes
  },
  '5': {
    last_7d: 10 * 60,      // 10 minutes
    last_30d: 1 * 3600,    // 1 hour
    last_90d: 6 * 3600,    // 6 hours
  },
  '15': {
    last_30d: 2 * 3600,    // 2 hours
    last_180d: 24 * 3600,  // 24 hours
  },
  '60': {
    last_180d: 24 * 3600,  // 24 hours
    last_2y: 7 * 24 * 3600, // 7 days
  },
  '240': 30 * 24 * 3600,   // 30 days
  '1D': 90 * 24 * 3600,    // 90 days
  '1W': 180 * 24 * 3600,   // 6 months
  '1M': 365 * 24 * 3600,   // 1 year
} as Record<string, any>;

// Helper for timeout promises (reuse pattern from liveCache)
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`redis_timeout_${ms}ms`)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}

export class CandleCache {
  private getCacheKey(
    routerId: number,
    pairId: number,
    resolution: string,
    fromMs: number,
    toMs: number
  ): string {
    // Round timestamps to bucket boundaries for better cache hits
    const buckets = this.getBucketBoundaries(resolution, fromMs, toMs);
    return `candles:v1:${routerId}:${pairId}:${resolution}:${buckets.from}:${buckets.to}`;
  }

  private getBucketBoundaries(res: string, fromMs: number, toMs: number) {
    const sizes: Record<string, number> = {
      '1': 60_000,
      '5': 300_000,
      '15': 900_000,
      '60': 3_600_000,
      '240': 14_400_000,
      '1D': 86_400_000,
      '1W': 604_800_000,
      '1M': 2_592_000_000,
    };
    
    const bucketMs = sizes[res] || 60_000;
    return {
      from: Math.floor(fromMs / bucketMs) * bucketMs,
      to: Math.floor(toMs / bucketMs) * bucketMs
    };
  }

  private getTTL(resolution: string, toMs: number): number {
    const now = Date.now();
    const age = now - toMs;

    const matrix = REDIS_TTL[resolution];
    if (!matrix || typeof matrix === 'number') {
      return matrix || 3600; // Default 1 hour
    }

    // Determine which bucket based on age
    const DAY = 86_400_000;
    if ('last_24h' in matrix && age < DAY) return matrix.last_24h;
    if ('last_7d' in matrix && age < 7 * DAY) return matrix.last_7d;
    if ('last_30d' in matrix && age < 30 * DAY) return matrix.last_30d;
    if ('last_90d' in matrix && age < 90 * DAY) return matrix.last_90d;
    if ('last_180d' in matrix && age < 180 * DAY) return matrix.last_180d;
    if ('last_2y' in matrix && age < 730 * DAY) return matrix.last_2y;
    
    // Default to longest TTL
    return matrix[Object.keys(matrix)[Object.keys(matrix).length - 1]];
  }

  async get(
    routerId: number,
    pairId: number,
    resolution: string,
    fromMs: number,
    toMs: number
  ): Promise<Bar[] | null> {
    const key = this.getCacheKey(routerId, pairId, resolution, fromMs, toMs);
    
    try {
      const redis = await ensureRedis();
      const cached = await withTimeout(
        redis.get(key),
        REDIS_CMD_TIMEOUT_MS
      );
      
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn('[cache-get] Error:', (e as Error).message);
    }
    
    return null;
  }

  async set(
    routerId: number,
    pairId: number,
    resolution: string,
    fromMs: number,
    toMs: number,
    bars: Bar[]
  ): Promise<void> {
    const key = this.getCacheKey(routerId, pairId, resolution, fromMs, toMs);
    const ttl = this.getTTL(resolution, toMs);
    
    try {
      const redis = await ensureRedis();
      await withTimeout(
        redis.set(key, JSON.stringify(bars), { EX: ttl }),
        REDIS_CMD_TIMEOUT_MS
      );
    } catch (e) {
      console.warn('[cache-set] Error:', (e as Error).message);
    }
  }

  // Optional: Warm cache for recently active pairs
  async warmCache(
    routerId: number,
    pairId: number,
    resolution: string,
    bars: Bar[]
  ): Promise<void> {
    if (!bars.length) return;
    
    // Store the most recent 100 bars for quick access
    const recent = bars.slice(-100);
    const fromMs = recent[0].t;
    const toMs = recent[recent.length - 1].t;
    
    await this.set(routerId, pairId, resolution, fromMs, toMs, recent);
  }
}

// Singleton instance
let cacheInstance: CandleCache | null = null;

export async function getCandleCache(): Promise<CandleCache> {
  if (!cacheInstance) {
    await ensureRedis(); // Ensure Redis is connected
    cacheInstance = new CandleCache();
  }
  return cacheInstance;
}