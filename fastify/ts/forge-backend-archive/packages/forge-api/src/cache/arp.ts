import { ensureRedis } from '@forge-backend/shared/adapters/redis';

export class ArpCache {
  private getCacheKey(
    routerId: number,
    assetId: number,
    anchor: string,
    fromMs: number,
    toMs: number
  ): string {
    // Round to minute boundaries for ARP (1m granularity)
    const fromBucket = Math.floor(fromMs / 60000) * 60000;
    const toBucket = Math.floor(toMs / 60000) * 60000;
    
    return `arp:cache:${routerId}:${assetId}:${anchor.toLowerCase()}:${fromBucket}:${toBucket}`;
  }

  private getTTL(toMs: number): number {
    const now = Date.now();
    const age = now - toMs;
    const DAY = 86_400_000;
    
    // ARP data is less volatile, cache longer
    if (age < DAY) return 5 * 60;           // 5 minutes for recent
    if (age < 7 * DAY) return 30 * 60;      // 30 minutes for week old
    if (age < 30 * DAY) return 2 * 3600;    // 2 hours for month old
    if (age < 90 * DAY) return 12 * 3600;   // 12 hours for quarter
    return 24 * 3600;                        // 24 hours for older
  }

  async get(
    routerId: number,
    assetId: number,
    anchor: string,
    fromMs: number,
    toMs: number
  ): Promise<any[] | null> {
    const key = this.getCacheKey(routerId, assetId, anchor, fromMs, toMs);
    
    try {
      const redis = await ensureRedis();
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn('[arp-cache-get] Error:', (e as Error).message);
    }
    
    return null;
  }

  async set(
    routerId: number,
    assetId: number,
    anchor: string,
    fromMs: number,
    toMs: number,
    data: any[]
  ): Promise<void> {
    const key = this.getCacheKey(routerId, assetId, anchor, fromMs, toMs);
    const ttl = this.getTTL(toMs);
    
    try {
      const redis = await ensureRedis();
      await redis.set(key, JSON.stringify(data), { EX: ttl });
    } catch (e) {
      console.warn('[arp-cache-set] Error:', (e as Error).message);
    }
  }
}

let arpCacheInstance: ArpCache | null = null;

export async function getArpCache(): Promise<ArpCache> {
  if (!arpCacheInstance) {
    await ensureRedis();
    arpCacheInstance = new ArpCache();
  }
  return arpCacheInstance;
}