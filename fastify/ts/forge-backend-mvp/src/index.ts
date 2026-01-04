// src/index.ts
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { promises as fs } from 'node:fs';
import Decimal from 'decimal.js';

import { XelisNodeAdapter } from './adapters/xelisNodeAdapter';
import { VMParam } from './utils/xvmSerializer';
import { pairSymbol, parsePairSymbol } from './utils/symbols';

import { PriceHub } from './services/priceHub';
import { wireHubToCandles } from './services/hubToCandles';
import { DiskCandleStore } from './candles/diskStore';
import type { Resolution } from './candles/types';
import { XelUsdSampler } from './services/xelUsdSampler';
import { startDailyCompaction } from './services/scheduleCompaction';

import websocket from '@fastify/websocket';
import { RealtimeHub } from './realtime/hub';
import { Bar } from './types';
import { Singleflight, TinyLRU } from './cache';

import { decodeVmMapLpReserves } from "./events/swap";
import { AssetMetaCache } from "./services/assetMetaCache";
import { ReservesStore } from './reserves/persist';
import { appendFile } from "node:fs/promises";

// ---------- env ----------
const NODE_WS_URL  = pickEndpointFromList();
const CANDLE_DIR   = process.env.CANDLE_DIR   || './data/candles';
const PORT         = Number(process.env.PORT || 3000);
const QUOTES_PATH = process.env.QUOTES_PATH || './data/quotes.json';

// optional: fallback router if your adapter didn’t provide one
const ROUTER_CONTRACT = process.env.ROUTER_CONTRACT || '';

// ---------- tiny helpers ----------
const MINUTE = 60_000;
const nextMinuteBoundary = (t: number) => Math.floor(t / MINUTE) * MINUTE + MINUTE;

function pickEndpointFromList() {
  const list = (process.env.NODE_WS_URLS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (list.length === 0) {
    return process.env.NODE_WS_URL || 'ws://127.0.0.1:8080/json_rpc';
  }

  const slot = parseInt(process.env.TASK_SLOT || '1', 10);

  const idx = (slot - 1) % list.length;
  return list[idx];
}

const adjustByDecimals = (raw: bigint, decimals: number) => {
  return Number(new Decimal(raw.toString()).div(new Decimal(10).pow(decimals)));
};

const cache = new TinyLRU(512);
const sf = new Singleflight();

function keyHistory(symbol: string, res: string, from: number, to: number, live: boolean) {
  return `tv:${symbol}:${res}:${from}:${to}:l${live?1:0}`;
}
function keySpark(symbol: string, win: string) {
  return `sp:${symbol}:${win}`;
}

// at top-level, maybe configure a path
const EVENT_LOG = "./data/events.log";

// Read pool lp map like FE: { [tokenHash]: amount, ... }
function readPoolMap(cell: any): Record<string, string | number | bigint> | null {
  const obj = cell?.data?.type === 'object' && cell?.data?.value?.[1];
  if (obj?.type !== 'map' || !obj?.value || typeof obj.value !== 'object') return null;
  return obj.value as Record<string, string | number | bigint>;
}

// ---------- bootstrapping ----------
async function seedPairsFromRouter(chain: XelisNodeAdapter, store: DiskCandleStore, rStore: ReservesStore, symbolSet: Set<string>) {
  const router = (await chain.getRouterContract()) || ROUTER_CONTRACT;
  if (!router) return;

  const lpIds = await chain.getContractAssets(router);
  const now = Date.now();

  for (const lpId of lpIds) {
    try {
      const cd = await chain.getContractData({ contract: router, key: VMParam.hash(lpId) });
      const lpMap = readPoolMap(cd);
      if (!lpMap) continue;

      const [aHash, bHash] = Object.keys(lpMap) as [string, string];
      const aMeta = await chain.getAsset({ asset: aHash });
      const bMeta = await chain.getAsset({ asset: bHash });

      const aAmt = BigInt(lpMap[aHash] as any);
      const bAmt = BigInt(lpMap[bHash] as any);
      const reserveA = adjustByDecimals(aAmt, aMeta.decimals);
      const reserveB = adjustByDecimals(bAmt, bMeta.decimals);
      if (!reserveA || !reserveB) continue;

      const priceAinB = reserveB / reserveA;
      const symA_B = pairSymbol(aMeta.ticker, bMeta.ticker);

      await store.ingestTick({ symbol: symA_B }, priceAinB, now, 0);
      symbolSet.add(symA_B);

      // NEW: seed baseline snapshot if missing
      const key = canonicalKey(aHash, bHash);
      const last = await rStore.getLast(key);
      if (!last) {
        await rStore.append(key, {
          A: new Decimal(reserveA),
          B: new Decimal(reserveB),
          t: now
        });
      }
    } catch { /* ignore malformed entries */ }
  }
}

// carry-forward scheduler for discovered pair symbols (keeps buckets UNIX-aligned)
function startPairCarryForwardScheduler(store: DiskCandleStore, symbols: Set<string>, wsHub: RealtimeHub) {
  const schedule = () => {
    const now = Date.now();
    const at = nextMinuteBoundary(now);
    setTimeout(async () => {
      const list = Array.from(symbols);
      try {
        // advance bars to the boundary…
        await Promise.allSettled(list.map(s => store.carryForwardTo({ symbol: s }, at)));
        // …then nudge subscribers so they draw the flat bar
        await Promise.allSettled(list.map(s => wsHub.publish(s, at)));
      } finally {
        schedule();
      }
    }, Math.max(0, at - now + 2));
  };
  schedule();
}

function byTime<T extends { t:number }>(a:T,b:T){ return a.t-b.t; }

/** Align two bar arrays by timestamp and multiply OHLC elementwise (approximation). */
function multiplyBars(a: Bar[], b: Bar[]): Bar[] {
  if (!a.length || !b.length) return [];
  // Build time->bar maps (both series are minute-aligned already from DiskCandleStore)
  const mb = new Map<number, Bar>(); for (const x of b) mb.set(x.t, x);
  const out: Bar[] = [];
  for (const x of a) {
    const y = mb.get(x.t);
    if (!y) continue;
    // Approximate OHLC product; good enough for charting (exact high/low intra-bar unknown)
    out.push({
      t: x.t,
      o: x.o * y.o,
      h: x.h * y.h,
      l: x.l * y.l,
      c: x.c * y.c,
      v: x.v, // optional: could convert to USD as x.v * y.c if x.v is BASE volume
    });
  }
  return out.sort(byTime);
}

// helper: invert OHLC (for reversing a pair)
function invertBar(b: Bar): Bar {
  const invO = 1 / b.o;
  const invC = 1 / b.c;
  // high/low swap when inverted
  const invH = 1 / b.l;
  const invL = 1 / b.h;
  return { t: b.t, o: invO, h: invH, l: invL, c: invC, v: b.v };
}

async function deriveUsdBars(
  store: DiskCandleStore,
  baseTicker: string,
  res: Resolution,
  fromMs: number,
  toMs: number
): Promise<Bar[]> {
  const BASE = baseTicker.toUpperCase();

  // If BASE is the native itself, just return the direct XEL/USD series
  if (BASE === 'XEL') {
    const xelUsd = await store.get({ symbol: 'XEL_USD' }, res, fromMs, toMs) as Bar[];
    return (xelUsd ?? []).slice().sort(byTime);
  }

  // --- Find BASE/native using either XET or XEL, direct or reversed ---
  const natives = ['XET', 'XEL'] as const;
  let baseNative: Bar[] = [];

  for (const nat of natives) {
    // Try BASE_NAT
    const direct = await store.get({ symbol: pairSymbol(BASE, nat) }, res, fromMs, toMs) as Bar[];
    if (direct?.length) { baseNative = direct; break; }

    // Try NAT_BASE and invert
    const reversed = await store.get({ symbol: pairSymbol(nat, BASE) }, res, fromMs, toMs) as Bar[];
    if (reversed?.length) { baseNative = reversed.map(invertBar); break; }
  }

  if (!baseNative.length) return [];

  // --- USD leg: always XEL_USD (unified) ---
  const nativeUsd = await store.get({ symbol: 'XEL_USD' }, res, fromMs, toMs) as Bar[];
  if (!nativeUsd?.length) return [];

  // Multiply barwise on matching timestamps
  return multiplyBars(baseNative, nativeUsd);
}

function toHuman(u64: bigint, decimals: number) {
  return new Decimal(u64.toString()).div(new Decimal(10).pow(decimals));
}

function canonicalKey(hash0: string, hash1: string) {
  return hash0 <= hash1 ? `${hash0}_${hash1}` : `${hash1}_${hash0}`;
}

const EPS = new Decimal("1e-18");

function prevForEventOrder(
  prevCanon: { A: Decimal; B: Decimal },
  aHash: string,
  bHash: string
) {
  // map canonical A/B (hash-sorted) to the event's (a,b) order
  return (aHash <= bHash)
    ? { prevA: prevCanon.A, prevB: prevCanon.B }
    : { prevA: prevCanon.B, prevB: prevCanon.A };
}

async function refreshReservesFromRouter(
  chain: XelisNodeAdapter,
  store: DiskCandleStore,
  reservesStore: ReservesStore,
  symbolSet: Set<string>
) {
  const router = (await chain.getRouterContract()) || ROUTER_CONTRACT;
  if (!router) return;

  const lpIds = await chain.getContractAssets(router);
  const now = Date.now();

  for (const lpId of lpIds) {
    try {
      const cd = await chain.getContractData({ contract: router, key: VMParam.hash(lpId) });
      const lpMap = readPoolMap(cd);
      if (!lpMap) continue;

      const [aHash, bHash] = Object.keys(lpMap) as [string, string];
      const aMeta = await chain.getAsset({ asset: aHash });
      const bMeta = await chain.getAsset({ asset: bHash });

      const aAmt = BigInt(lpMap[aHash] as any);
      const bAmt = BigInt(lpMap[bHash] as any);

      const A = toHuman(aAmt, aMeta.decimals); // Decimal
      const B = toHuman(bAmt, bMeta.decimals); // Decimal
      if (A.isZero() || B.isZero()) continue;

      // Seed candle (price of A in B)
      const priceAinB = B.div(A).toNumber();
      const symA_B = pairSymbol(aMeta.ticker, bMeta.ticker);
      await store.ingestTick({ symbol: symA_B }, priceAinB, now, 0);
      symbolSet.add(symA_B);

      // Write *latest* reserves baseline (canonical order by hash)
      const key = canonicalKey(aHash, bHash);
      const curCanon = (aHash <= bHash) ? { A, B } : { A: B, B: A };
      await reservesStore.put(key, curCanon.A, curCanon.B, now);
    } catch { /* ignore malformed entries */ }
  }
}

// ---------- main ----------
async function bootstrap() {
  const app = Fastify({ logger: true });
  
  await app.register(cors, {
    origin: (_origin, cb) => cb(null, true),
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
  });

  // Always end JSON responses with a newline (nice for curl)
  app.addHook('onSend', async (_, reply, payload) => {
    const ct = String(reply.getHeader('content-type') ?? '');
    if (!/application\/json\b/i.test(ct)) return payload;
    if (typeof payload === 'string') return payload.endsWith('\n') ? payload : payload + '\n';
    if (Buffer.isBuffer(payload)) return payload[payload.length - 1] === 0x0a ? payload : Buffer.concat([payload, Buffer.from('\n')]);
    return payload;
  });

  // ensure base dir
  await fs.mkdir(CANDLE_DIR, { recursive: true });

  // connect node
  const chain = await XelisNodeAdapter.connect(NODE_WS_URL);
  const metaCache = new AssetMetaCache(chain);

  // disk-first candle store
  const store = new DiskCandleStore(CANDLE_DIR);
  
  const reservesStore = new ReservesStore(CANDLE_DIR);
  await reservesStore.init();

  await app.register(websocket);

  const hub = new PriceHub(QUOTES_PATH);
  await hub.load();
  hub.registerRoutes(app);              // /v1/quote, /v1/quotes, /v1/quotes/stream

  chain.onContractEvent(ROUTER_CONTRACT, 1, async (evt) => {
    try {
      const reserves = decodeVmMapLpReserves(evt.data as any);
      if (reserves.length !== 2) return;

      // --- fetch metadata & scale to human ---
      const [r0, r1] = reserves;
      const [m0, m1] = await Promise.all([
        metaCache.get(r0.assetHash),
        metaCache.get(r1.assetHash),
      ]);

      const a = { // event token a (as emitted)
        hash: r0.assetHash,
        meta: m0,
        amt: toHuman(r0.amountU64, m0.decimals), // Decimal
      };
      const b = { // event token b (as emitted)
        hash: r1.assetHash,
        meta: m1,
        amt: toHuman(r1.amountU64, m1.decimals),
      };

      // --- canonical snapshot (hash-sorted) ---
      const key = canonicalKey(a.hash, b.hash);
      const curCanon = (a.hash <= b.hash) ? { A: a.amt, B: b.amt } : { A: b.amt, B: a.amt };

      // prev snapshot from disk (or warm cache)
      const prevCanon = await reservesStore.getLast(key);

      const symA_B = pairSymbol(a.meta.ticker, b.meta.ticker); // price of A in B
      const symB_A = pairSymbol(b.meta.ticker, a.meta.ticker); // price of B in A

      // Post-swap SPOT prices (for ticker/hub)
      const priceAinB = b.amt.div(a.amt).toNumber();
      const priceBinA = a.amt.div(b.amt).toNumber();

      const now = Date.now();

      // Map canonical A/B to event order (a,b) to get prevA/prevB aligned with r0/r1
      const { prevA, prevB } = prevCanon
        ? prevForEventOrder(prevCanon, a.hash, b.hash)
        : { prevA: undefined, prevB: undefined };

      // Reserve deltas
      let dA = prevA ? a.amt.minus(prevA) : new Decimal(0);
      let dB = prevB ? b.amt.minus(prevB) : new Decimal(0);
      if (dA.abs().lt(EPS)) dA = new Decimal(0);
      if (dB.abs().lt(EPS)) dB = new Decimal(0);

      // classify
      const isSwapAB = dA.gt(0) && dB.lt(0); // input A, output B
      const isSwapBA = dA.lt(0) && dB.gt(0); // input B, output A
      const isLP     = !isSwapAB && !isSwapBA;

      // per-direction base volumes (NO fee math)
      let volAB = 0;
      let volBA = 0;
      if (prevCanon) {
        if (isSwapAB) { volAB = dA.toNumber();       volBA = dB.abs().toNumber(); }
        else if (isSwapBA) { volAB = dA.abs().toNumber(); volBA = dB.toNumber(); }
      }

      // ---- execution price (VWAP) used for candles ----
      // For A_B symbol:
      //   A->B swap: price = (B_out)/(A_in) = |dB|/dA
      //   B->A swap: price = (B_in)/(A_out) = dB/|dA|
      let tradePriceAB: number | null = null;
      if (prevCanon) {
        if (isSwapAB && dA.gt(0)) {
          tradePriceAB = dB.abs().div(dA).toNumber();
        } else if (isSwapBA && dA.lt(0)) {
          tradePriceAB = dB.div(dA.abs()).toNumber();
        }
      }
      const tradePriceBA = (tradePriceAB != null) ? 1 / tradePriceAB : null;

      // ---- log (for AFK monitoring) ----
      const logObj = {
        pair: `${a.meta.ticker}_${b.meta.ticker}`,
        kind: isLP ? "LP" : (isSwapAB ? "A->B" : "B->A"),
        priceAinB,         // post-swap spot
        priceBinA,         // post-swap spot
        execAinB: tradePriceAB, // execution price used for candles (may be null on first-ever)
        execBinA: tradePriceBA,
        volAB, volBA,
        at: now,
      };
      console.log(logObj);
      await appendFile(EVENT_LOG, JSON.stringify(logObj) + "\n");

      // ---- stream spot to hub (ticker UX expects current spot) ----
      hub.set(symA_B, priceAinB, "swap");
      hub.set(symB_A, priceBinA, "swap");

      // ---- candles: use execution price (build proper wicks/bodies) ----
      if (tradePriceAB != null && !isLP) {
        await store.ingestTick({ symbol: symA_B }, tradePriceAB, now, volAB);
        await store.ingestTick({ symbol: symB_A }, tradePriceBA!, now, volBA);
        await wsHub.publish(symA_B, now);
        await wsHub.publish(symB_A, now);
      } else {
        // LP ops or first-ever with no prevCanon: still nudge spot subscribers
        await wsHub.publish(symA_B, now);
        await wsHub.publish(symB_A, now);
      }

      // ---- persist latest reserves AFTER processing ----
      await reservesStore.put(key, curCanon.A, curCanon.B, now);

      // optional: nudge derived USD charts if a native leg involved
      const natives = new Set(["XEL", "XET"]);
      if (natives.has(a.meta.ticker)) await wsHub.publish(pairSymbol(b.meta.ticker, "USD"), now);
      if (natives.has(b.meta.ticker)) await wsHub.publish(pairSymbol(a.meta.ticker, "USD"), now);
    } catch (e) {
      console.error(e, "swap-event processing failed");
    }
  });

  const wsHub = new RealtimeHub(store);

  const unbridge = wireHubToCandles(hub, store); // no filter = all symbols

  const xelUsdSampler = new XelUsdSampler(hub, 'XEL_USD');
  xelUsdSampler.onTick(async (now: number) => {
    await wsHub.publish('XEL_USD', now);
  });
  await xelUsdSampler.start();

  const pairSymbols = new Set<string>();

  hub.on('quote', async ({ symbol }) => {
    if (pairSymbols.has(symbol)) return;
    pairSymbols.add(symbol);
    const at = Math.floor(Date.now() / 60000) * 60000 + 60000;
    try { await store.carryForwardTo({ symbol }, at); } catch {}
  });

  // bootstrap pool-derived pairs (one tick per pool right now)
  await seedPairsFromRouter(chain, store, reservesStore, pairSymbols);
  await refreshReservesFromRouter(chain, store, reservesStore, pairSymbols);

  startPairCarryForwardScheduler(store, pairSymbols, wsHub); // keep pair series aligned per minute
  for (const sym of pairSymbols) {
    const latest = await store.lastClose({ symbol: sym });
    if (latest != null) hub.set(sym, latest, 'bootstrap');
  }

  // startDailyCompaction(process.env.CANDLE_DIR || './data/candles', Array.from(pairSymbols), 3, 5);

  app.get('/ws', { websocket: true }, (conn, req) => {
    const url = new URL(req.url, 'http://x'); // base is ignored
    const symbol = (url.searchParams.get('symbol') || 'XEL_USD').toUpperCase();
    const res = (url.searchParams.get('res') || '1') as any;
    wsHub.add(conn, symbol, res);
  });

  // ---------- TradingView UDF ----------
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
      const { base, quote } = parsePairSymbol((req.query as any).symbol || '');
      return {
        name: `${base}/${quote}`,
        ticker: pairSymbol(base, quote),
        description: `${base} / ${quote}`,
        type: 'crypto',
        session: '24x7',
        exchange: quote === 'USD' ? 'external' : 'amm',
        timezone: 'UTC',
        minmov: 1,
        pricescale: 1e6,
        has_intraday: true,
        supported_resolutions: ['1', '5', '15', '60', '240', '1D', '1W', '1M'],
        has_no_volume: quote === 'USD',
        data_status: 'streaming',
      };
    } catch {
      return reply.code(404).send({ s: 'error', errmsg: 'unknown symbol' });
    }
  });

  app.get('/tv/history', async (req, reply) => {
    const q = req.query as any;
    try {
      const { base, quote } = parsePairSymbol(q.symbol || '');
      const res = String(q.resolution || '1') as Resolution;
      const from = Number(q.from) * 1000;
      const to   = Number(q.to)   * 1000;

      const includeLive = q.live === '1';

      const RES_TO_MIN: Record<Resolution, number> = {
        '1':1,'5':5,'15':15,'60':60,'240':240,'1D':1440,'1W':10080,'1M':43200
      };
      const sizeMin = RES_TO_MIN[res] || 1;
      const bucketMs = sizeMin * MINUTE;

      const liveStart = Math.floor(Date.now() / bucketMs) * bucketMs;
      const toEff = includeLive ? to : Math.min(to, liveStart - 1);

      const sym = `${base}_${quote}`;
      const ck = keyHistory(sym, res, from, toEff, includeLive);
      if (!includeLive) {
        const cached = cache.get(ck) as { at:number, val:any } | undefined;
        if (cached && Date.now() - cached.at < 3000) {
          reply.header('Cache-Control', 'public, max-age=2');
          return cached.val;
        }
      }

      const payload = await sf.do(ck, async () => {
        let bars: Bar[] = [];

        if (quote === 'USD' || base === 'USD') {
          // --- USD legs (both BASE_USD and USD_BASE) ---
          const isUsdBase = base === 'USD' && quote !== 'USD';
          const target = isUsdBase ? quote : base; // the non-USD ticker

          // Try explicit series first for the special XEL exception, then fall back to derived
          if (isUsdBase) {
            // Prefer explicit USD_XEL if requested (your "exception"); otherwise invert derived
            if (target === 'XEL') {
              const direct = await store.get({ symbol: 'USD_XEL' }, res, from, toEff) as Bar[];
              if (direct?.length) {
                bars = direct;
              } else {
                const derived = await deriveUsdBars(store, 'XEL', res, from, toEff);
                bars = derived.map(invertBar);
              }
            } else {
              const derived = await deriveUsdBars(store, target!, res, from, toEff);
              bars = derived.map(invertBar);
            }
          } else {
            // BASE_USD (normal)
            bars = await deriveUsdBars(store, target!, res, from, toEff);
          }
        } else {
          // --- non-USD pairs (existing behavior) ---
          const wanted = pairSymbol(base, quote);
          bars = await store.get({ symbol: wanted }, res, from, toEff) as Bar[];
          if (!bars.length) {
            const reverse = await store.get({ symbol: pairSymbol(quote, base) }, res, from, toEff) as Bar[];
            if (reverse.length) bars = reverse.map(invertBar);
          }
        }

        if (!bars.length && includeLive) {
          const now = Date.now();
          const start = Math.floor(now / bucketMs) * bucketMs;

          if (quote === 'USD' || base === 'USD') {
            const isUsdBase = base === 'USD' && quote !== 'USD';
            const target = isUsdBase ? quote : base;

            if (isUsdBase) {
              if (target === 'XEL') {
                const direct = await store.get({ symbol: 'USD_XEL' }, res, start, now) as Bar[];
                if (direct?.length) bars = direct;
                else {
                  const derived = await deriveUsdBars(store, 'XEL', res, start, now);
                  bars = derived.map(invertBar);
                }
              } else {
                const derived = await deriveUsdBars(store, target!, res, start, now);
                bars = derived.map(invertBar);
              }
            } else {
              bars = await deriveUsdBars(store, target!, res, start, now);
            }
          } else {
            const wanted = pairSymbol(base, quote);
            bars = await store.get({ symbol: wanted }, res, start, now) as Bar[];
            if (!bars.length) {
              const reverse = await store.get({ symbol: pairSymbol(quote, base) }, res, start, now) as Bar[];
              if (reverse.length) bars = reverse.map(invertBar);
            }
          }
        }

        if (!bars.length) return { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };

        // de-dup on timestamp (keep last)
        const seen = new Map<number, Bar>();
        for (const b of bars) seen.set(b.t, b);
        const uniq = Array.from(seen.values()).sort(byTime);

        const out = {
          s: 'ok' as const,
          t: uniq.map(b => Math.floor(b.t / 1000)),
          o: uniq.map(b => b.o),
          h: uniq.map(b => b.h),
          l: uniq.map(b => b.l),
          c: uniq.map(b => b.c),
          v: uniq.map(b => b.v ?? 0),
        };
        if (!includeLive) {
          cache.set(ck, { at: Date.now(), val: out });
          reply.header('Cache-Control', 'public, max-age=2');
        } else {
          reply.header('Cache-Control', 'no-store');
        }
        return out;
      });

      reply.header('Cache-Control', 'public, max-age=2');
      return payload;
    } catch {
      return reply.code(400).send({ s: 'error', errmsg: 'bad_request' });
    }
  });

  app.get('/tv/time', async () => Math.floor(Date.now()/1000));

  // ---------- Simple REST for your UI ----------
  app.get('/v1/sparkline', async (req, reply) => {
    const q = req.query as any;

    let base: string | undefined;
    let quote: string | undefined;

    if (q.symbol) {
      try {
        const s = parsePairSymbol(String(q.symbol));
        base = s.base;
        quote = s.quote;
      } catch {
        return reply
          .code(400)
          .send({ error: 'bad_symbol', hint: 'Use BASE_QUOTE, e.g., TNN_XEL' });
      }
    } else {
      base  = String(q.base  ?? q.token ?? '').toUpperCase();
      quote = String(q.quote ?? 'XEL').toUpperCase();
      if (!base) {
        return reply
          .code(400)
          .send({ error: 'missing_base', hint: 'Pass symbol=BASE_QUOTE or base=&quote=' });
      }
    }

    // 🔹 normalize XET → XEL if paired with USD
    const normalizeXel = (s: string, other: string) =>
      (s === 'XET' && other === 'USD') ? 'XEL' : s;
    base  = normalizeXel(base, quote);
    quote = normalizeXel(quote, base);

    const win = String(q.window || '24h').toLowerCase();
    const WINDOW_MIN: Record<string, number> = {
      '1h': 60, '24h': 1440, '1d': 1440, '7d': 10080,
      '1w': 10080, '1m': 43200, '1mo': 43200, '30d': 43200,
    };
    const minutes = WINDOW_MIN[win] ?? WINDOW_MIN['24h'];

    const now = Date.now();
    const from = now - minutes * MINUTE;

    // ---- tiny cache (3s TTL) ----
    const symKey = `${base}_${quote}`;
    const ck = keySpark(symKey, win);
    const cached = cache.get(ck) as { at:number, val:any } | undefined;
    if (cached && Date.now() - cached.at < 3000) {
      reply.header('Cache-Control', 'public, max-age=2');
      return cached.val;
    }

    const result = await sf.do(ck, async () => {
      if (quote === 'USD' || base === 'USD') {
        const isUsdBase = base === 'USD' && quote !== 'USD';
        const target = isUsdBase ? quote : base; // the non-USD ticker

        if (!target) {
          return { s: 'no_data', t: [], p: [], used: null, inverted: false, updatedAt: Date.now() };
        }

        if (isUsdBase) {
          // Prefer explicit USD_XEL if asked; else invert derived XEL_USD
          if (target === 'XEL') {
            const direct = await store.get({ symbol: 'USD_XEL' }, '1' as Resolution, from, now) as Bar[];
            if (direct?.length) {
              const payload = {
                s: 'ok' as const,
                t: direct.map(b => b.t),
                p: direct.map(b => b.c),
                base, quote, used: 'USD_XEL', inverted: false,
                updatedAt: Date.now(),
              };
              cache.set(ck, { at: Date.now(), val: payload });
              return payload;
            }
          }

          const derived = await deriveUsdBars(store, target!, '1', from, now);
          if (!derived.length) {
            return { s: 'no_data', t: [], p: [], used: null, inverted: false, updatedAt: Date.now() };
          }
          const inv = derived.map(invertBar);
          const payload = {
            s: 'ok' as const,
            t: inv.map(b => b.t),
            p: inv.map(b => b.c),
            base, quote, used: `${target}_USD`, inverted: true,
            updatedAt: Date.now(),
          };
          cache.set(ck, { at: Date.now(), val: payload });
          return payload;
        }

        // Normal BASE_USD
        const usdBars = await deriveUsdBars(store, target!, '1', from, now);
        if (!usdBars.length) {
          return { s: 'no_data', t: [], p: [], used: null, inverted: false, updatedAt: Date.now() };
        }
        const payload = {
          s: 'ok' as const,
          t: usdBars.map(b => b.t),
          p: usdBars.map(b => b.c),
          base, quote, used: `${target}_USD`, inverted: false,
          updatedAt: Date.now(),
        };
        cache.set(ck, { at: Date.now(), val: payload });
        return payload;
      }

      // non-USD: use stored pair or inverted reverse
      const wanted = pairSymbol(base!, quote!);
      let bars = await store.get({ symbol: wanted }, '1' as Resolution, from, now) as Bar[];
      let inverted = false;
      let usedSymbol = wanted;

      if (!bars.length) {
        const reverse = pairSymbol(quote!, base!);
        const rev = await store.get({ symbol: reverse }, '1' as Resolution, from, now) as Bar[];
        if (!rev.length) {
          return { s: 'no_data', t: [], p: [], used: null, inverted: false, updatedAt: Date.now() };
        }
        inverted = true;
        usedSymbol = reverse;
        bars = rev.map(invertBar); // proper OHLC inversion for 1m too
      }

      const payload = {
        s: 'ok' as const,
        t: bars.map(b => b.t),
        p: bars.map(b => b.c),
        base, quote, used: usedSymbol, inverted,
        updatedAt: Date.now(),
      };
      cache.set(ck, { at: Date.now(), val: payload });
      return payload;
    });

    reply.header('Cache-Control', 'public, max-age=2');
    return result;
  });

  app.get('/health', async () => ({ ok: true, updatedAt: Date.now() }));

  await app.listen({ port: PORT, host: '0.0.0.0' });

  const shutdown = async () => {
    try { xelUsdSampler.stop(); unbridge(); await (chain as any)?.close?.(); } finally { process.exit(0); }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch(e => { console.error(e); process.exit(1); });
