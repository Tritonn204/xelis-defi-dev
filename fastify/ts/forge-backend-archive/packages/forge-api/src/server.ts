import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';

import type { Bar, Res } from '@forge-backend/shared/utils/types';
import { pairSymbol, parsePairSymbol } from '@forge-backend/shared/utils/symbols';
import { ensureRedisSub } from '@forge-backend/shared/adapters/redis';
import { getCandleCache } from './cache/candle';
import { alignTimeRange } from './utils/alignment';

import {
  pool,
  preloadCaches,
  queryCandles,
  getPairIdBySymbol,
  parseAssetSymbol,
  getAssetByTicker,
  getAssetByHash,
  getPairIdByHashes,
  getRouterIdByContract,
  queryArpHistory,
} from './db';

import { wireLiveWs } from './live-ws';
import { getArpCache } from './cache/arp';

const routerContractCache = new Map<number, string>();
const pairHashCache = new Map<number, { aHash: string, bHash: string }>();
const PAIR_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const pairCacheTimestamps = new Map<number, number>();

async function getRouterContract(routerId: number): Promise<string | null> {
  // Check cache first
  if (routerContractCache.has(routerId)) {
    return routerContractCache.get(routerId)!;
  }
  
  // Query and cache
  const { rows } = await pool.query(
    'SELECT router FROM routers WHERE id = $1',
    [routerId]
  );
  
  if (rows[0]?.router) {
    const contract = rows[0].router;
    routerContractCache.set(routerId, contract);
    return contract;
  }
  
  return null;
}

async function getPairHashes(pairId: number): Promise<{ aHash: string, bHash: string } | null> {
  // Check cache with TTL
  const cached = pairHashCache.get(pairId);
  const cachedTime = pairCacheTimestamps.get(pairId);
  
  if (cached && cachedTime && Date.now() - cachedTime < PAIR_CACHE_TTL) {
    return cached;
  }
  
  // Query and cache
  const { rows } = await pool.query(
    `SELECT encode(a_hash, 'hex') as a_hash, encode(b_hash, 'hex') as b_hash 
     FROM pairs WHERE id = $1`,
    [pairId]
  );
  
  if (rows[0]) {
    const hashes = {
      aHash: rows[0].a_hash,
      bHash: rows[0].b_hash
    };
    pairHashCache.set(pairId, hashes);
    pairCacheTimestamps.set(pairId, Date.now());
    return hashes;
  }
  
  return null;
}

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_AMM_ROUTER = process.env.ROUTER_CONTRACT || '';
const MINUTE = 60_000;

// -------------------------------
// Helper Functions
// -------------------------------

function normalizeSymbol(s: string): string {
  return (s || '').toUpperCase().replace('/', '_').replace('-', '_');
}

function reverseSymbol(s: string): string {
  const m = normalizeSymbol(s).match(/^([^_]+)_([^_]+)$/);
  if (!m) return normalizeSymbol(s);
  return `${m[2]}_${m[1]}`;
}

function invertBar(b: Bar): Bar {
  if (!b.o || !b.h || !b.l || !b.c) return b;
  return {
    t: b.t,
    o: 1 / b.o,
    h: 1 / b.l,
    l: 1 / b.h,
    c: 1 / b.c,
    v: b.v,
  };
}

function invertBars(bars: Bar[]): Bar[] {
  return bars.map(invertBar);
}

async function hasBars(routerId: number, pairId: number, fromMs: number, toMs: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM candles_1m WHERE router_id=$1 AND pair_id=$2 AND t_start BETWEEN $3 AND $4 LIMIT 1`,
    [routerId, pairId, fromMs, toMs]
  );
  return rows.length > 0;
}

function isUsdSymbol(sym: string): boolean {
  const m = normalizeSymbol(sym).match(/^([^_]+)_([^_]+)$/);
  if (!m) return false;
  return m[1] === 'USD' || m[2] === 'USD';
}

async function chooseRouterId(sym: string, routerParam?: string): Promise<number | null> {
  const routerStr = routerParam || (isUsdSymbol(sym) ? 'ORACLE' : DEFAULT_AMM_ROUTER);
  if (!routerStr) return null;
  return await getRouterIdByContract(routerStr);
}

async function pickHistorySource(
  routerId: number,
  reqSymbol: string,
  fromMs: number,
  toMs: number
): Promise<{ usedSymbol: string; pairId: number | null; inverted: boolean }> {
  const sym = normalizeSymbol(reqSymbol);
  const rev = reverseSymbol(sym);

  const [pairExact, pairRev] = await Promise.all([
    getPairIdBySymbol(sym),
    getPairIdBySymbol(rev),
  ]);

  const exactExists = pairExact != null;
  const revExists = pairRev != null;

  if (!exactExists && !revExists) {
    return { usedSymbol: sym, pairId: null, inverted: false };
  }

  if (exactExists && revExists) {
    const [hasExact, hasRev] = await Promise.all([
      hasBars(routerId, pairExact!, fromMs, toMs),
      hasBars(routerId, pairRev!, fromMs, toMs),
    ]);
    if (hasExact && !hasRev) return { usedSymbol: sym, pairId: pairExact!, inverted: false };
    if (!hasExact && hasRev) return { usedSymbol: rev, pairId: pairRev!, inverted: true };
    return { usedSymbol: sym, pairId: pairExact!, inverted: false };
  }

  if (exactExists) return { usedSymbol: sym, pairId: pairExact!, inverted: false };
  return { usedSymbol: rev, pairId: pairRev!, inverted: true };
}

// -------------------------------
// ARP Data Functions
// -------------------------------

async function getArpSparkline(
  reply: any,
  baseAsset: { id: number, hash: string, ticker: string },
  minutes: number,
  routerId: number,
  anchor: string = 'USD'
) {
  const now = Date.now();
  const requestedFrom = now - minutes * MINUTE;
  const requestedTo = now;

  // Server-side alignment for consistent caching
  // ARP data doesn't have resolution concept, treat as high-frequency (1m equivalent)
  const { alignedFrom, alignedTo } = alignTimeRange(requestedFrom, requestedTo, '1');

  // Try cache first with aligned boundaries
  const cache = await getArpCache();
  let history = await cache.get(routerId, baseAsset.id, anchor, alignedFrom, alignedTo);
  
  if (!history) {
    // Cache miss - query database using tiered tables with aligned range
    history = await queryArpHistory(routerId, baseAsset.id, anchor, alignedFrom, alignedTo);
    
    // Cache the result
    if (history.length > 0) {
      cache.set(routerId, baseAsset.id, anchor, alignedFrom, alignedTo, history)
        .catch(e => console.warn('[arp-cache] Failed to set:', e.message));
    }
  }

  // Filter to requested range (client gets exactly what they asked for)
  const filteredHistory = history.filter(h => h.t >= requestedFrom && h.t <= requestedTo);

  // [Rest remains the same - live price logic]
  let livePrice: { price: number; confidence: number } | null = null;
  try {
    const r = await ensureRedisSub();
    const arpKey = `arp:${baseAsset.hash.toLowerCase().replace(/^0x/, '')}:${anchor.toLowerCase()}`;
    const liveData = await r.hGet(arpKey, 'latest');
    if (liveData) {
      const parsed = JSON.parse(liveData);
      livePrice = {
        price: parsed.price || parsed.c || parsed.close,
        confidence: parsed.confidence || 1.0
      };
    }
  } catch { }

  const points = filteredHistory.map(h => ({
    t: h.t,
    p: h.price,
    c: h.confidence,
    h: h.hops
  }));

  if (livePrice && (!points.length || points[points.length - 1].t < now - MINUTE)) {
    points.push({
      t: Math.floor(now / MINUTE) * MINUTE,
      p: livePrice.price,
      c: livePrice.confidence,
      h: 0
    });
  }

  return reply.send({
    s: points.length ? 'ok' : 'no_data',
    t: points.map(p => p.t),
    p: points.map(p => p.p),
    confidence: points.map(p => p.c),
    hops: points.map(p => p.h),
    base_asset: {
      id: baseAsset.id,
      hash: baseAsset.hash,
      ticker: baseAsset.ticker
    },
    quote: anchor,
    source: 'arp',
    updatedAt: now,
    cached: !!history
  });
}

async function getTradeSparkline(
  reply: any,
  baseAsset: { id: number, hash: string, ticker: string },
  quoteAsset: { id: number, hash: string, ticker: string },
  minutes: number,
  routerId: number
) {
  // [Find pair logic remains the same]
  const [aHash, bHash] = baseAsset.hash < quoteAsset.hash
    ? [baseAsset.hash, quoteAsset.hash]
    : [quoteAsset.hash, baseAsset.hash];

  const pairId = await getPairIdByHashes(aHash, bHash);
  if (!pairId) {
    return reply.code(404).send({
      error: 'pair_not_found',
      base_asset: { hash: baseAsset.hash, ticker: baseAsset.ticker },
      quote_asset: { hash: quoteAsset.hash, ticker: quoteAsset.ticker },
      hint: 'No trading pair exists between these assets'
    });
  }

  const inverted = baseAsset.hash !== aHash;
  const now = Date.now();
  const requestedFrom = now - minutes * MINUTE;
  const requestedTo = now;

  // Server-side alignment for consistent caching (always 1m for sparklines)
  const { alignedFrom, alignedTo } = alignTimeRange(requestedFrom, requestedTo, '1');

  // Try cache first with aligned boundaries
  const cache = await getCandleCache();
  let bars = await cache.get(routerId, pairId, '1', alignedFrom, alignedTo);
  
  if (!bars) {
    // Cache miss - query database with aligned range
    bars = await queryCandles(routerId, pairId, '1', alignedFrom, alignedTo);
    
    // Cache the result
    if (bars.length > 0) {
      cache.set(routerId, pairId, '1', alignedFrom, alignedTo, bars)
        .catch(e => console.warn('[sparkline-cache] Failed to set:', e.message));
    }
  }

  // Filter to requested range
  const filteredBars = bars.filter(b => b.t >= requestedFrom && b.t <= requestedTo);

  if (!filteredBars.length) {
    return reply.send({
      s: 'no_data',
      t: [],
      p: [],
      base_asset: { hash: baseAsset.hash, ticker: baseAsset.ticker },
      quote_asset: { hash: quoteAsset.hash, ticker: quoteAsset.ticker },
      inverted,
      source: 'trades'
    });
  }

  if (inverted) {
    const invertedBars = invertBars(filteredBars);
    return reply.send({
      s: 'ok',
      t: invertedBars.map(b => b.t),
      p: invertedBars.map(b => b.c),
      base_asset: { hash: baseAsset.hash, ticker: baseAsset.ticker },
      quote_asset: { hash: quoteAsset.hash, ticker: quoteAsset.ticker },
      inverted,
      source: 'trades',
      updatedAt: now,
      cached: !!bars
    });
  }

  return reply.send({
    s: 'ok',
    t: filteredBars.map(b => b.t),
    p: filteredBars.map(b => b.c),
    base_asset: { hash: baseAsset.hash, ticker: baseAsset.ticker },
    quote_asset: { hash: quoteAsset.hash, ticker: quoteAsset.ticker },
    inverted,
    source: 'trades',
    updatedAt: now,
    cached: !!bars
  });
}

async function getRouterFallbackChain(
  sym: string, 
  routerParam?: string
): Promise<number[]> {
  const routerIds: number[] = [];
  
  // Priority 1: EITHER param router OR default router (not both)
  if (routerParam) {
    const id = await getRouterIdByContract(routerParam);
    if (id) routerIds.push(id);
  } else if (DEFAULT_AMM_ROUTER) {
    const id = await getRouterIdByContract(DEFAULT_AMM_ROUTER);
    if (id) routerIds.push(id);
  }
  
  // Priority 2: Oracle as fallback (always try this last)
  const oracleId = await getRouterIdByContract('ORACLE');
  if (oracleId && !routerIds.includes(oracleId)) {
    routerIds.push(oracleId);
  }
  
  return routerIds;
}

async function findBestDataSource(
  routerIds: number[],
  baseAsset: { id: number, hash: string, ticker: string },
  quoteAsset: { id: number, hash: string, ticker: string },
  fromMs: number,
  toMs: number,
  anchorOverride?: string | null
): Promise<{
  routerId: number;
  dataType: 'trading_pair' | 'arp' | null;
  pairId?: number;
  inverted?: boolean;
  anchor?: string;
} | null> {
  
  for (const routerId of routerIds) {
    // First, try direct trading pair (unless anchor override is specified)
    if (!anchorOverride) {
      const [aHash, bHash] = baseAsset.hash < quoteAsset.hash
        ? [baseAsset.hash, quoteAsset.hash]
        : [quoteAsset.hash, baseAsset.hash];
      
      const pairId = await getPairIdByHashes(aHash, bHash);
      
      if (pairId) {
        const hasData = await hasBars(routerId, pairId, fromMs, toMs);
        if (hasData) {
          return {
            routerId,
            dataType: 'trading_pair',
            pairId,
            inverted: baseAsset.hash !== aHash
          };
        }
      }
    }
    
    // Second, try ARP with specified anchor or quote as anchor
    const anchorToUse = anchorOverride || quoteAsset.ticker;
    
    // Special handling for USD - always check Oracle router for USD anchors
    if (anchorToUse === 'USD') {
      // Get Oracle router ID
      const oracleRouterId = await getRouterIdByContract('ORACLE');
      
      if (oracleRouterId) {
        // Check for USD anchor specifically on Oracle router
        const { rows: oracleAnchorCheck } = await pool.query(
          `SELECT id FROM anchors 
           WHERE router_id = $1 AND name = 'USD' AND active = true`,
          [oracleRouterId]
        );
        
        if (oracleAnchorCheck.length > 0) {
          // Check if ARP data exists for this asset with Oracle's USD
          const { rows: dataCheck } = await pool.query(
            `SELECT 1 FROM arp_points_1m 
             WHERE router_id = $1 AND anchor_id = $2 AND asset_id = $3
             LIMIT 1`,
            [oracleRouterId, oracleAnchorCheck[0].id, baseAsset.id]
          );
          
          if (dataCheck.length > 0) {
            return {
              routerId: oracleRouterId, // Use Oracle router for USD pricing
              dataType: 'arp',
              anchor: 'USD'
            };
          }
        }
      }
    }
    
    // Original ARP check for other anchors
    try {
      const { rows: anchorCheck } = await pool.query(
        `SELECT id FROM anchors 
         WHERE router_id = $1 AND name = $2 AND active = true`,
        [routerId, anchorToUse]
      );
      
      if (anchorCheck.length > 0) {
        return {
          routerId,
          dataType: 'arp',
          anchor: anchorToUse
        };
      }
    } catch (err) {
      console.error(`Error checking anchor for router ${routerId}:`, err);
    }
  }
  
  return null;
}

// -------------------------------
// Server Bootstrap
// -------------------------------

async function bootstrap() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: (_origin, cb) => cb(null, true),
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
  });

  await app.register(compress, {
    encodings: ['gzip', 'deflate'],
    threshold: 1024
  });

  // Newline at end of JSON payloads
  app.addHook('onSend', async (_req, reply, payload) => {
    const ct = String(reply.getHeader('content-type') ?? '');
    if (!/application\/json\b/i.test(ct)) return payload;
    if (typeof payload === 'string') return payload.endsWith('\n') ? payload : payload + '\n';
    if (Buffer.isBuffer(payload)) return payload[payload.length - 1] === 0x0a
      ? payload
      : Buffer.concat([payload, Buffer.from('\n')]);
    return payload;
  });

  await preloadCaches();

  /* --------------------------- TradingView UDF --------------------------- */

  app.get('/tv/config', async () => ({
    supports_search: false,
    supports_group_request: false,
    supported_resolutions: ['1', '5', '15', '60', '240', '1D', '1W', '1M'],
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
  }));

  app.get('/tv/symbols', async (req, reply) => {
    try {
      const q = req.query as any;
      const symbolStr = String(q.symbol || '');

      // Try to parse as hash-based first, then fallback to ticker
      const parts = symbolStr.split('_');
      if (parts.length === 2) {
        const [baseInput, quoteInput] = parts;

        const baseAsset = await parseAssetSymbol(baseInput);
        const quoteAsset = await parseAssetSymbol(quoteInput);

        if (typeof baseAsset === 'object' && typeof quoteAsset === 'object') {
          return {
            name: `${baseAsset.ticker}/${quoteAsset.ticker}`,
            ticker: `${baseAsset.ticker}_${quoteAsset.ticker}`,
            description: `${baseAsset.ticker} / ${quoteAsset.ticker}`,
            type: 'crypto',
            session: '24x7',
            exchange: quoteAsset.ticker === 'USD' ? 'arp' : (quoteAsset.ticker === 'XEL' ? 'oracle' : 'amm'),
            timezone: 'UTC',
            minmov: 1,
            pricescale: 1e6,
            has_intraday: true,
            supported_resolutions: ['1', '5', '15', '60', '240', '1D', '1W', '1M'],
            has_no_volume: quoteAsset.ticker === 'USD',
            data_status: 'streaming',
          };
        }
      }

      // Fallback to legacy parsing
      const { base, quote } = parsePairSymbol(symbolStr);
      return {
        name: `${base}/${quote}`,
        ticker: pairSymbol(base, quote),
        description: `${base} / ${quote}`,
        type: 'crypto',
        session: '24x7',
        exchange: quote === 'USD' ? 'arp' : 'amm',
        timezone: 'UTC',
        minmov: 1,
        pricescale: 1e6,
        has_intraday: true,
        supported_resolutions: ['1', '5', '15', '60', '240', '1D', '1W', '1M'],
        has_no_volume: false,
        data_status: 'streaming',
      };
    } catch {
      return reply.code(404).send({ s: 'error', errmsg: 'unknown symbol' });
    }
  });

  app.get('/tv/history', async (req, reply) => {
    const q = req.query as any;
    const reqSymbol = normalizeSymbol(q.symbol || '');
    const res = String(q.resolution || '1') as Res;
    const requestedFrom = Number(q.from) * 1000;
    const requestedTo = Number(q.to) * 1000;
    const includeLive = q.live === '1';
    const routerParam = q.router ? String(q.router) : undefined;
    const anchorOverride = q.anchor ? String(q.anchor).toUpperCase() : null;

    if (!reqSymbol) return reply.code(400).send({ s: 'error', errmsg: 'symbol_required' });

    // Apply server-side alignment for consistent caching
    const { alignedFrom, alignedTo } = alignTimeRange(requestedFrom, requestedTo, res);

    // Parse symbol for assets
    const parts = reqSymbol.split('_');
    if (parts.length === 2) {
      const [baseInput, quoteInput] = parts;
      
      const baseAsset = await parseAssetSymbol(baseInput);
      const quoteAsset = await parseAssetSymbol(quoteInput);
      
      if (typeof baseAsset === 'object' && typeof quoteAsset === 'object') {
        const routerIds = await getRouterFallbackChain(reqSymbol, routerParam);
        
        if (!routerIds.length) {
          return reply.code(500).send({ s: 'error', errmsg: 'no_routers_available' });
        }
        
        // Use aligned boundaries for finding data source
        const dataSource = await findBestDataSource(
          routerIds,
          baseAsset,
          quoteAsset,
          alignedFrom,
          alignedTo,
          anchorOverride
        );
        
        if (!dataSource) {
          return reply.send({
            s: 'no_data',
            t: [],
            o: [],
            h: [],
            l: [],
            c: [],
            v: [],
            meta: {
              error: 'no_data_found',
              tried_routers: routerIds,
              base_asset: baseAsset,
              quote_asset: quoteAsset,
              hint: routerParam 
                ? `No data found for router ${routerParam} or oracle fallback`
                : 'No data found in default router or oracle fallback'
            }
          });
        }
        
        // Handle trading pair data
        if (dataSource.dataType === 'trading_pair' && dataSource.pairId) {
          const cache = await getCandleCache();
          let bars = await cache.get(
            dataSource.routerId,
            dataSource.pairId,
            res,
            alignedFrom,
            alignedTo
          );
          
          if (!bars) {
            bars = await queryCandles(
              dataSource.routerId,
              dataSource.pairId,
              res,
              alignedFrom,
              alignedTo
            );
            
            cache.set(dataSource.routerId, dataSource.pairId, res, alignedFrom, alignedTo, bars)
              .catch(e => console.warn('[cache] Failed to set:', e.message));
          }

          // Filter to requested range (client gets what they asked for, plus alignment padding)
          const filteredBars = bars.filter(b => b.t >= requestedFrom && b.t <= requestedTo);
          
          if (dataSource.inverted) {
            const invertedBars = invertBars(filteredBars);
            
            // Include live data if requested
            if (includeLive) {
              try {
                const r = await ensureRedisSub();
                
                const routerStr = await getRouterContract(dataSource.routerId);
                if (!routerStr) {
                  console.warn('[live] Router not found for ID', dataSource.routerId);
                  return;
                }

                const pairHashes = await getPairHashes(dataSource.pairId);
                if (!pairHashes) {
                  console.warn('[live] Pair hashes not found for ID', dataSource.pairId);
                  return;
                }
                                
                const [h1, h2] = pairHashes.aHash < pairHashes.bHash 
                  ? [pairHashes.aHash, pairHashes.bHash]
                  : [pairHashes.bHash, pairHashes.aHash];
                
                const liveKey = `live:bar:${routerStr}:${h1}_${h2}:${res}`;
                const liveData = await r.get(liveKey);
                
                if (liveData) {
                  const liveBar = JSON.parse(liveData) as Bar;
                  const invertedLiveBar = invertBar(liveBar);
                  
                  const lastBar = invertedBars[invertedBars.length - 1];
                  if (lastBar && lastBar.t === invertedLiveBar.t) {
                    invertedBars[invertedBars.length - 1] = invertedLiveBar;
                  } else if (!lastBar || invertedLiveBar.t > lastBar.t) {
                    invertedBars.push(invertedLiveBar);
                  }
                }
              } catch (e) {
                console.warn('[live] Failed to fetch live data:', e);
              }
            }
                        
            return reply.send({
              s: invertedBars.length ? 'ok' : 'no_data',
              t: invertedBars.map(b => Math.floor(b.t / 1000)),
              o: invertedBars.map(b => b.o),
              h: invertedBars.map(b => b.h),
              l: invertedBars.map(b => b.l),
              c: invertedBars.map(b => b.c),
              v: invertedBars.map(b => b.v ?? 0),
              meta: {
                type: 'trading_pair',
                router_id: dataSource.routerId,
                pair_id: dataSource.pairId,
                inverted: dataSource.inverted,
                cached: !!bars,
                aligned_range: { from: alignedFrom, to: alignedTo }
              }
            });
          }
          
          if (includeLive) {
            try {
              const r = await ensureRedisSub();
              
              const routerStr = await getRouterContract(dataSource.routerId);
              if (!routerStr) {
                console.warn('[live] Router not found for ID', dataSource.routerId);
                return;
              }
              
              const pairHashes = await getPairHashes(dataSource.pairId);
              if (!pairHashes) {
                console.warn('[live] Pair hashes not found for ID', dataSource.pairId);
                return;
              }
              
              const [h1, h2] = pairHashes.aHash < pairHashes.bHash 
                ? [pairHashes.aHash, pairHashes.bHash]
                : [pairHashes.bHash, pairHashes.aHash];
              
              const liveKey = `live:bar:${routerStr}:${h1}_${h2}:${res}`;
              
              const liveData = await r.get(liveKey);
              if (liveData) {
                const liveBar = JSON.parse(liveData) as Bar;
                const lastBar = filteredBars[filteredBars.length - 1];
                if (lastBar && lastBar.t === liveBar.t) {
                  filteredBars[filteredBars.length - 1] = liveBar;
                } else if (!lastBar || liveBar.t > lastBar.t) {
                  filteredBars.push(liveBar);
                }
              }
            } catch (e) {
              console.warn('[live] Failed to fetch live data:', e);
            }
          }
          
          return reply.send({
            s: filteredBars.length ? 'ok' : 'no_data',
            t: filteredBars.map(b => Math.floor(b.t / 1000)),
            o: filteredBars.map(b => b.o),
            h: filteredBars.map(b => b.h),
            l: filteredBars.map(b => b.l),
            c: filteredBars.map(b => b.c),
            v: filteredBars.map(b => b.v ?? 0),
            meta: {
              type: 'trading_pair',
              router_id: dataSource.routerId,
              pair_id: dataSource.pairId,
              inverted: dataSource.inverted,
              cached: !!bars,
              aligned_range: { from: alignedFrom, to: alignedTo }
            }
          });
        }
        
        // Handle ARP data
        if (dataSource.dataType === 'arp' && dataSource.anchor) {
          const cache = await getArpCache();
          let history = await cache.get(
            dataSource.routerId,
            baseAsset.id,
            dataSource.anchor,
            alignedFrom,
            alignedTo
          );
          
          if (!history) {
            history = await queryArpHistory(
              dataSource.routerId,
              baseAsset.id,
              dataSource.anchor,
              alignedFrom,
              alignedTo
            );
            
            if (history.length > 0) {
              cache.set(dataSource.routerId,baseAsset.id, dataSource.anchor, alignedFrom, alignedTo, history)
                .catch(e => console.warn('[arp-cache] Failed to set:', e.message));
            }
          }

          // Filter to requested range
          const filteredHistory = history.filter(h => h.t >= requestedFrom && h.t <= requestedTo);
          
          return reply.send({
            s: filteredHistory.length ? 'ok' : 'no_data',
            t: filteredHistory.map(h => Math.floor(h.t / 1000)),
            prices: filteredHistory.map(h => h.price),
            confidence: filteredHistory.map(h => h.confidence),
            hops: filteredHistory.map(h => h.hops),
            meta: {
              type: 'arp',
              router_id: dataSource.routerId,
              anchor: dataSource.anchor,
              has_confidence: true,
              chart_type: 'line',
              cached: !!history,
              aligned_range: { from: alignedFrom, to: alignedTo }
            },
            base_asset: baseAsset,
            quote_asset: quoteAsset
          });
        }
      }
    }
  });

  app.get('/v1/sparkline', async (req, reply) => {
    const q = req.query as any;

    // Parse symbol
    let baseInput: string;
    let quoteInput: string = 'XEL';

    if (q.symbol) {
      const parts = normalizeSymbol(String(q.symbol)).split('_');
      if (parts.length !== 2) {
        return reply.code(400).send({
          error: 'invalid_symbol_format',
          hint: 'Use BASE_QUOTE format or separate base= and quote= params'
        });
      }
      [baseInput, quoteInput] = parts;
    } else {
      baseInput = String(q.base || q.token || '');
      quoteInput = String(q.quote || 'XEL');
      if (!baseInput) {
        return reply.code(400).send({
          error: 'missing_base',
          hint: 'Use symbol=BASE_QUOTE or base=&quote= params'
        });
      }
    }

    // Parse assets
    const baseAsset = await parseAssetSymbol(baseInput);
    if (baseAsset === 'not_found') {
      return reply.code(404).send({
        error: 'base_asset_not_found',
        input: baseInput
      });
    }
    if (baseAsset === 'multiple_tickers') {
      return reply.code(400).send({
        error: 'ambiguous_ticker',
        ticker: baseInput,
        hint: 'Use the full asset hash instead.'
      });
    }

    const quoteAsset = await parseAssetSymbol(quoteInput);
    if (quoteAsset === 'not_found') {
      return reply.code(404).send({
        error: 'quote_asset_not_found',
        input: quoteInput
      });
    }
    if (quoteAsset === 'multiple_tickers') {
      return reply.code(400).send({
        error: 'ambiguous_quote_ticker',
        ticker: quoteInput,
        hint: 'Use the full asset hash instead.'
      });
    }

    // Calculate time window
    const win = String(q.window || '24h').toLowerCase();
    const WINDOW_MIN = { '1h': 60, '24h': 1440, '7d': 10080, '1m': 43200 };
    const minutes = WINDOW_MIN[win as keyof typeof WINDOW_MIN] ?? 1440;
    const now = Date.now();
    const from = now - minutes * 60_000;

    // Get router fallback chain: [param OR default] → oracle
    const routerParam = q.router ? String(q.router) : undefined;
    const anchorOverride = q.anchor ? String(q.anchor).toUpperCase() : null;
    const symbol = `${baseAsset.ticker}_${quoteAsset.ticker}`;
    const routerIds = await getRouterFallbackChain(symbol, routerParam);

    if (!routerIds.length) {
      return reply.code(500).send({ error: 'no_routers_available' });
    }

    // Find best data source
    const dataSource = await findBestDataSource(
      routerIds,
      baseAsset,
      quoteAsset,
      from,
      now,
      anchorOverride
    );

    if (!dataSource) {
      return reply.send({
        s: 'no_data',
        t: [],
        p: [],
        base_asset: baseAsset,
        quote_asset: quoteAsset,
        error: 'no_data_found',
        tried_routers: routerIds,
        hint: routerParam 
          ? `No data for router ${routerParam} or oracle`
          : 'No data in default router or oracle'
      });
    }

    // Return appropriate data based on source type
    if (dataSource.dataType === 'arp' && dataSource.anchor) {
      return getArpSparkline(reply, baseAsset, minutes, dataSource.routerId, dataSource.anchor);
    } else if (dataSource.dataType === 'trading_pair') {
      return getTradeSparkline(reply, baseAsset, quoteAsset, minutes, dataSource.routerId);
    }

    return reply.send({
      s: 'no_data',
      t: [],
      p: [],
      error: 'unexpected_data_type'
    });
  });

  app.get('/tv/time', async () => Math.floor(Date.now() / 1000));

  /* ---------------------------- Health + WS ---------------------------- */

  app.get('/health', async () => ({ ok: true, ts: Date.now() }));

  await wireLiveWs(app);

  /* ------------------------------- Listen ------------------------------- */

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`forge-api listening on :${PORT}`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});