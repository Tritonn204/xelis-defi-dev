import { Pool, PoolClient } from 'pg';
import { updateLiveArp, updateLiveBar } from './liveCache';
import { startXelUsdOracle, OracleHandle } from './xelUsdOracle';
import { ensureRedis } from '@forge-backend/shared/adapters/redis';
import { NATIVE_ASSET_HASH, VIRTUAL_USD } from '@forge-backend/shared/constants';

const MINUTE = 60_000;
const BATCH = 2000;
const TICK_MS = 500;
const CARRY_SWEEP_WINDOW_MS = 24 * 60 * MINUTE; // 24h

// -------------------------------
// Types
// -------------------------------
type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

type MinuteBar = {
  pairId: number;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

// -------------------------------
// Small ID caches
// -------------------------------
const routerIdCache = new Map<string, number>();
const liveKeyCache = new Map<number, string>(); // pairId -> liveKey tail (no router)

const ROUTE_UPDATE_MS = Number(process.env.ROUTE_UPDATE_MS || 5 * MINUTE);
const DB_ARP_UPDATE_MS = Number(process.env.DB_ARP_UPDATE_MS || MINUTE); 
const LIVE_ARP_UPDATE_MS = Number(process.env.LIVE_ARP_UPDATE_MS || 10_000);

const ARP_CLEANUP_HOUR = Number(process.env.ARP_CLEANUP_HOUR || 3); // 3 AM UTC default
let lastArpCleanupDay = -1;
let lastRollupMinute = -1;

let redisInitialized = false;

const retryRedisInit = async () => {
  while (!redisInitialized) {
    try {
      await ensureRedis();
      const redis = await ensureRedis();
      await redis.ping();
      redisInitialized = true;
      console.log('[redis] connected after retry');
    } catch (e: any) {
      console.warn('[redis] retry failed, will try again in 5s:', e?.message ?? e);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
};

interface ReserveData {
  pairId: number;
  direction: number; // From the edge (positive or negative)
  aAmount: string;
  bAmount: string;
  aDecimals: number;
  bDecimals: number;
  aTicker: string;
  bTicker: string;
}

interface PathSimulation {
  success: boolean;
  effectivePrice: number;
  vwapPrice: number;
  priceImpact: number;
  minLiquidityUSD: number;
  confidence: number;
  vwapError: number;
}

interface ScoredPath {
  rank: number;
  edges: number[];
  hopCount: number;
  simulation: PathSimulation | null;
}

// Helpers

async function backgroundArpMaintenance(
  pool: Pool,
  routerId: number,
  now: number
) {
  const currentDate = new Date(now);
  const currentDay = Math.floor(now / (24 * 60 * 60 * 1000));
  const currentHour = currentDate.getUTCHours();
  
  if (currentDay === lastArpCleanupDay) {
    return; // Already ran today
  }
  
  if (currentHour !== ARP_CLEANUP_HOUR) {
    return; // Not the right hour yet
  }

  // Use separate connection from pool
  const c = await pool.connect();
  
  try {
    console.log('[arp-maintenance] Starting scheduled cleanup (background)');
    
    // Set reasonable limits for background work
    await c.query("SET work_mem = '256MB'");
    await c.query("SET statement_timeout = '10min'");
    
    const result = await c.query(
      'SELECT * FROM aggregate_and_clean_arp_data($1, $2)',
      [routerId, now]
    );
    
  const { deleted_1m, created_5m, created_1h, created_1d } = result.rows[0];

  console.log('[arp-maintenance] Completed:', {
    deleted_1m_records: deleted_1m,
    created_5m_records: created_5m,
    created_1h_records: created_1h,
    created_1d_records: created_1d,  // New field
    timestamp: currentDate.toISOString(),
    next_run: new Date(now + 24 * 60 * 60 * 1000).toISOString()
  });
    
    lastArpCleanupDay = currentDay;
  } catch (e) {
    console.error('[arp-maintenance] Background failed:', (e as Error).message);
    // Don't update lastArpCleanupDay on failure - will retry next hour
  } finally {
    c.release();
  }
}

async function backgroundCandleRollup(
  pool: Pool,
  routerId: number,
  now: number
) {
  const currentMinute = Math.floor(now / 60000);
  
  // Check if it's a 5-minute boundary AND we haven't run for this minute yet
  if (currentMinute % 5 !== 0) {
    return; // Not a 5-minute boundary
  }
  
  if (currentMinute === lastRollupMinute) {
    return; // Already ran for this 5-minute period
  }
  
  lastRollupMinute = currentMinute;
  
  // Now proceed with rollup...
  const c = await pool.connect();
  try {
    console.log('[candle-rollup] Starting background rollup');
    // ... rest of function
  } catch (e) {
    console.error('[candle-rollup] Background failed:', (e as Error).message);
  } finally {
    c.release();
  }
}

async function getPathReserves(
  c: PoolClient,
  routerId: number,
  edges: number[],
  xelUsdRate: number
): Promise<ReserveData[]> {
  const reserves: ReserveData[] = [];
  
  for (const edge of edges) {
    const pairId = Math.abs(edge);
    
    const result = await c.query(`
      SELECT 
        rl.a_amount,
        rl.b_amount,
        ba.decimals as a_decimals,
        qa.decimals as b_decimals,
        ba.ticker as a_ticker,
        qa.ticker as b_ticker
      FROM reserves_latest rl
      JOIN routers r ON r.router = rl.router
      JOIN pairs p ON 
        rl.pool_key = CONCAT(
          LEAST(encode(p.a_hash,'hex'), encode(p.b_hash,'hex')),
          '_',
          GREATEST(encode(p.a_hash,'hex'), encode(p.b_hash,'hex'))
        )
      JOIN pair_components pc ON pc.pair_id = p.id
      JOIN assets ba ON ba.id = pc.base_asset_id
      JOIN assets qa ON qa.id = pc.quote_asset_id
      WHERE p.id = $1 AND r.id = $2
    `, [pairId, routerId]);

    if (result.rows.length === 0) {
      throw new Error(`No reserves found for pair ${pairId}`);
    }

    const row = result.rows[0];
    
    reserves.push({
      pairId,
      direction: edge,
      aAmount: row.a_amount,
      bAmount: row.b_amount,
      aDecimals: Number(row.a_decimals),
      bDecimals: Number(row.b_decimals),
      aTicker: row.a_ticker,
      bTicker: row.b_ticker
    });
  }
  
  return reserves;
}

function simulatePathTrade(
  edges: number[],
  reserves: ReserveData[],
  sourceAssetPrice: number,    // Price of source asset in reference unit (USD, BTC, etc)
  tradeAmountInRefUnit: number // Trade size in same reference unit
): PathSimulation | null {
  if (edges.length !== reserves.length) {
    console.warn(`[sim] Edge/reserve mismatch: ${edges.length} edges, ${reserves.length} reserves`);
    return null;
  }

  // Convert reference-unit amount to source asset amount
  const sourceAmount = tradeAmountInRefUnit / sourceAssetPrice;
  let currentAmount = sourceAmount;
  let vwapPrice = 1.0;
  let minLiquidityInRef = Infinity;
  
  const fee = 0.00279925;

  for (let i = 0; i < edges.length; i++) {
    const reserve = reserves[i];
    
    // Parse reserves (already decimal-normalized)
    const aRes = parseFloat(reserve.aAmount);
    const bRes = parseFloat(reserve.bAmount);
    
    if (!aRes || !bRes || aRes === 0 || bRes === 0) {
      console.error(`[sim] Zero/invalid reserves for pair ${reserve.pairId}: a=${aRes}, b=${bRes}`);
      return null;
    }
    
    // Calculate liquidity in reference unit
    // For the source pair, we know exact price. For others, we use spot price as approximation
    let pairLiquidityInRef: number;
    if (i === 0) {
      // First pair: we know source asset price exactly
      if (reserve.direction > 0) {
        // Source is asset A
        pairLiquidityInRef = aRes * sourceAssetPrice;
      } else {
        // Source is asset B
        pairLiquidityInRef = bRes * sourceAssetPrice;
      }
    } else {
      // Subsequent pairs: estimate using the smaller reserve * source price
      // This is an approximation but good enough for liquidity scoring
      pairLiquidityInRef = Math.min(aRes, bRes) * sourceAssetPrice;
    }
    minLiquidityInRef = Math.min(minLiquidityInRef, pairLiquidityInRef);
    
    // Direction check
    if (reserve.direction > 0) {
      // A -> B (base -> quote)
      vwapPrice *= (bRes / aRes);
      currentAmount = simulateSwapStep(aRes, bRes, currentAmount, fee);
    } else {
      // B -> A (quote -> base)  
      vwapPrice *= (aRes / bRes);
      currentAmount = simulateSwapStep(bRes, aRes, currentAmount, fee);
    }
    
    if (currentAmount <= 0) {
      console.warn(`[sim] Trade failed at hop ${i+1}, zero output`);
      return null;
    }
  }

  const effectivePrice = currentAmount / sourceAmount;
  const vwapError = Math.abs((effectivePrice - vwapPrice) / vwapPrice);
  
  // EXACT POC confidence formula
  let confidence: number;
  if (vwapError <= 0.005) {
    confidence = 1.0;
  } else if (vwapError <= 0.02) {
    confidence = 0.9 - ((vwapError - 0.005) / 0.015) * 0.2;
  } else if (vwapError <= 0.05) {
    confidence = 0.7 - ((vwapError - 0.02) / 0.03) * 0.4;
  } else if (vwapError <= 0.1) {
    confidence = 0.3 - ((vwapError - 0.05) / 0.05) * 0.25;
  } else {
    confidence = 0.05 * Math.exp(-vwapError * 20);
  }
  
  // Hop penalty: 0.05 per hop beyond 2
  if (edges.length > 2) {
    const hopPenalty = 1.0 - (0.05 * (edges.length - 2));
    confidence *= Math.max(0.1, hopPenalty);
  }
  
  confidence = Math.max(0.01, confidence);

  return {
    success: true,
    effectivePrice,        // target_amount / source_amount ratio
    vwapPrice,            // predicted ratio from spot prices
    priceImpact: vwapError, // Actually VWAP error, not traditional price impact
    minLiquidityUSD: minLiquidityInRef, // Actually in reference unit, not always USD
    confidence,
    vwapError
  };
}

function simulateSwapStep(
  reserveIn: number,
  reserveOut: number,
  amountIn: number,
  fee: number = 0.00279925
): number {
  const amountInWithFee = amountIn * (1 - fee);
  const k = reserveIn * reserveOut;
  return reserveOut - (k / (reserveIn + amountInWithFee));
}
async function getLiveKeyByPairId(
  pool: Pool | PoolClient,
  routerStr: string,
  pairId: number
): Promise<string> {
  const hit = liveKeyCache.get(pairId);
  if (hit) return `${routerStr}:${hit}`;

  const { rows } = await pool.query(
    `SELECT encode(a_hash,'hex') AS a_hex, encode(b_hash,'hex') AS b_hex
       FROM pairs WHERE id=$1`,
    [pairId]
  );
  if (!rows.length) return `${routerStr}:${pairId}`;

  let a = String(rows[0].a_hex).toLowerCase();
  let b = String(rows[0].b_hex).toLowerCase();
  if (a > b) [a, b] = [b, a];
  const tail = `${a}_${b}`;

  liveKeyCache.set(pairId, tail);
  return `${routerStr}:${tail}`;
}

async function getLiveArpKey(
  pool: Pool | PoolClient,
  assetId: number
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT encode(hash,'hex') AS hash_hex FROM assets WHERE id=$1`,
    [assetId]
  );
  
  if (!rows.length) return null;
  const hashHex = String(rows[0].hash_hex).toLowerCase();
  return `arp:${hashHex}:usd`; // e.g., "arp:abc123def456:usd"
}

// -------------------------------
// In-memory open minute snapshots (per pair)
// -------------------------------
const openBuckets = new Map<number, MinuteBar>(); // key: pairId

function mergeIntoOpen(pairId: number, bucketStart: number, px: number, vol: number) {
  const cur = openBuckets.get(pairId);
  if (!cur || cur.t !== bucketStart) {
    openBuckets.set(pairId, { pairId, t: bucketStart, o: px, h: px, l: px, c: px, v: vol });
  } else {
    if (px > cur.h) cur.h = px;
    if (px < cur.l) cur.l = px;
    cur.c = px;
    cur.v += vol;
  }
}

async function flushRolledBuckets(c: PoolClient, routerStr: string, routerId: number, currentBucket: number) {
  for (const [pairId, bar] of Array.from(openBuckets.entries())) {
    if (bar.t < currentBucket) {
      await upsertCandle1m(c, {
        router_id: routerId,
        pair_id: pairId,
        t_start: bar.t,
        o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v,
      });
      openBuckets.delete(pairId);

      // Optional: publish finalized snapshot after DB write
      try {
        const liveKey = await getLiveKeyByPairId(c, routerStr, pairId);
        updateLiveBar(liveKey, '1', { t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
      } catch {}
    }
  }
}

// -------------------------------
// Router/pair helpers
// -------------------------------
async function getOrCreateRouterId(pool: Pool, router: string): Promise<number> {
  const hit = routerIdCache.get(router);
  if (hit) return hit;
  const { rows } = await pool.query(
    `INSERT INTO routers (router)
     VALUES ($1)
     ON CONFLICT (router) DO UPDATE SET router = EXCLUDED.router
     RETURNING id`,
    [router]
  );
  const id = Number(rows[0].id);
  routerIdCache.set(router, id);
  return id;
}

// -------------------------------
// Advisory lock (per-router leader)
// -------------------------------
const LOCK_NS = hash32('FORGE');
let leaderConn: PoolClient | null = null;
let leaderKeepalive: NodeJS.Timeout | null = null;
const LEADER_PING_MS = Number(process.env.LEADER_PING_MS || 25_000);

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h | 0);
}

async function tryBecomeLeader(pool: Pool, router: string): Promise<boolean> {
  if (leaderConn) return true;

  const k = hash32(router);
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); // pin session

    const { rows } = await c.query(
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS ok',
      [LOCK_NS, k]
    );

    if (rows?.[0]?.ok === true) {
      leaderConn = c;

      if (leaderKeepalive) clearInterval(leaderKeepalive);
      leaderKeepalive = setInterval(async () => {
        try { await leaderConn!.query('SELECT 1'); } catch (e) {
          console.warn('[candle] leader keepalive failed; relinquishing:', (e as any)?.message ?? e);
          await relinquish(pool, router);
        }
      }, LEADER_PING_MS);

      return true;
    } else {
      await c.query('ROLLBACK');
      c.release();
      return false;
    }
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    c.release();
    throw e;
  }
}

async function relinquish(_pool: Pool, router: string) {
  if (!leaderConn) return;
  try {
    if (leaderKeepalive) { clearInterval(leaderKeepalive); leaderKeepalive = null; }
    const k = hash32(router);
    await leaderConn.query('SELECT pg_advisory_unlock($1::int, $2::int)', [LOCK_NS, k]);
    await leaderConn.query('COMMIT');
  } catch (e: any) {
    console.warn('[candle] unlock/commit error:', e?.message ?? e);
    try { await leaderConn.query('ROLLBACK'); } catch {}
  } finally {
    try { leaderConn.release(); } catch {}
    leaderConn = null;
  }
}

// -------------------------------
// Tx helper
// -------------------------------
async function runInTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const res = await fn(c);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    c.release();
  }
}

// -------------------------------
// Checkpoints (ID-based)
// -------------------------------
async function loadCheckpoint(c: PoolClient, routerId: number) {
  await c.query(`INSERT INTO candle_state(router_id,last_ts_ms,last_id)
                 VALUES ($1,0,'') ON CONFLICT (router_id) DO NOTHING`, [routerId]);
  const { rows } = await c.query(
    `SELECT last_ts_ms, last_id FROM candle_state WHERE router_id=$1`, [routerId]);
  return { ts: Number(rows[0]?.last_ts_ms ?? 0), id: String(rows[0]?.last_id ?? '') };
}

async function saveCheckpoint(c: PoolClient, routerId: number, ts: number, id: string) {
  await c.query(
    `UPDATE candle_state SET last_ts_ms=$2, last_id=$3, updated_at=now() WHERE router_id=$1`,
    [routerId, ts, id]
  );
}

// -------------------------------
// Upsert candle (sticky-open semantics), ID-based
// -------------------------------
export async function upsertCandle1m(
  q: Queryable,
  row: { router_id: number; pair_id: number; t_start: number; o: number; h: number; l: number; c: number; v: number }
): Promise<void> {
  await (q as any).query(
    `INSERT INTO candles_1m (router_id, pair_id, t_start, o, h, l, c, v)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (router_id, pair_id, t_start) DO UPDATE
       SET
         o = candles_1m.o,                                   -- keep original open
         h = GREATEST(candles_1m.h, EXCLUDED.h),
         l = LEAST(candles_1m.l, EXCLUDED.l),
         c = EXCLUDED.c,
         v = candles_1m.v + EXCLUDED.v`,
    [row.router_id, row.pair_id, row.t_start, row.o, row.h, row.l, row.c, row.v]
  );
}

async function updateRoutingPaths(
  c: PoolClient,
  routerId: number,
  anchorId: number,
  assetIds: number[]
): Promise<void> {
  console.log('[routing] Starting path update:', { routerId, anchorId, assetCount: assetIds.length });
  
  const realAssets = await c.query(
    `SELECT id FROM assets 
     WHERE id = ANY($1) 
     AND (meta->>'virtual' IS NULL OR meta->>'virtual' != 'true')`,
    [assetIds]
  );
  
  const filteredIds = realAssets.rows.map(r => r.id);

  for (const assetId of filteredIds) {
    // Check if we have pairs for this asset
    const pairCheck = await c.query(
      `SELECT COUNT(*) as cnt FROM pair_components 
       WHERE base_asset_id = $1 OR quote_asset_id = $1`,
      [assetId]
    );
    console.log(`[routing] Asset ${assetId} has ${pairCheck.rows[0].cnt} connected pairs`);
    
    const result = await c.query(
      'SELECT update_routing_paths($1, $2, $3, $4, $5)',
      [routerId, anchorId, assetId, 6, 5]
    );
    
    // Log the result
    console.log(`[routing] Paths found for asset ${assetId}:`, result.rows[0]);
    
    // Check what was actually inserted
    const inserted = await c.query(
      `SELECT path_rank, array_length(edges, 1) as hop_count, edges 
       FROM routing_paths 
       WHERE router_id=$1 AND anchor_id=$2 AND asset_id=$3
       ORDER BY path_rank`,
      [routerId, anchorId, assetId]
    );
    console.log(`[routing] Inserted ${inserted.rows.length} paths for asset ${assetId}:`, 
      inserted.rows.map(r => ({ rank: r.path_rank, hops: r.hop_count, edges: r.edges }))
    );
  }
}

async function calculateLiveArpData(
  c: PoolClient,
  routerId: number,
  assetId: number
): Promise<{
  price: number;
  confidence: number;
  hops: number;
  source: string;
  bestPathEdges: number[];
} | null> {
  try {
    const result = await c.query(
      `SELECT 
        price_in_anchor as price,
        confidence_score as confidence,
        hop_count as hops,
        best_path_edges,
        flags
       FROM arp_points_1m 
       WHERE router_id = $1 
         AND asset_id = $2 
         AND anchor_id = (SELECT id FROM anchors WHERE router_id = $1 AND name = 'USD' LIMIT 1)
       ORDER BY t_start DESC 
       LIMIT 1`,
      [routerId, assetId]
    );
    
    if (!result.rows[0]) return null;
    
    const row = result.rows[0];
    return {
      price: Number(row.price),
      confidence: Number(row.confidence),
      hops: Number(row.hops),
      source: row.flags?.includes('oracle') ? 'oracle' : 
              row.flags?.includes('dex_simulation') ? 'dex_simulation' : 'calculated',
      bestPathEdges: row.best_path_edges || []
    };
  } catch (e) {
    console.warn(`[live-arp] failed for asset ${assetId}:`, (e as any)?.message);
    return null;
  }
}

async function calculateArpWithOracle(
  c: PoolClient,
  routerId: number,
  currentBucket: number
): Promise<void> {
  console.log('[arp] Starting ARP calculation:', { routerId, bucket: new Date(currentBucket).toISOString() });
  
  const FRESHNESS_THRESHOLD = MINUTE;
  let xelUsdRate = 0;
  
  // Get XEL asset ID for filtering
  const xelAssetResult = await c.query(
    `SELECT id FROM assets WHERE hash = $1`,
    [Buffer.from(NATIVE_ASSET_HASH.replace(/^0x/, ''), 'hex')]
  );
  const xelAssetId = xelAssetResult.rows[0]?.id;
  
  // Try to get live price from Redis first
  try {
    const redis = await ensureRedis();
    const arpKey = `arp:${NATIVE_ASSET_HASH.toLowerCase().replace(/^0x/, '')}:usd`;
    const liveData = await redis.hGet(arpKey, '1');
    
    if (liveData) {
      const parsed = JSON.parse(liveData);
      const dataAge = currentBucket - Number(parsed.t || 0);
      
      if (dataAge < FRESHNESS_THRESHOLD) {
        xelUsdRate = Number(parsed.c || parsed.close || 0);
        console.log('[arp] Oracle XEL/USD rate from Redis:', xelUsdRate, 
          `(age: ${Math.round(dataAge / 1000)}s)`);
      } else {
        console.warn('[arp] Redis data too old:', {
          age: Math.round(dataAge / 1000),
          timestamp: new Date(Number(parsed.t)).toISOString()
        });
      }
    }
  } catch (e) {
    console.warn('[arp] Failed to get oracle price from Redis:', (e as any)?.message);
  }
  
  // Fallback to database if Redis failed or data was stale
  if (!xelUsdRate) {
    const minTimestamp = currentBucket - FRESHNESS_THRESHOLD;
    const xelHashBuf = Buffer.from(NATIVE_ASSET_HASH.replace(/^0x/, ''), 'hex');

    const oraclePrice = await c.query(
      `SELECT price_in_anchor, t_start 
      FROM arp_points_1m 
      WHERE router_id = (SELECT id FROM routers WHERE router = 'ORACLE')
        AND asset_id = (SELECT id FROM assets WHERE hash = $1::bytea)
        AND anchor_id = (
          SELECT id FROM anchors 
          WHERE router_id = (SELECT id FROM routers WHERE router = 'ORACLE')
            AND name = 'USD'  -- Just match by name, not target_asset_id
        )
        AND t_start >= $2
      ORDER BY t_start DESC 
      LIMIT 1`,
      [xelHashBuf, minTimestamp]
    );
        
    if (oraclePrice.rows[0]) {
      xelUsdRate = Number(oraclePrice.rows[0].price_in_anchor);
      const age = currentBucket - Number(oraclePrice.rows[0].t_start);
      console.log('[arp] Oracle XEL/USD rate from DB:', xelUsdRate, 
        `(age: ${Math.round(age / 1000)}s)`);
    }
  }
  
  if (!xelUsdRate) {
    console.warn('[arp] No fresh oracle XEL/USD price available (nothing within last 5 minutes)');
    return;
  }

  // Get anchors for the current router (not oracle router)
  const anchors = await c.query(
    `SELECT a.id, a.name, a.target_asset_id 
     FROM anchors a
     JOIN assets ast ON ast.id = a.target_asset_id
     WHERE a.router_id = $1 
       AND a.active = true`,
    [routerId]
  );
  
  for (const anchor of anchors.rows) {
    console.log(`[arp] Processing anchor: ${anchor.name} (id=${anchor.id})`);
    
    // Get assets with DEX paths (non-virtual assets only, EXCLUDING XEL)
    const assetsWithPaths = await c.query(
      `SELECT DISTINCT rp.asset_id, rp.path_rank, rp.edges,
              a.ticker, a.decimals, a.meta
      FROM routing_paths rp
      JOIN assets a ON a.id = rp.asset_id
      WHERE rp.router_id = $1 
        AND rp.anchor_id = $2
        AND (a.meta->>'virtual' IS NULL OR a.meta->>'virtual' != 'true')
      ORDER BY rp.asset_id, rp.path_rank`,
      [routerId, anchor.id]
    );

    console.log(`[arp] Query returned ${assetsWithPaths.rows.length} rows (excluding XEL)`);
    console.log('[arp] Sample rows:', assetsWithPaths.rows.slice(0, 3));

    // Group paths by asset
    const assetPaths = new Map<number, {
      ticker: string;
      decimals: number;
      meta: any;
      paths: Array<{rank: number, edges: number[]}>
    }>();
    
    for (const row of assetsWithPaths.rows) {
      if (!assetPaths.has(row.asset_id)) {
        assetPaths.set(row.asset_id, {
          ticker: row.ticker,
          decimals: row.decimals,
          meta: row.meta,
          paths: []
        });
      }
      assetPaths.get(row.asset_id)!.paths.push({
        rank: row.path_rank,
        edges: row.edges
      });
    }

    console.log(`[arp] Found ${assetPaths.size} non-virtual assets with DEX paths for anchor ${anchor.name} (XEL excluded)`);

    // Process each asset with DEX paths
    for (const [assetId, assetData] of assetPaths) {
      if (assetId === xelAssetId && anchor.name === 'XEL') {
        continue;
      }
      try {
        const pathSimulations: ScoredPath[] = [];
        
        // Simulate each path
        for (const path of assetData.paths) {
          console.log(`[arp] Processing asset ${assetId} (${assetData.ticker}), ${assetData.paths.length} paths`);
          try {
            const reserves = await getPathReserves(c, routerId, path.edges, xelUsdRate);
            const simulation = simulatePathTrade(
              path.edges, 
              reserves, 
              xelUsdRate,
              100
            );
            
            pathSimulations.push({
              rank: path.rank,
              edges: path.edges,
              hopCount: path.edges.length,
              simulation
            });
          } catch (e) {
            console.warn(`[arp] Path simulation failed for asset ${assetId}, rank ${path.rank}:`, 
              (e as Error).message);
            pathSimulations.push({
              rank: path.rank,
              edges: path.edges,
              hopCount: path.edges.length,
              simulation: null
            });
          }
        }

        // Filter successful simulations
        const validSims = pathSimulations.filter(p => p.simulation?.success);
        
        if (validSims.length === 0) {
          console.warn(`[arp] No valid simulations for asset ${assetId}`);
          continue;
        }

        // Calculate weighted average price (in XEL terms from simulation)
        let weightSum = 0;
        let weightedSum = 0;
        
        for (const path of validSims) {
          const conf = path.simulation!.confidence;
          const price = path.simulation!.effectivePrice; // This is in XEL terms
          
          weightSum += conf;
          weightedSum += price * conf;
        }
        
        if (weightSum === 0) continue;
        
        const weightedPriceInXel = weightedSum / weightSum; // Asset price in XEL terms
        const bestPath = validSims.reduce((best, curr) => 
          (curr.simulation!.confidence > best.simulation!.confidence) ? curr : best
        );

        // Convert to final anchor terms
        let finalPrice: number;
        if (anchor.name === 'USD') {
          // Convert XEL price to USD using oracle rate
          finalPrice = weightedPriceInXel * xelUsdRate;
        } else if (anchor.name === 'XEL') {
          // Already in XEL terms
          finalPrice = weightedPriceInXel;
        } else {
          // For other anchors, would need additional conversion
          finalPrice = weightedPriceInXel;
        }
        
        const assetHashResult = await c.query(
          `SELECT hash FROM assets WHERE id = $1`,
          [assetId]
        );

        console.log(`[arp] Asset ${assetId} (${assetData.ticker}) → ${anchor.name}: ${finalPrice.toFixed(8)} ` +
          `(XEL price: ${weightedPriceInXel.toFixed(8)}, confidence: ${bestPath.simulation!.confidence.toFixed(3)})`);

        await c.query(
          `INSERT INTO arp_points_1m (
            router_id, anchor_id, asset_id, t_start,
            price_in_anchor, confidence_score, best_path_edges, 
            hop_count, flags
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (router_id, anchor_id, asset_id, t_start)
          DO UPDATE SET 
            price_in_anchor = EXCLUDED.price_in_anchor,
            confidence_score = EXCLUDED.confidence_score,
            best_path_edges = EXCLUDED.best_path_edges,
            hop_count = EXCLUDED.hop_count,
            updated_at = now()`,
          [
            routerId,
            anchor.id,
            assetId,
            currentBucket,
            finalPrice,
            bestPath.simulation!.confidence,
            bestPath.edges,
            bestPath.hopCount,
            ['dex_simulation']
          ]
        );
        console.log(`[arp] Asset ${assetId}: ${validSims.length} valid sims out of ${pathSimulations.length} total`);

        // Cross-anchor derivation (XEL → USD)
        if (anchor.name === 'XEL') {
          const usdAnchor = anchors.rows.find(a => a.name === 'USD');
          if (usdAnchor) {
            const finalPriceUsd = finalPrice * xelUsdRate;
            
            await c.query(
              `INSERT INTO arp_points_1m (
                router_id, anchor_id, asset_id, t_start,
                price_in_anchor, confidence_score, best_path_edges, 
                hop_count, flags
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT (router_id, anchor_id, asset_id, t_start)
              DO UPDATE SET 
                price_in_anchor = EXCLUDED.price_in_anchor,
                confidence_score = EXCLUDED.confidence_score,
                best_path_edges = EXCLUDED.best_path_edges,
                hop_count = EXCLUDED.hop_count,
                updated_at = now()`,
              [
                routerId, usdAnchor.id, assetId, currentBucket,
                finalPriceUsd, bestPath.simulation!.confidence,
                bestPath.edges, bestPath.hopCount, ['dex_simulation_derived']
              ]
            );
          }
        }
      } catch (e) {
        console.error(`[arp] Failed to calculate ARP for asset ${assetId}:`, 
          (e as Error).message);
      }
    }
  }

  // NOTE: Removed the direct oracle price writes for XEL and USD
  // The oracle handles XEL/USD pricing directly
  console.log('[arp] Completed ARP calculation (XEL prices handled by oracle)');
}

// -------------------------------
// Utility queries (ID-based)
// -------------------------------
async function pairsSeenSince(c: PoolClient, routerId: number, cutoffMs: number): Promise<number[]> {
  const { rows } = await c.query(
    `SELECT DISTINCT pair_id
       FROM candles_1m
      WHERE router_id = $1 AND t_start >= $2
      LIMIT 2000`,
    [routerId, cutoffMs]
  );
  return rows.map(r => Number(r.pair_id));
}

async function carryForwardPair(
  c: PoolClient, 
  routerId: number, 
  pairId: number, 
  currentBucket: number
): Promise<void> {
  const last = await c.query(
    `SELECT t_start, c
     FROM candles_1m
     WHERE router_id=$1 AND pair_id=$2
     ORDER BY t_start DESC
     LIMIT 1`,
    [routerId, pairId]
  );
  if (!last.rows.length) return;

  let lastT = Number(last.rows[0].t_start);
  let close = Number(last.rows[0].c);
  
  // Batch insert for efficiency if gap is large
  const MAX_BATCH = 1000; // Don't insert more than 1000 at once
  const candles = [];
  
  while (lastT + MINUTE <= currentBucket && candles.length < MAX_BATCH) {
    const t = lastT + MINUTE;
    candles.push({
      router_id: routerId,
      pair_id: pairId,
      t_start: t,
      o: close,
      h: close,
      l: close,
      c: close,
      v: 0
    });
    lastT = t;
  }
  
  // Batch insert
  if (candles.length > 0) {
    const values = candles.map((_, i) => 
      `($${i*8+1},$${i*8+2},$${i*8+3},$${i*8+4},$${i*8+5},$${i*8+6},$${i*8+7},$${i*8+8})`
    ).join(',');
    
    const params = candles.flatMap(c => 
      [c.router_id, c.pair_id, c.t_start, c.o, c.h, c.l, c.c, c.v]
    );
    
    await c.query(
      `INSERT INTO candles_1m (router_id, pair_id, t_start, o, h, l, c, v)
       VALUES ${values}
       ON CONFLICT (router_id, pair_id, t_start) DO NOTHING`,
      params
    );
    
    console.log(`[candle] Inserted ${candles.length} carry-forward candles for pair ${pairId}`);
    
    // If we hit the batch limit, recurse to continue
    if (candles.length === MAX_BATCH && lastT < currentBucket) {
      await carryForwardPair(c, routerId, pairId, currentBucket);
    }
  }
}

// -------------------------------
// Main builder (oracle writes candles directly; swaps → candles here)
// -------------------------------
export async function startCandleBuilder(pool: Pool, router: string) {
  console.log('[candle] starting… router=%s', router);
  if (!router || typeof router !== 'string' || router.length < 8) {
    throw new Error('ROUTER_CONTRACT is missing/invalid');
  }

  // Become leader or standby
  if (!(await tryBecomeLeader(pool, router))) {
    console.log('[candle] standby (another leader active). Retrying…');
    const timer = setInterval(async () => {
      if (await tryBecomeLeader(pool, router)) {
        clearInterval(timer);
        startCandleBuilder(pool, router).catch(err => console.error('[candle] restart failed', err));
      }
    }, 3000);
    return;
  }
  console.log('[candle] became leader for router=%s', router);

  // Resolve router_id once and remember router string for live keys
  const routerId = await getOrCreateRouterId(pool, router);
  const routerStr = router;

  console.log('[candle] waiting for XEL asset to be created...');
  const xelHashBuf = Buffer.from(NATIVE_ASSET_HASH.replace(/^0x/, ''), 'hex');
  let xelAssetId: number;

  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const startTime = Date.now();

  while (true) {
    try {
      const result = await pool.query(
        `SELECT id FROM assets WHERE hash = $1`,
        [xelHashBuf]
      );
      
      if (result.rows[0]) {
        xelAssetId = result.rows[0].id;
        console.log(`[candle] XEL asset found (id=${xelAssetId}), continuing startup...`);
        break;
      }
      
      const elapsed = Date.now() - startTime;
      if (elapsed > maxWaitTime) {
        throw new Error(`XEL asset not found after ${maxWaitTime/1000}s - indexer may not be running`);
      }
      
      console.log(`[candle] XEL asset not found, waiting... (${Math.round(elapsed/1000)}s elapsed)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (e) {
      if ((e as Error).message.includes('XEL asset not found after')) {
        throw e; // Re-throw timeout error
      }
      console.error('[candle] error checking for XEL asset:', e);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  await runInTx(pool, async (c) => {
    // Check if XEL anchor exists (should target XEL, not USD)
    const existingAnchor = await c.query(
      `SELECT id FROM anchors WHERE router_id = $1 AND name = 'XEL' AND active = true`,
      [routerId]
    );

    const xelHashBuf = Buffer.from(NATIVE_ASSET_HASH.replace(/^0x/, ''), 'hex');
    
    if (!existingAnchor.rows[0]) {
      console.log('[arp] Setting up XEL anchor...');
      
      // Get XEL asset
      const xelAsset = await c.query(
        `SELECT id FROM assets WHERE hash = $1`,
        [xelHashBuf]
      );
      
      if (xelAsset.rows[0]) {
        await c.query(
          `INSERT INTO anchors (name, router_id, pair_id, target_asset_id, active)
          VALUES ('XEL', $1, NULL, $2, true)
          ON CONFLICT (router_id, name) DO UPDATE SET
            target_asset_id = EXCLUDED.target_asset_id,
            active = true`,
          [routerId, xelAsset.rows[0].id]  // Target XEL asset directly
        );
        console.log('[arp] XEL anchor created successfully');
      } else {
        console.warn('[arp] Could not create XEL anchor - XEL asset not found');
      }
    }
    
    // Also ensure USD anchor exists for USD pricing (uses XEL paths + oracle)
    const usdAnchor = await c.query(
      `SELECT id FROM anchors WHERE router_id = $1 AND name = 'USD' AND active = true`,
      [routerId]
    );
    
    if (!usdAnchor.rows[0]) {
      console.log('[arp] Setting up USD anchor...');
      
      const usdAsset = await c.query(
        `SELECT id FROM assets WHERE hash = $1`,
        [Buffer.from(VIRTUAL_USD.hashHex.replace(/^0x/, ''), 'hex')]
      );
      
      if (usdAsset.rows[0]) {
        await c.query(
          `INSERT INTO anchors (name, router_id, pair_id, target_asset_id, active)
          VALUES ('USD', $1, NULL, $2, true)
          ON CONFLICT (router_id, name) DO UPDATE SET
            target_asset_id = EXCLUDED.target_asset_id,
            active = true`,
          [routerId, usdAsset.rows[0].id]  // Target USD asset
        );
        console.log('[arp] USD anchor created successfully');
      }
    }
  });

  // Init Redis (best-effort; liveCache is safe even if this fails)
  try {
    await ensureRedis();
    redisInitialized = true;
    console.log('[redis] connected');
  } catch (e: any) {
    console.error('[redis] init failed; starting background retry. error=', e?.message ?? e);
    // Start background retry loop - won't block startup
    retryRedisInit().catch(e => console.error('[redis] retry loop crashed:', e));
  }

  // Warm checkpoint
  let last = await runInTx(pool, c => loadCheckpoint(c, routerId)); // { ts: number, id: string }

  // Initial carry-forward to align existing pairs up to the current bucket
  await runInTx(pool, async (c) => {
    const now = Date.now();
    const currentBucket = Math.floor(now / MINUTE) * MINUTE;
    
    // Find ALL pairs that have ANY candles, regardless of age
    const { rows } = await c.query(
      `SELECT DISTINCT pair_id, MAX(t_start) as last_candle
      FROM candles_1m
      WHERE router_id = $1
      GROUP BY pair_id`,
      [routerId]
    );
    
    console.log(`[candle] Found ${rows.length} pairs to check for carry-forward`);
    
    for (const row of rows) {
      const pairId = Number(row.pair_id);
      const lastCandle = Number(row.last_candle);
      
      // Check if there's a gap
      const gapMinutes = Math.floor((currentBucket - lastCandle) / MINUTE);
      
      if (gapMinutes > 1) {
        console.log(`[candle] Pair ${pairId} has ${gapMinutes} minute gap, carrying forward`);
        await carryForwardPair(c, routerId, pairId, currentBucket);
      }
    }
  });

  // Optional: start oracle (independent; it writes 1m bars for XEL_USD)
  let oracle: OracleHandle | null = null;
  try {
    if (process.env.DISABLE_XEL_USD_ORACLE !== '1') {
      oracle = await startXelUsdOracle(pool);
    }
  } catch (e) {
    console.warn('[candle] oracle start failed (continuing without):', (e as any)?.message ?? e);
  }

  const loop = async () => {
    try {
      const now = Date.now();
      const currentBucket = Math.floor(now / MINUTE) * MINUTE;

      await runInTx(pool, async (c) => {
        const { rows } = await c.query(
          `SELECT id, pair_id, ts_ms, price, base_in
            FROM swaps
            WHERE router_id = $1
              AND (ts_ms, id) > ($2, $3)       -- tuple cursor (avoids same-ts drops)
            ORDER BY ts_ms ASC, id ASC
            LIMIT $4`,
          [routerId, last.ts, last.id, BATCH]
        );

        const touched = new Set<number>();
        const buckets = new Map<string, MinuteBar>(); // closed-minute aggregates only

        if (rows.length) {
          for (const r of rows) {
            const pairId = Number(r.pair_id);
            const ts = Number(r.ts_ms);
            const px = Number(r.price);
            const vol = Number(r.base_in);
            const t = Math.floor(ts / MINUTE) * MINUTE;

            touched.add(pairId);

            if (t < currentBucket) {
              const key = `${pairId}:${t}`;
              const cur = buckets.get(key);
              if (!cur) {
                buckets.set(key, { pairId, t, o: px, h: px, l: px, c: px, v: vol });
              } else {
                if (px > cur.h) cur.h = px;
                if (px < cur.l) cur.l = px;
                cur.c = px;
                cur.v += vol;
              }
            } else if (t === currentBucket) {
              // keep open minute in RAM only + live tick
              mergeIntoOpen(pairId, t, px, vol);
              try {
                const liveKey = await getLiveKeyByPairId(c, routerStr, pairId);
                updateLiveBar(liveKey, '1', px, vol, ts);
              } catch {}
            }

            // advance tuple cursor each row (ends up at the last row of the batch)
            last = { ts, id: String(r.id) };
          }

          // write closed-minute buckets
          for (const [, bar] of buckets) {
            await upsertCandle1m(c, {
              router_id: routerId,
              pair_id: bar.pairId,
              t_start: bar.t,
              o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v
            });
          }

          // persist checkpoint AFTER DB writes
          await saveCheckpoint(c, routerId, last.ts, last.id);

          // publish authoritative snapshots for the closed buckets we just wrote
          for (const [, bar] of buckets) {
            if (bar.t < currentBucket) {
              try {
                const liveKey = await getLiveKeyByPairId(c, routerStr, bar.pairId);
                updateLiveBar(liveKey, '1', { t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
              } catch {}
            }
          }
        }

        // flush any open buckets that just rolled over
        await flushRolledBuckets(c, routerStr, routerId, currentBucket);

        // carry-forward touched pairs up to current bucket
        for (const pairId of touched) {
          await carryForwardPair(c, routerId, pairId, currentBucket);
        }

        // Update routing paths periodically (every 5 minutes or when new pairs seen)
        const shouldUpdateAllRoutes = Math.floor(now / 10_000) % Math.floor(ROUTE_UPDATE_MS / 10_000) === 0;

        if (shouldUpdateAllRoutes) {
          // Periodic update - ALL assets
          console.log('[loop] Periodic routing path update (all assets)');
          
          const assetIds = await c.query(
            `SELECT DISTINCT asset_id FROM (
              SELECT base_asset_id as asset_id FROM pair_components
              UNION
              SELECT quote_asset_id as asset_id FROM pair_components
            ) t
            JOIN assets a ON a.id = t.asset_id
            WHERE a.meta->>'virtual' IS NULL OR a.meta->>'virtual' != 'true'`
          );
          
          console.log(`[loop] Updating paths for ${assetIds.rows.length} assets`);
          
          const anchors = await c.query(
            `SELECT id, name FROM anchors WHERE router_id = $1 AND active = true`,
            [routerId]
          );
          
          for (const anchor of anchors.rows) {
            await updateRoutingPaths(c, routerId, anchor.id, assetIds.rows.map(r => r.asset_id));
          }
          
        } else if (touched.size > 0) {
          // Immediate update - only touched assets
          console.log('[loop] Immediate routing update for touched pairs:', touched.size);
          
          const assetIds = await c.query(
            `SELECT DISTINCT base_asset_id as id FROM pair_components 
            WHERE pair_id = ANY($1)
            UNION
            SELECT DISTINCT quote_asset_id as id FROM pair_components 
            WHERE pair_id = ANY($1)`,
            [[...touched]]
          );
          
          console.log(`[loop] Updating paths for ${assetIds.rows.length} touched assets`);
          
          const anchors = await c.query(
            `SELECT id, name FROM anchors WHERE router_id = $1 AND active = true`,
            [routerId]
          );
          
          for (const anchor of anchors.rows) {
            await updateRoutingPaths(c, routerId, anchor.id, assetIds.rows.map(r => r.id));
          }
        }

        if (Math.floor(now / 10_000) % Math.floor(DB_ARP_UPDATE_MS / 10_000) === 0 || touched.size > 0) {
          await calculateArpWithOracle(c, routerId, currentBucket);
        }

        if (Math.floor(now / 10_000) % Math.floor(LIVE_ARP_UPDATE_MS / 10_000) === 0 ) {
          const cutoff = now - CARRY_SWEEP_WINDOW_MS;
          const recentPairIds = await pairsSeenSince(c, routerId, cutoff);
          
          // Carry forward candles for recent pairs
          for (const pairId of recentPairIds) {
            if (!touched.has(pairId)) {
              await carryForwardPair(c, routerId, pairId, currentBucket);
            }
          }
          
          const recentAssets = await c.query(
            `SELECT DISTINCT asset_id, encode(a.hash,'hex') as hash_hex
            FROM (
              SELECT base_asset_id as asset_id FROM pair_components WHERE pair_id = ANY($1)
              UNION
              SELECT quote_asset_id as asset_id FROM pair_components WHERE pair_id = ANY($1)
            ) t
            JOIN assets a ON a.id = t.asset_id`,
            [recentPairIds]
          );
          
          // Calculate live ARP for each asset
          for (const asset of recentAssets.rows) {
            const arpData = await calculateLiveArpData(c, routerId, asset.asset_id);
            
            if (arpData !== null) {
              try {
                await updateLiveArp(
                  String(asset.hash_hex).toLowerCase(),
                  'usd',
                  {
                    timestamp: currentBucket,
                    ...arpData
                  }
                );
              } catch (e) {
                console.warn(`[live-arp] failed to update Redis for asset ${asset.asset_id}:`, e);
              }
            }
          }
        }

        if (Math.floor(now / 10_000) % 6 === 0) {  // Every minute
          const diagnostics = await c.query(`
            SELECT 
              (SELECT COUNT(*) FROM routing_paths WHERE router_id = $1) as total_paths,
              (SELECT COUNT(DISTINCT asset_id) FROM routing_paths WHERE router_id = $1) as assets_with_paths,
              (SELECT COUNT(*) FROM arp_points_1m WHERE router_id = $1) as total_arp_points,
              (SELECT COUNT(DISTINCT asset_id) FROM arp_points_1m WHERE router_id = $1) as assets_with_arp
          `, [routerId]);
          
          console.log('[diagnostics]', diagnostics.rows[0]);
        }
      });

      // Spawn ARP maintenance (once per day at specified hour)
      backgroundArpMaintenance(pool, routerId, now)
        .catch(e => console.error('[arp-maintenance] Spawn error:', e));
      
      // Spawn candle rollup (every 5 minutes)
      backgroundCandleRollup(pool, routerId, now)
        .catch(e => console.error('[candle-rollup] Spawn error:', e));

      await new Promise(r => setTimeout(r, TICK_MS));
    } catch (e) {
      console.error('[candle] loop error:', e);
      await new Promise(r => setTimeout(r, 1000));
    } finally {
      setImmediate(loop);
    }
  };

  loop();

  const gracefulExit = async () => {
    try {
      if (oracle) oracle.stop();
      await relinquish(pool, router);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', gracefulExit);
  process.on('SIGTERM', gracefulExit);
}