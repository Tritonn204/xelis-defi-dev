import { Pool } from 'pg';
import { fromEnvOrFile } from '@forge-backend/shared/utils/env';
import type { Bar, Res } from '@forge-backend/shared/utils/types';

/* ---------------------------------- pool ---------------------------------- */

const DATABASE_URL = fromEnvOrFile('DATABASE_URL');
if (!DATABASE_URL) throw new Error('Missing DATABASE_URL or DATABASE_URL_FILE');

const DEFAULT_AMM_ROUTER =
  fromEnvOrFile('DEFAULT_AMM_ROUTER') ||
  process.env.ROUTER_CONTRACT || '';  // your AMM router addr

export const CANDLE_TABLES: Record<string, string> = {
  '1': 'candles_1m',
  '5': 'candles_5m',
  '15': 'candles_15m',
  '60': 'candles_1h',
  '240': 'candles_4h',
  '1D': 'candles_1d',
  '1W': 'candles_1w',
  '1M': 'candles_1mo',
};

export const pool = new Pool({ connectionString: DATABASE_URL });

/* --------------------------------- caches --------------------------------- */

const pairIdCache   = new Map<string, number>(); // key: UPPERCASE symbol (e.g., TKN_XEL)
const routerIdCache = new Map<string, number>(); // key: normalized router string (see normalizeRouter)

/* ------------------------------ normalizers ------------------------------- */

export const normalizeSymbol = (s: string) => s.toUpperCase();
/**
 * For router strings:
 * - USD pairs use the special logical router "ORACLE" (case-insensitive → "ORACLE")
 * - LP pairs use the router contract as-is (do NOT case-normalize addresses)
 */
export function normalizeRouter(s: string): string {
  return s.toUpperCase() === 'ORACLE' ? 'ORACLE' : s;
}

export const isUsdPair = (symbol: string) => /_USD$/i.test(symbol);

/* -------------------------- router/pair id lookups ------------------------- */

export async function getPairIdBySymbol(symbol: string): Promise<number | null> {
  const key = normalizeSymbol(symbol);
  const hit = pairIdCache.get(key);
  if (hit) return hit;

  const { rows } = await pool.query(
    `SELECT id FROM pairs WHERE symbol=$1 LIMIT 1`,
    [key]
  );
  if (!rows.length) return null;

  const id = Number(rows[0].id);
  pairIdCache.set(key, id);
  return id;
}

export async function resolveAssetHash(tickerOrHash: string): Promise<{ hash: string; isUnique: boolean } | null> {
  // First check if it's already a hash (64 char hex)
  if (/^[0-9a-f]{64}$/i.test(tickerOrHash)) {
    const { rows } = await pool.query(
      `SELECT encode(hash,'hex') as hash FROM assets WHERE hash = $1::bytea`,
      [Buffer.from(tickerOrHash.toLowerCase(), 'hex')]
    );
    return rows[0] ? { hash: rows[0].hash, isUnique: true } : null;
  }
  
  // Otherwise treat as ticker and check uniqueness
  const { rows } = await pool.query(
    `SELECT encode(hash,'hex') as hash, ticker FROM assets WHERE UPPER(ticker) = UPPER($1)`,
    [tickerOrHash]
  );
  
  if (rows.length === 0) return null;
  if (rows.length === 1) return { hash: rows[0].hash, isUnique: true };
  
  // Multiple assets with same ticker - not unique!
  return { hash: rows[0].hash, isUnique: false };
}

export async function getAssetsWithTicker(ticker: string): Promise<Array<{ hash: string; ticker: string; id: number }>> {
  const { rows } = await pool.query(
    `SELECT id, encode(hash,'hex') as hash, ticker 
     FROM assets 
     WHERE UPPER(ticker) = UPPER($1)
     ORDER BY id`,
    [ticker]
  );
  return rows;
}

export async function getAssetByTicker(ticker: string): Promise<{id: number, hash: string} | 'multiple' | null> {
  const { rows } = await pool.query(
    `SELECT id, encode(hash,'hex') as hash FROM assets WHERE ticker = $1`,
    [ticker.toUpperCase()]
  );
  
  if (rows.length === 0) return null;
  if (rows.length > 1) return 'multiple';
  return { id: rows[0].id, hash: rows[0].hash };
}

export async function getAssetByHash(hashHex: string): Promise<{id: number, ticker: string} | null> {
  const { rows } = await pool.query(
    `SELECT id, ticker FROM assets WHERE hash = $1::bytea`,
    [Buffer.from(hashHex.toLowerCase(), 'hex')]
  );
  return rows[0] ? { id: rows[0].id, ticker: rows[0].ticker } : null;
}

export async function parseAssetSymbol(input: string): Promise<{id: number, hash: string, ticker: string} | 'multiple_tickers' | 'not_found'> {
  if (!input) return 'not_found';
  
  // Check if it looks like a hex hash (40+ hex chars)
  if (/^0?x?[0-9a-f]{40,}$/i.test(input)) {
    const cleanHash = input.replace(/^0?x/, '').toLowerCase();
    const asset = await getAssetByHash(cleanHash);
    if (!asset) return 'not_found';
    return { id: asset.id, hash: cleanHash, ticker: asset.ticker };
  }
  
  // Treat as ticker
  const result = await getAssetByTicker(input);
  if (result === null) return 'not_found';
  if (result === 'multiple') return 'multiple_tickers';
  
  return { id: result.id, hash: result.hash, ticker: input.toUpperCase() };
}

export async function getPairIdByHashes(aHash: string, bHash: string): Promise<number | null> {
  const a = aHash.toLowerCase();
  const b = bHash.toLowerCase();
  const [aCanon, bCanon] = a < b ? [a, b] : [b, a];
  
  const { rows } = await pool.query(
    `SELECT id FROM pairs WHERE a_hash = $1::bytea AND b_hash = $2::bytea`,
    [Buffer.from(aCanon, 'hex'), Buffer.from(bCanon, 'hex')]
  );
  return rows[0]?.id || null;
}

export async function getRouterIdByContract(contract: string): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT id FROM routers WHERE router = $1`,
    [contract]
  );
  return rows[0]?.id || null;
}

/**
 * Rule: USD pairs use router "ORACLE"; LP pairs must provide `routerParam`.
 * Returns normalized router string + concrete ids (throws if unknown/missing).
 */
export async function resolveIds(
  pool: Pool,
  reqSymbol: string,
  routerParam?: string
): Promise<{ routerStr: string; routerId: number; pairId: number; usedSymbol: string; inverted: boolean }> {

  const symbol = reqSymbol.toUpperCase();
  const usdPair = isUsdPair(symbol);

  // Restore logic: USD pairs → ORACLE, else DEFAULT_AMM_ROUTER (unless user overrides)
  const chosen = routerParam && routerParam.length > 0
    ? routerParam
    : (usdPair ? 'ORACLE' : DEFAULT_AMM_ROUTER);

  if (!chosen) {
    throw new Error('router_required'); // no default AMM router configured
  }

  const routerStr = normalizeRouter(chosen); // keeps ORACLE upper, leaves addrs untouched
  const routerId = await getRouterIdByContract(routerStr);
  if (routerId == null) throw new Error('router_not_found');

  // Orientation lookup (unchanged)
  let pairId = await getPairIdBySymbol(symbol);
  let usedSymbol = symbol;
  let inverted = false;

  if (pairId == null) {
    const rev = reverseSymbol(symbol);
    pairId = await getPairIdBySymbol(rev);
    if (pairId != null) {
      usedSymbol = rev;
      inverted = true;
    }
  }

  if (pairId == null) throw new Error('pair_not_found');

  return { routerStr, routerId, pairId, usedSymbol, inverted };
}

/** Optional boot-time cache warmup (nice to have). */
export async function preloadCaches(): Promise<void> {
  try {
    const rs = await pool.query<{ id: number; router: string }>(`SELECT id, router FROM routers`);
    for (const r of rs.rows) routerIdCache.set(normalizeRouter(r.router), Number(r.id));
  } catch {}
  try {
    const ps = await pool.query<{ id: number; symbol: string }>(`SELECT id, symbol FROM pairs`);
    for (const p of ps.rows) pairIdCache.set(normalizeSymbol(p.symbol), Number(p.id));
  } catch {}
}

export function clearCaches() {
  routerIdCache.clear();
  pairIdCache.clear();
}

/* ------------------------------ resolution map ---------------------------- */

const RES_TO_MIN: Record<string, number> = {
  '1':1,'5':5,'15':15,'60':60,'240':240,'1D':1440,'1W':10080,'1M':43200
};

export function bucketMs(resolution: Res | string): number {
  const mins = RES_TO_MIN[String(resolution)] ?? 1;
  return mins * 60_000;
}

/* ----------------------------- candle queries ----------------------------- */

export async function queryCandles(
  routerId: number,
  pairId: number,
  resolution: string,
  fromMs: number,
  toMs: number
): Promise<Bar[]> {
  const table = CANDLE_TABLES[resolution] || 'candles_1m';
  
  const { rows } = await pool.query(
    `SELECT t_start as t, o, h, l, c, v
     FROM ${table}
     WHERE router_id = $1 
       AND pair_id = $2
       AND t_start >= $3 
       AND t_start <= $4
     ORDER BY t_start`,
    [routerId, pairId, fromMs, toMs]
  );
  
  return rows.map(r => ({
    t: Number(r.t),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: Number(r.v || 0),
  }));
}

export function reverseSymbol(sym: string): string {
  const m = sym.toUpperCase().match(/^([^_/]+)[_/-]([^_/]+)$/);
  if (!m) return sym.toUpperCase();
  return `${m[2]}_${m[1]}`;
}

export async function queryArpHistory(
  routerId: number,
  assetId: number,
  anchor: string,
  fromMs: number,
  toMs: number
): Promise<Array<{t: number, price: number, confidence: number, hops: number}>> {
  
  const now = Date.now();
  const thirtyDaysAgo = now - (30 * 86400000);
  const ninetyDaysAgo = now - (90 * 86400000);
  const oneYearAgo = now - (365 * 86400000);
  
  // Get anchor ID
  const { rows: anchorRows } = await pool.query(
    `SELECT id FROM anchors WHERE router_id = $1 AND name = $2 AND active = true`,
    [routerId, anchor]
  );
  
  if (!anchorRows.length) return [];
  const anchorId = anchorRows[0].id;
  
  const queries: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;
  
  // Recent data (< 30 days) from 1m table
  if (toMs >= thirtyDaysAgo) {
    queries.push(`
      SELECT t_start as t, price_in_anchor as price, 
             confidence_score as confidence, hop_count as hops
      FROM arp_points_1m
      WHERE router_id = $${paramIndex++}
        AND anchor_id = $${paramIndex++}
        AND asset_id = $${paramIndex++}
        AND t_start >= $${paramIndex++}
        AND t_start <= $${paramIndex++}
    `);
    params.push(routerId, anchorId, assetId, 
                Math.max(fromMs, thirtyDaysAgo), toMs);
  }
  
  // 30-90 days from 5m table
  if (fromMs < thirtyDaysAgo && toMs >= ninetyDaysAgo) {
    queries.push(`
      SELECT t_start as t, price_in_anchor as price,
             confidence_score as confidence, hop_count as hops
      FROM arp_points_5m
      WHERE router_id = $${paramIndex++}
        AND anchor_id = $${paramIndex++}
        AND asset_id = $${paramIndex++}
        AND t_start >= $${paramIndex++}
        AND t_start < $${paramIndex++}
    `);
    params.push(routerId, anchorId, assetId,
                Math.max(fromMs, ninetyDaysAgo), 
                Math.min(toMs, thirtyDaysAgo));
  }
  
  // 90 days - 1 year from 1h table
  if (fromMs < ninetyDaysAgo && toMs >= oneYearAgo) {
    queries.push(`
      SELECT t_start as t, price_in_anchor as price,
             confidence_score as confidence, hop_count as hops
      FROM arp_points_1h
      WHERE router_id = $${paramIndex++}
        AND anchor_id = $${paramIndex++}
        AND asset_id = $${paramIndex++}
        AND t_start >= $${paramIndex++}
        AND t_start < $${paramIndex++}
    `);
    params.push(routerId, anchorId, assetId,
                Math.max(fromMs, oneYearAgo),
                Math.min(toMs, ninetyDaysAgo));
  }
  
  // > 1 year from 1d table
  if (fromMs < oneYearAgo) {
    queries.push(`
      SELECT t_start as t, price_in_anchor as price,
             confidence_score as confidence, hop_count as hops
      FROM arp_points_1d
      WHERE router_id = $${paramIndex++}
        AND anchor_id = $${paramIndex++}
        AND asset_id = $${paramIndex++}
        AND t_start >= $${paramIndex++}
        AND t_start < $${paramIndex++}
    `);
    params.push(routerId, anchorId, assetId,
                fromMs,
                Math.min(toMs, oneYearAgo));
  }
  
  if (queries.length === 0) return [];
  
  const fullQuery = queries.join(' UNION ALL ') + ' ORDER BY t';
  const { rows } = await pool.query(fullQuery, params);
  
  return rows.map(r => ({
    t: Number(r.t),
    price: Number(r.price),
    confidence: Number(r.confidence),
    hops: Number(r.hops)
  }));
}

export async function getLatestArpPrice(
  routerId: number,
  assetId: number,
  anchorName: string
): Promise<{ price: number; confidence: number; timestamp: number } | null> {
  const { rows } = await pool.query(
    `SELECT price_in_anchor as price, confidence_score as confidence, t_start as t
     FROM arp_points_1m
     WHERE router_id = $1
       AND anchor_id = (SELECT id FROM anchors WHERE router_id = $1 AND name = $2)
       AND asset_id = $3
     ORDER BY t_start DESC
     LIMIT 1`,
    [routerId, anchorName, assetId]
  );
  
  if (!rows[0]) return null;
  
  return {
    price: Number(rows[0].price),
    confidence: Number(rows[0].confidence),
    timestamp: Number(rows[0].t)
  };
}