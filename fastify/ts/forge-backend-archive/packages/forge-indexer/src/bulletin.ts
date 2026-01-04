import { ensureRedis, markRedisOK } from '@forge-backend/shared/adapters/redis';
import crypto from 'crypto';

// ---------- config ----------
const NS = (process.env.BULLETIN_NS || 'forge').replace(/:?$/, ':'); // ensure trailing colon
const LEASE_TTL_S = parseInt(process.env.BULLETIN_LEASE_TTL_S || '120', 10);   // >= worst-case reconnect
const HEARTBEAT_MS = parseInt(process.env.BULLETIN_HEARTBEAT_MS || '30000', 10); // ~TTL/4
const MAX_SCAN = parseInt(process.env.BULLETIN_MAX_SCAN || '32', 10);

// If you want to reset ZSET scores even when the seed is unchanged:
const RESET_SCORES_ON_SAME = process.env.BULLETIN_RESET_ON_SAME === '1';

// ---------- keys ----------
const K = {
  nodesPriority: () => `${NS}nodes:priority`,
  nodesAll:      () => `${NS}nodes:all`,
  node:          (id: string) => `${NS}node:${id}`,
  lease:         (id: string) => `${NS}lease:${id}`,
  seeded:        (marker: string) => `${NS}nodes:seeded:${marker}`, // we store current marker at 'current'
};

export type Lease = { nodeId: string; url: string; token: string };

// ---------- helpers ----------
function nodeIdForUrl(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}
function seedIdForList(envList: string): string {
  return crypto.createHash('sha1').update(envList).digest('hex').slice(0, 8);
}

// derive a per-replica scan offset from HOSTNAME like "indexer-1" -> 0, "indexer-2" -> 1
function replicaOffset(defaultMod = 64): number {
  const hn = process.env.HOSTNAME || '';
  const m = hn.match(/-(\d+)(?:\..*)?$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return n - 1;
  }
  // stable fallback if hostname unexpected
  const b = crypto.createHash('sha1').update(hn || String(process.pid)).digest()[0];
  return b % defaultMod;
}

// ---------- lua (acquire with offset & wrap) ----------
// KEYS[1] = <ns>nodes:priority
// ARGV[1] = now_ms
// ARGV[2] = lease_ttl_s
// ARGV[3] = task_id
// ARGV[4] = max_scan
// ARGV[5] = ns (e.g., "forge:")
// ARGV[6] = scan_offset (0-based; modulo ZCARD)
const GRAB_SCRIPT = `
local now_ms   = tonumber(ARGV[1])
local ttl_s    = tonumber(ARGV[2])
local task_id  = ARGV[3]
local max_scan = tonumber(ARGV[4])
local ns       = ARGV[5]
local offset   = tonumber(ARGV[6]) or 0

local total = redis.call("ZCARD", KEYS[1])
if total == 0 then return nil end
offset = offset % total

local scanned = 0
local function try_range(start_idx, upto)
  local stop_idx = math.min(total - 1, start_idx + upto - 1)
  local candidates = redis.call("ZRANGE", KEYS[1], start_idx, stop_idx)
  for _, nodeId in ipairs(candidates) do
    local status = redis.call("HGET", ns .. "node:" .. nodeId, "status")
    if status == false or status == "healthy" then
      local ok = redis.call("SET", ns .. "lease:" .. nodeId, task_id, "NX", "EX", ttl_s)
      if ok then
        redis.call("ZADD", KEYS[1], now_ms, nodeId) -- bump score = last assigned time
        return nodeId, (stop_idx - start_idx + 1)
      end
    end
  end
  return nil, (stop_idx - start_idx + 1)
end

-- first pass: from offset to end
local nodeId, used = try_range(offset, math.min(max_scan, total - offset))
scanned = scanned + used
if nodeId then return nodeId end

-- second pass: wrap to start if needed
if scanned < max_scan and offset > 0 then
  nodeId, used = try_range(0, math.min(max_scan - scanned, offset))
  if nodeId then return nodeId end
end

return nil
`;

const SMEMBERS_SCRIPT = `return redis.call("SMEMBERS", KEYS[1])`;

// ---------- pipeline shims (for node-redis vs ioredis) ----------
function getPipeline(r: any) {
  if (typeof r.pipeline === 'function') return r.pipeline();
  if (typeof r.multi === 'function') return r.multi();
  throw new Error('Redis client does not expose pipeline() or multi()');
}
function pHSet(p: any, key: string, map: Record<string, string>) {
  if (typeof p.hSet === 'function') return p.hSet(key, map);   // node-redis
  if (typeof p.hset === 'function') return p.hset(key, map);   // ioredis
  throw new Error('pipeline lacks hset/hSet');
}
function pSAdd(p: any, key: string, member: string) {
  if (typeof p.sAdd === 'function') return p.sAdd(key, member);
  if (typeof p.sadd === 'function') return p.sadd(key, member);
  throw new Error('pipeline lacks sadd/sAdd');
}
function pSRem(p: any, key: string, member: string) {
  if (typeof p.sRem === 'function') return p.sRem(key, member);
  if (typeof p.srem === 'function') return p.srem(key, member);
  throw new Error('pipeline lacks srem/sRem');
}
function pZAddScoreMember(p: any, key: string, score: number, member: string) {
  if (typeof p.zAdd === 'function') return p.zAdd(key, [{ score, value: member }]); // node-redis v4
  if (typeof p.zadd === 'function') return p.zadd(key, score, member);              // ioredis
  throw new Error('pipeline lacks zadd/zAdd');
}
function pZRem(p: any, key: string, member: string) {
  if (typeof p.zRem === 'function') return p.zRem(key, member);
  if (typeof p.zrem === 'function') return p.zrem(key, member);
  throw new Error('pipeline lacks zrem/zRem');
}

// ---------- seeding (idempotent, reconciles, preserves leases for kept nodes) ----------
export async function seedNodesOnce(envList: string) {
  const redis = await ensureRedis();

  // Parse/normalize desired urls (empty list -> clears everything)
  const urls = envList.split(',').map(s => s.trim()).filter(Boolean);
  const desired = urls.map(url => ({ id: nodeIdForUrl(url), url }));
  const desiredIds = new Set(desired.map(d => d.id));
  const seedId = seedIdForList(urls.join(','));

  // fast no-op if same seed and we don't want to force score reset
  const prevSeed = await redis.get(K.seeded('current'));
  if (prevSeed === seedId && !RESET_SCORES_ON_SAME) {
    return; // identical; preserve indexes, leases, and scores
  }

  // short lock to avoid concurrent reseeds
  const lockKey = `${NS}seed:lock`;
  const gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 });
  if (!gotLock) return;

  try {
    // currently-known node ids
    const existingIds: string[] = await redis.eval(SMEMBERS_SCRIPT, {
      keys: [K.nodesAll()],
      arguments: [],
    });

    const p = getPipeline(redis as any);
    const now = Date.now().toString();

    // Remove nodes that are no longer desired: clean hash, lease, indexes
    for (const id of existingIds) {
      if (!desiredIds.has(id)) {
        p.del(K.node(id));
        p.del(K.lease(id));
        pZRem(p, K.nodesPriority(), id);
        pSRem(p, K.nodesAll(), id);
      }
    }

    // Upsert desired nodes:
    // - write/refresh node hash (url/status/last_seen)
    // - ensure membership in indexes
    // - optionally reset score to 0 (either because seed changed, or RESET_SCORES_ON_SAME=1)
    const resetScores = (prevSeed !== seedId) || RESET_SCORES_ON_SAME;

    for (const { id, url } of desired) {
      pHSet(p, K.node(id), { url, status: 'healthy', last_seen: now });
      pSAdd(p, K.nodesAll(), id);
      if (resetScores) {
        pZAddScoreMember(p, K.nodesPriority(), 0, id); // reset
      } else {
        // If you prefer to "ensure exists" without changing score, you could check & add outside,
        // but pipeline shims don't have ZADD XX. Resetting only when seed changes keeps it simple.
        pZAddScoreMember(p, K.nodesPriority(), 0, id); // harmless if you don't care about score drift
      }
    }

    // record current seed hash
    p.set(K.seeded('current'), seedId);

    await p.exec();
    markRedisOK();
  } finally {
    // best-effort unlock
    try { await redis.del(lockKey); } catch {}
  }
}

// ---------- acquire ----------
export async function acquireNode(taskId: string): Promise<Lease | null> {
  const redis = await ensureRedis();

  const nodeId = await redis.eval(GRAB_SCRIPT, {
    keys: [K.nodesPriority()],
    arguments: [
      Date.now().toString(),
      String(LEASE_TTL_S),
      taskId,
      String(MAX_SCAN),
      NS,
      String(replicaOffset()),   // bias scan start by replica slot
    ],
  }) as string | null;

  if (!nodeId) return null;

  const url = await redis.hGet(K.node(nodeId), 'url');
  if (!url) return null;

  const token = crypto.randomUUID(); // optional fence token
  markRedisOK();
  return { nodeId, url, token };
}

// ---------- renew/release ----------
export async function renewLease(nodeId: string, taskId: string): Promise<boolean> {
  const redis = await ensureRedis();
  const key = K.lease(nodeId);
  const holder = await redis.get(key);
  if (holder === taskId) {
    await redis.expire(key, LEASE_TTL_S);
    markRedisOK();
    return true;
  }
  return false;
}

export async function releaseLease(nodeId: string, taskId: string) {
  const redis = await ensureRedis();
  const key = K.lease(nodeId);
  const holder = await redis.get(key);
  if (holder === taskId) {
    await redis.del(key);
  }
}

// ---------- heartbeat ----------
export function startLeaseHeartbeat(nodeId: string, taskId: string, onLost: () => void) {
  let consecutiveFailures = 0;
  const t = setInterval(async () => {
    try {
      const ok = await renewLease(nodeId, taskId);
      if (ok) {
        consecutiveFailures = 0;
        return;
      }
      clearInterval(t);
      onLost();
    } catch {
      // tolerate transient redis errors; only act if it ultimately results in a lost lease
      consecutiveFailures++;
      // Optional: hard-bail after long Redis outage:
      // if (consecutiveFailures >= Math.ceil((LEASE_TTL_S * 1000) / HEARTBEAT_MS)) {
      //   clearInterval(t);
      //   onLost();
      // }
    }
  }, HEARTBEAT_MS);

  (t as any).unref?.(); // don't keep process alive because of the timer
  return () => clearInterval(t);
}
