import { Res, Bar } from '@forge-backend/shared/utils/types';
import { redis, isRedisReady, wasRedisOKWithin, markRedisOK } from '@forge-backend/shared/adapters/redis';

const MINUTE = 60_000;
const TTL_SEC = 6 * 3600;
const REDIS_CMD_TIMEOUT_MS = Number(process.env.REDIS_TIMEOUT_MS || 400);
const FLUSH_INTERVAL_MS   = Number(process.env.LIVECACHE_FLUSH_MS || 50);
const HOT_RETENTION_MS    = 2 * MINUTE; // keep in-RAM bars hot for last 2 minutes only

type HotEntry = { bar: Bar; seenAt: number };

function floorBucket(ts: number, minutes: number) {
  return Math.floor(ts / (minutes * MINUTE)) * (minutes * MINUTE);
}

function computeBucketStart(res: Res, tsMs: number) {
  const resMin: Record<string, number> = { '1':1,'5':5,'15':15,'60':60,'240':240 };
  if (res === '1D') {
    const d = new Date(tsMs);
    d.setUTCHours(0,0,0,0);
    return d.getTime();
  }
  if (res === '1W') {
    const d = new Date(tsMs);
    d.setUTCHours(0,0,0,0);
    const w = (d.getUTCDay() || 7) - 1; // Monday-start
    d.setUTCDate(d.getUTCDate() - w);
    return d.getTime();
  }
  if (res === '1M') {
    const d = new Date(tsMs);
    d.setUTCDate(1);
    d.setUTCHours(0,0,0,0);
    return d.getTime();
  }
  return floorBucket(tsMs, resMin[res]);
}

// key -> latest merged bar (+ last-seen time)
const q = new Map<string, HotEntry>();
// Track last published bars to avoid needless updates
const lastPublished = new Map<string, Bar>();
let flusherStarted = false;

/**
 * Check if two bars are identical
 */
function barsEqual(a: Bar | undefined, b: Bar): boolean {
  if (!a) return false;
  return a.t === b.t &&
         a.o === b.o &&
         a.h === b.h &&
         a.l === b.l &&
         a.c === b.c &&
         a.v === b.v;
}

/**
 * UPDATE (overloaded):
 * - Tick mode:
 *     updateLiveBar(pair, res, price, vol, tsMs)
 * - Snapshot mode (authoritative OHLCV):
 *     updateLiveBar(pair, res, { t, o, h, l, c, v })
 */
export function updateLiveBar(pair: string, res: Res, price: number, vol: number, tsMs: number): void;
export function updateLiveBar(pair: string, res: Res, snapshot: Bar): void;
export function updateLiveBar(
  pair: string,
  res: Res,
  a: number | Bar,
  b?: number,
  c?: number
): void {
  const key = `live:bar:${pair}:${res}`;
  const now = Date.now();

  // ── Snapshot mode (authoritative) ───────────────────────────────────────────
  if (typeof a === 'object' && a !== null) {
    const snap = a as Bar;

    // Normalize snapshot t to the bucket start for this resolution
    const tBucket = computeBucketStart(res, snap.t);
    const cur = q.get(key);

    // Preserve existing OPEN if we already seeded this bucket in RAM;
    // otherwise trust the snapshot's OPEN for a fresh bucket (oracle path).
    const bar: Bar =
      cur && cur.bar.t === tBucket
        ? {
            t: tBucket,
            o: cur.bar.o,
            h: Math.max(cur.bar.h, snap.h),
            l: Math.min(cur.bar.l, snap.l),
            c: snap.c,
            v: (Number.isFinite(snap.v as any) ? (snap.v as number) : cur.bar.v) ?? 0,
          }
        : {
            t: tBucket,
            o: snap.o,
            h: snap.h,
            l: snap.l,
            c: snap.c,
            v: snap.v ?? 0,
          };

    q.set(key, { bar, seenAt: now });
    maybeStartFlusher();
    return;
  }

  // ── Tick mode (merge incoming trade tick into RAM bucket) ───────────────────
  const price = a as number;
  const vol   = (b as number) ?? 0;
  const tsMs  = (c as number) ?? now;

  const t = computeBucketStart(res, tsMs);
  const cur = q.get(key);

  if (!cur || cur.bar.t !== t) {
    // Start a new bucket, using previous CLOSE as OPEN if present; else use current price
    const prevClose = cur ? cur.bar.c : undefined;
    const open = (prevClose != null) ? prevClose : price;
    q.set(key, {
      bar: { t, o: open, h: open, l: open, c: open, v: 0 },
      seenAt: now
    });
  }

  const entry = q.get(key)!;
  const bbar = entry.bar;

  // Merge tick (OPEN is intentionally immutable for the bucket)
  if (price > bbar.h) bbar.h = price;
  if (price < bbar.l) bbar.l = price;
  bbar.c = price;
  bbar.v += vol;

  entry.seenAt = now;

  maybeStartFlusher();
}

export async function updateLiveArp(
  assetHashHex: string,
  anchorCurrency: string,
  arpData: {
    timestamp: number;
    price: number;
    confidence: number;
    hops: number;
    source?: string;
    bestPathEdges?: number[];
  }
): Promise<void> {
  if (!isRedisReady() || !wasRedisOKWithin(2000)) {
    console.warn(`[arp] Redis not ready, skipping ARP update for ${assetHashHex}`);
    return;
  }

  const key = `arp:${assetHashHex.toLowerCase().replace(/^0x/, '')}:${anchorCurrency.toLowerCase()}`;
  
  const payload = {
    t: arpData.timestamp,
    price: arpData.price,
    confidence: arpData.confidence,
    hops: arpData.hops,
    source: arpData.source || 'dex_simulation',
    bestPathEdges: arpData.bestPathEdges || [],
    updated: Date.now()
  };

  try {
    // Store as Redis hash for efficient field access
    await withTimeout(
      redis.hSet(key, {
        'latest': JSON.stringify(payload),
        '1': JSON.stringify(payload)  // For compatibility with resolution-based lookups
      }),
      REDIS_CMD_TIMEOUT_MS
    );
    
    // Set TTL on the key itself
    await withTimeout(redis.expire(key, TTL_SEC), REDIS_CMD_TIMEOUT_MS);
    markRedisOK();
    
    // Publish to subscribers (WebSocket will receive this)
    await withTimeout(redis.publish(key, JSON.stringify(payload)), REDIS_CMD_TIMEOUT_MS);
    markRedisOK();
    
  } catch (e) {
    console.warn(`[arp] Failed to update Redis for ${key}:`, (e as Error).message);
  }
}

/** Start a single background flusher loop (idempotent). */
function maybeStartFlusher() {
  if (flusherStarted) return;
  flusherStarted = true;

  const tick = async () => {
    try {
      const now = Date.now();

      // Evict idle > HOT_RETENTION_MS (keeps only last ~2 minutes hot)
      for (const [key, entry] of q) {
        if (now - entry.seenAt > HOT_RETENTION_MS) {
          q.delete(key);
          lastPublished.delete(key); // Clean up tracking too
        }
      }

      if (!isRedisReady() || !wasRedisOKWithin(2000)) return;
      if (q.size === 0) return;

      // Take a snapshot so producers can continue
      const snapshot = Array.from(q.entries());

      // Only publish if bar has changed
      for (const [key, entry] of snapshot) {
        const lastPub = lastPublished.get(key);
        
        // Skip if bar hasn't changed
        if (barsEqual(lastPub, entry.bar)) {
          continue;
        }

        const out = JSON.stringify(entry.bar);
        try {
          await withTimeout(redis.set(key, out, { EX: TTL_SEC }), REDIS_CMD_TIMEOUT_MS);
          markRedisOK();
          await withTimeout(redis.publish(key, out), REDIS_CMD_TIMEOUT_MS);
          markRedisOK();
          
          lastPublished.set(key, { ...entry.bar });
        } catch {
        }
      }
    } finally {
      setTimeout(tick, FLUSH_INTERVAL_MS);
    }
  };

  setTimeout(tick, FLUSH_INTERVAL_MS);
}

// Utility: time-bounded promise
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`redis_timeout_${ms}ms`)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}