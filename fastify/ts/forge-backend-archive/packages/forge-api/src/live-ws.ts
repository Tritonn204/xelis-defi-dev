import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { Res } from '@forge-backend/shared/utils/types';
import { ensureRedisSub } from '@forge-backend/shared/adapters/redis';
import { pool, queryCandles } from './db';

import {
  parseAssetSymbol,
  getAssetByTicker,
  getAssetByHash,
  getPairIdByHashes,
  getRouterIdByContract
} from './db';

const MINUTE = 60_000;
const BUCKET_MS: Record<Res, number> = {
  '1': MINUTE, '5': 5 * MINUTE, '15': 15 * MINUTE, '60': 60 * MINUTE,
  '240': 240 * MINUTE, '1D': 24 * 60 * MINUTE, '1W': 7 * 24 * MINUTE, '1M': 30 * 24 * MINUTE
};

const DEFAULT_AMM_ROUTER = process.env.ROUTER_CONTRACT || '';
const HEARTBEAT_MS = 10_000;
const PONG_GRACE = 12;

// -------------------------------
// Types & Utilities
// -------------------------------

type WS = {
  send: (d: string) => any;
  on: (ev: string, cb: (...a: any[]) => void) => any;
  close?: (code?: number, reason?: string) => any;
  ping?: () => any;
  terminate?: () => any;
  readyState?: number;
};

interface ArpData {
  timestamp: number;
  price: number;
  confidence: number;
  hops: number;
  source: string;
  bestPathEdges?: number[];
}

const toWS = (conn: any): WS => (conn?.socket?.send ? conn.socket : conn);

// -------------------------------
// Redis Key Functions
// -------------------------------

const pairKey = (routerStr: string, aHash: string, bHash: string) => {
  const [h1, h2] = aHash < bHash ? [aHash, bHash] : [bHash, aHash];
  return `${routerStr}:${h1}_${h2}`;
};

const arpKey = (hashHex: string, anchor: string = 'usd') => 
  `arp:${hashHex.toLowerCase().replace(/^0x/, '')}:${anchor.toLowerCase()}`;

// -------------------------------
// Parsing Functions
// -------------------------------

function parseLiveBar(payload: any): { t: number, o: number, h: number, l: number, c: number, v: number } | null {
  if (!payload || typeof payload !== 'object') return null;

  const tRaw = payload.t ?? payload.time;
  const oRaw = payload.o ?? payload.open;
  const hRaw = payload.h ?? payload.high;
  const lRaw = payload.l ?? payload.low;
  const cRaw = payload.c ?? payload.close;
  const vRaw = payload.v ?? payload.volume ?? 0;

  const t = Number(tRaw);
  const o = Number(oRaw);
  const h = Number(hRaw);
  const l = Number(lRaw);
  const c = Number(cRaw);
  const v = Number(vRaw);

  if (![t, o, h, l, c].every(Number.isFinite)) return null;

  const tMs = t < 2_000_000_000 ? t * 1000 : t;

  if (o === 0 || h === 0 || l === 0 || c === 0) return null;

  return { t: tMs, o, h, l, c, v: Number.isFinite(v) ? v : 0 };
}

function parseArpData(payload: any): ArpData | null {
  if (!payload || typeof payload !== 'object') return null;

  const timestamp = Number(payload.t || payload.timestamp || Date.now());
  const price = Number(payload.price || payload.c || payload.close);
  const confidence = Number(payload.confidence || 1.0);
  const hops = Number(payload.hops || payload.hop_count || 0);
  const source = payload.source || 'unknown';
  const bestPathEdges = payload.bestPathEdges || payload.best_path_edges || [];

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;

  const tMs = timestamp < 2_000_000_000 ? timestamp * 1000 : timestamp;

  return {
    timestamp: tMs,
    price,
    confidence,
    hops,
    source,
    bestPathEdges
  };
}

function invert1m(b: { t: number, o: number, h: number, l: number, c: number, v: number }) {
  if (!b.o || !b.h || !b.l || !b.c) return b;
  return { t: b.t, o: 1 / b.o, h: 1 / b.l, l: 1 / b.h, c: 1 / b.c, v: b.v };
}

function bucketStart(tMs: number, res: Res) {
  const size = BUCKET_MS[res] || MINUTE;
  return Math.floor(tMs / size) * size;
}

// -------------------------------
// WebSocket Message Emitters
// -------------------------------

function emitBar(ws: WS, barMs: { t: number, o: number, h: number, l: number, c: number, v: number }) {
  const tSec = Math.floor(barMs.t / 1000);
  ws.send(JSON.stringify({
    type: 'bar',
    bar: { t: tSec, o: barMs.o, h: barMs.h, l: barMs.l, c: barMs.c, v: barMs.v }
  }));
}

function emitArpUpdate(
  ws: WS, 
  arpData: ArpData,
  asset: { hash: string, ticker: string }
) {
  const tSec = Math.floor(arpData.timestamp / 1000);
  ws.send(JSON.stringify({
    type: 'arp_update',
    timestamp: tSec,
    price: arpData.price,
    confidence: arpData.confidence,
    hops: arpData.hops,
    source: arpData.source,
    asset: asset,
    bestPathEdges: arpData.bestPathEdges
  }));
}

function emitError(ws: WS, error: string, details?: any) {
  ws.send(JSON.stringify({
    type: 'error',
    error,
    ...details
  }));
}

// -------------------------------
// Data Seeding Functions
// -------------------------------

async function seedPairFromRedisOrDb(
  routerId: number,
  pairId: number,
  routerStr: string,
  aHash: string,
  bHash: string,
  res: Res,
  inverted: boolean
): Promise<{ t: number, o: number, h: number, l: number, c: number, v: number } | null> {
  try {
    const r = await ensureRedisSub();
    const key = `live:bar:${pairKey(routerStr, aHash, bHash)}:${res}`;
    const raw = await r.hGet(key, '1');
    if (raw) {
      const x = JSON.parse(raw);
      let bar = parseLiveBar(x);
      if (bar) {
        if (inverted) bar = invert1m(bar);
        return bar;
      }
    }
  } catch { }

  const now = Date.now();
  const lookback = res === '1' ? 6 * MINUTE : 3 * BUCKET_MS[res];
  
  const rows = await queryCandles(routerId, pairId, res, now - lookback, now);
  const last = rows.at(-1);
  
  if (!last) return null;
  return inverted ? invert1m(last) : last;
}

async function seedArpFromRedis(assetHash: string, anchor: string = 'usd'): Promise<ArpData | null> {
  try {
    const r = await ensureRedisSub();
    const key = arpKey(assetHash, anchor);
    const raw = await r.hGet(key, 'latest');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parseArpData(parsed);
    }
  } catch { }
  return null;
}

// -------------------------------
// Main WebSocket Handler
// -------------------------------

export async function wireLiveWs(app: FastifyInstance) {
  await app.register(websocket);

  app.get('/ws', { websocket: true }, async (conn, req) => {
    const ws = toWS(conn);

    const url = new URL(req.url, 'http://x');
    const symbolParam = url.searchParams.get('symbol') || 'XEL_USD';
    const res = (url.searchParams.get('res') || '1') as Res;
    const routerHint = url.searchParams.get('router') || undefined;

    const [baseInput, quoteInput = 'XEL'] = symbolParam.toUpperCase().split('_');

    const baseAsset = await parseAssetSymbol(baseInput);
    if (typeof baseAsset === 'string') {
      emitError(ws, `base_${baseAsset}`, { input: baseInput });
      ws.close?.(1008, `base_${baseAsset}`);
      return;
    }

    const quoteAsset = await parseAssetSymbol(quoteInput);
    if (typeof quoteAsset === 'string') {
      emitError(ws, `quote_${quoteAsset}`, { input: quoteInput });
      ws.close?.(1008, `quote_${quoteAsset}`);
      return;
    }

    const routerStr = routerHint || (quoteAsset.ticker === 'USD' ? 'ORACLE' : DEFAULT_AMM_ROUTER);
    const routerId = await getRouterIdByContract(routerStr);
    if (!routerId) {
      emitError(ws, 'router_not_found', { router: routerStr });
      ws.close?.(1008, 'router_not_found');
      return;
    }

    let missedPongs = 0;
    let hbTimer: NodeJS.Timeout | null = null;
    let currentChannel: string | null = null;
    let currentCallback: ((message: string, channel: string) => void) | null = null;
    let rollup: { t: number, o: number, h: number, l: number, c: number, v: number } | null = null;

    ws.on('pong', () => { missedPongs = 0; });
    ws.on('message', (buf: any) => {
      if (String(buf) === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch { }
      }
    });

    const r = await ensureRedisSub();

    if (quoteAsset.ticker === 'USD') {
      currentChannel = arpKey(baseAsset.hash, 'usd');

      const initialArp = await seedArpFromRedis(baseAsset.hash, 'usd');
      if (initialArp) {
        emitArpUpdate(ws, initialArp, baseAsset);
      }

      currentCallback = (message: string, _channel: string) => {
        try {
          const data = JSON.parse(message);
          const arpData = parseArpData(data);
          if (arpData) {
            emitArpUpdate(ws, arpData, baseAsset);
          }
        } catch { }
      };

      await r.subscribe(currentChannel, currentCallback);
    } else {
      const pairId = await getPairIdByHashes(baseAsset.hash, quoteAsset.hash);
      if (!pairId) {
        emitError(ws, 'pair_not_found', {
          base: baseAsset,
          quote: quoteAsset
        });
        ws.close?.(1008, 'pair_not_found');
        return;
      }

      const inverted = baseAsset.hash > quoteAsset.hash;
      currentChannel = `live:bar:${pairKey(routerStr, baseAsset.hash, quoteAsset.hash)}:1`;

      try {
        const seed = await seedPairFromRedisOrDb(
          routerId, pairId, routerStr,
          baseAsset.hash, quoteAsset.hash,
          res, inverted
        );
        if (seed) emitBar(ws, seed);
      } catch { }

      currentCallback = (message: string, _channel: string) => {
        try {
          const x = JSON.parse(message);
          let bar1m = parseLiveBar(x);
          if (!bar1m) return;
          if (inverted) bar1m = invert1m(bar1m);

          if (res === '1') {
            emitBar(ws, bar1m);
            return;
          }

          const bStart = bucketStart(bar1m.t, res);
          if (!rollup || rollup.t !== bStart) {
            rollup = { t: bStart, o: bar1m.o, h: bar1m.h, l: bar1m.l, c: bar1m.c, v: bar1m.v };
          } else {
            rollup.c = bar1m.c;
            if (bar1m.h > rollup.h) rollup.h = bar1m.h;
            if (bar1m.l < rollup.l) rollup.l = bar1m.l;
            rollup.v += bar1m.v;
          }
          emitBar(ws, rollup);
        } catch { }
      };

      await r.subscribe(currentChannel, currentCallback);
    }

    hbTimer = setInterval(() => {
      try {
        if (typeof ws.ping === 'function') {
          ws.ping();
        } else {
          ws.send('ping');
        }
        missedPongs++;
        if (missedPongs > PONG_GRACE) {
          try { ws.terminate?.(); } catch { ws.close?.(1011, 'heartbeat missed'); }
        }
      } catch {
        try { ws.close?.(1011, 'heartbeat error'); } catch { }
      }
    }, HEARTBEAT_MS);

    ws.on('message', async (buf: any) => {
      try {
        const m = JSON.parse(String(buf || ''));
        if (m?.type !== 'subscribe') return;

        const nextSymbol = String(m.symbol || symbolParam).toUpperCase();
        const nextRes = String(m.res || res) as Res;
        const nextRouter = m.router ? String(m.router) : routerHint;

        const [nextBaseInput, nextQuoteInput = 'XEL'] = nextSymbol.split('_');

        const nextBase = await parseAssetSymbol(nextBaseInput);
        const nextQuote = await parseAssetSymbol(nextQuoteInput);

        if (typeof nextBase === 'string' || typeof nextQuote === 'string') {
          emitError(ws, 'invalid_resubscribe', {
            base: typeof nextBase === 'string' ? nextBase : undefined,
            quote: typeof nextQuote === 'string' ? nextQuote : undefined
          });
          return;
        }

        if (currentChannel) {
          await r.unsubscribe(currentChannel);
        }

        rollup = null;

        if (nextQuote.ticker === 'USD') {
          currentChannel = arpKey(nextBase.hash, 'usd');

          const initialArp = await seedArpFromRedis(nextBase.hash, 'usd');
          if (initialArp) {
            emitArpUpdate(ws, initialArp, nextBase);
          }

          currentCallback = (message: string, _channel: string) => {
            try {
              const data = JSON.parse(message);
              const arpData = parseArpData(data);
              if (arpData) {
                emitArpUpdate(ws, arpData, nextBase);
              }
            } catch { }
          };

          await r.subscribe(currentChannel, currentCallback);
        } else {
          const nextPairId = await getPairIdByHashes(nextBase.hash, nextQuote.hash);
          if (!nextPairId) {
            emitError(ws, 'pair_not_found', {
              base: nextBase,
              quote: nextQuote
            });
            return;
          }

          const nextInverted = nextBase.hash > nextQuote.hash;
          const nextRouterStr = nextRouter || routerStr;
          currentChannel = `live:bar:${pairKey(nextRouterStr, nextBase.hash, nextQuote.hash)}:1`;

          try {
            const seed = await seedPairFromRedisOrDb(
              routerId, nextPairId, nextRouterStr,
              nextBase.hash, nextQuote.hash,
              nextRes, nextInverted
            );
            if (seed) emitBar(ws, seed);
          } catch { }

          currentCallback = (message: string, _channel: string) => {
            try {
              const x = JSON.parse(message);
              let bar1m = parseLiveBar(x);
              if (!bar1m) return;
              if (nextInverted) bar1m = invert1m(bar1m);

              if (nextRes === '1') {
                emitBar(ws, bar1m);
                return;
              }

              const bStart = bucketStart(bar1m.t, nextRes);
              if (!rollup || rollup.t !== bStart) {
                rollup = { t: bStart, o: bar1m.o, h: bar1m.h, l: bar1m.l, c: bar1m.c, v: bar1m.v };
              } else {
                rollup.c = bar1m.c;
                if (bar1m.h > rollup.h) rollup.h = bar1m.h;
                if (bar1m.l < rollup.l) rollup.l = bar1m.l;
                rollup.v += bar1m.v;
              }
              emitBar(ws, rollup);
            } catch { }
          };

          await r.subscribe(currentChannel, currentCallback);
        }
      } catch { }
    });

    ws.on('close', async () => {
      if (hbTimer) {
        clearInterval(hbTimer);
        hbTimer = null;
      }
      try {
        if (currentChannel) {
          await r.unsubscribe(currentChannel);
        }
      } catch { }
    });
  });
}