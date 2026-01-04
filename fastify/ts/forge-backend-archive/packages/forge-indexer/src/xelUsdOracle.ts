import { Pool } from 'pg';
import WebSocket from 'ws';
import { CandleAccumulator } from '@forge-backend/shared/utils/candleAccum';
import { updateLiveArp, updateLiveBar } from './liveCache';
import { PushDataV3ApiWrapper } from './vendor/mexc/PushDataV3ApiWrapper';

// Import native + virtual USD constants
import { NATIVE_ASSET_HASH, VIRTUAL_USD } from '@forge-backend/shared/constants';

const LOG_ENABLED = process.env.ORACLE_LOG !== '0';
const log  = (...a: any[]) => { if (LOG_ENABLED) console.log('[oracle]', ...a); };
const warn = (...a: any[]) => console.warn('[oracle]', ...a);

const MINUTE = 60_000;

const WS_URL       = process.env.MEXC_WS_URL       || 'wss://wbs-api.mexc.com/ws';
const SYMBOL       = process.env.MEXC_SYMBOL       || 'XELUSDT';
const INTERVAL     = process.env.MEXC_INTERVAL     || 'Min1';
const ROUTER_TAG   = process.env.ORACLE_ROUTER     || 'ORACLE';
const PING_MS      = Number(process.env.MEXC_PING_MS || 20_000);
const REOPEN_BASE  = Number(process.env.MEXC_REOPEN_BASE_MS || 2_000);
const REOPEN_MAX   = Number(process.env.MEXC_REOPEN_MAX_MS  || 60_000);

let cachedRouterId: number | null = null;
let cachedXelAssetId: number | null = null;
let cachedUsdAssetId: number | null = null;
let cachedUsdAnchorId: number | null = null;

// ───────────────────────────────── helpers ──────────────────────────────────
async function getOrCreateRouterId(pool: Pool, router: string): Promise<number> {
  if (cachedRouterId != null) return cachedRouterId;
  const { rows } = await pool.query(
    `INSERT INTO routers (router)
     VALUES ($1)
     ON CONFLICT (router) DO UPDATE SET router = EXCLUDED.router
     RETURNING id`,
    [router]
  );
  cachedRouterId = Number(rows[0].id);
  return cachedRouterId;
}

async function ensureAsset(
  pool: Pool,
  hashHexIn: string,
  tickerIn: string,
  decimalsIn: number,
  meta: Record<string, any> = {}
): Promise<number> {
  const hex = hashHexIn.replace(/^0x/, '').toLowerCase();
  const buf = Buffer.from(hex, 'hex');

  let ticker = tickerIn;
  let decimals = decimalsIn;
  let finalMeta = { ...meta };

  // Native XEL (chain asset)
  if (hex === NATIVE_ASSET_HASH.toLowerCase()) {
    ticker = 'XEL';
    decimals = 8;
  }
  // Virtual USD (no on-chain asset)
  else if (hex === VIRTUAL_USD.hashHex.toLowerCase()) {
    ticker = 'USD';
    decimals = VIRTUAL_USD.decimals;
    finalMeta = { virtual: true, source: 'oracle' };
  }

  const { rows } = await pool.query(
    `INSERT INTO assets (hash, ticker, decimals, meta)
     VALUES ($1::bytea, $2, $3, $4::jsonb)
     ON CONFLICT (hash) DO UPDATE
       SET updated_at = now()
     RETURNING id`,
    [buf, ticker, decimals, JSON.stringify(finalMeta)]
  );

  return Number(rows[0].id);
}

async function ensureUsdAnchor(pool: Pool, routerId: number, usdAssetId: number): Promise<number> {
  if (cachedUsdAnchorId != null) return cachedUsdAnchorId;
  
  const { rows } = await pool.query(
    `INSERT INTO anchors (name, router_id, target_asset_id, active)
     VALUES ('USD', $1, $2, true)
     ON CONFLICT (router_id, name) DO UPDATE 
       SET target_asset_id = EXCLUDED.target_asset_id, active = true
     RETURNING id`,
    [routerId, usdAssetId]
  );
  
  cachedUsdAnchorId = Number(rows[0].id);
  return cachedUsdAnchorId;
}

async function getXelAssetId(pool: Pool): Promise<number> {
  if (cachedXelAssetId != null) return cachedXelAssetId;
  
  const { rows } = await pool.query(
    `SELECT id FROM assets WHERE hash = $1::bytea`,
    [Buffer.from(NATIVE_ASSET_HASH.replace(/^0x/, ''), 'hex')]
  );
  
  if (!rows[0]) {
    throw new Error('XEL asset not found in database');
  }
  
  cachedXelAssetId = Number(rows[0].id);
  return cachedXelAssetId;
}

async function getUsdAssetId(pool: Pool): Promise<number> {
  if (cachedUsdAssetId != null) return cachedUsdAssetId;
  
  const { rows } = await pool.query(
    `SELECT id FROM assets WHERE hash = $1::bytea`,
    [Buffer.from(VIRTUAL_USD.hashHex.replace(/^0x/, ''), 'hex')]
  );
  
  if (!rows[0]) {
    throw new Error('USD asset not found in database');
  }
  
  cachedUsdAssetId = Number(rows[0].id);
  return cachedUsdAssetId;
}

// ───────────────────── decoding utils (unchanged) ─────────────────────────────
function toU8(input: any): Uint8Array {
  if (Array.isArray(input)) {
    if (input.length === 1) return toU8(input[0]);
    return Buffer.concat(input as Buffer[]);
  }
  if (Buffer.isBuffer(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof Uint8Array) return input;
  if (input?.buffer) return new Uint8Array(input.buffer, input.byteOffset ?? 0, input.byteLength ?? input.buffer?.byteLength ?? 0);
  if (input?.byteLength != null) return new Uint8Array(input as ArrayBufferLike);
  return new Uint8Array(0);
}

function decodeWrapperBytes(u8: Uint8Array): PushDataV3ApiWrapper | null {
  try { return PushDataV3ApiWrapper.fromBinary(u8); }
  catch { 
    try {
      const s = Buffer.from(u8).toString('utf8');
      if (s && (s.startsWith('{') || s.startsWith('['))) return null;
    } catch {}
    return null;
  }
}

const n = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : NaN;
const pickTs = (...c: unknown[]) => {
  for (const x of c) { const v = n(x); if (Number.isFinite(v) && v > 0) return v; }
  return null;
};

function extractKlineClose(
  wrapper: PushDataV3ApiWrapper
): { ts: number; open: number; high: number; low: number; close: number; windowStart?: number; windowEnd?: number } | null {
  const body = (wrapper as any).body;
  if (!body || body.oneofKind === undefined) return null;

  const cand: any[] = [];
  for (const k of ['publicSpotKline','publicMiniTicker','publicMiniTickers']) {
    if (body.oneofKind === k && body[k]) {
      const obj = body[k];
      cand.push(obj);
      if (obj.kline) cand.push(obj.kline);
      if (obj.data)  cand.push(obj.data);
      if (k === 'publicMiniTickers' && obj.list?.length) {
        const first = obj.list[0];
        cand.push(first, first?.kline, first?.data);
      }
    }
  }
  cand.push(wrapper as any);

  for (const obj of cand) {
    if (!obj || typeof obj !== 'object') continue;
    const open  = n((obj as any).open ?? (obj as any).o ?? (obj as any).openingPrice ?? (obj as any).openingprice);
    const high  = n((obj as any).high ?? (obj as any).h ?? (obj as any).highestPrice ?? (obj as any).highestprice);
    const low   = n((obj as any).low  ?? (obj as any).l ?? (obj as any).lowestPrice ?? (obj as any).lowestprice);
    const close = n((obj as any).close ?? (obj as any).c ?? (obj as any).closingPrice ?? (obj as any).closingprice);

    let windowStart = pickTs((obj as any).windowStart, (obj as any).windowstart, (obj as any).window_start);
    let windowEnd   = pickTs((obj as any).windowEnd,   (obj as any).windowend,   (obj as any).window_end);
    let ts = pickTs(windowStart, windowEnd, (obj as any).ts, (obj as any).time, (obj as any).t, (wrapper as any).sendTime, (wrapper as any).createTime);

    if (ts != null && ts < 1e12) ts = Math.round(ts * 1000);
    if (windowStart != null && windowStart < 1e12) windowStart = Math.round(windowStart * 1000);
    if (windowEnd   != null && windowEnd   < 1e12) windowEnd   = Math.round(windowEnd * 1000);

    if ([open,high,low,close].every(Number.isFinite) && ts != null) {
      const out: any = { ts, open, high, low, close };
      if (windowStart != null) out.windowStart = windowStart;
      if (windowEnd   != null) out.windowEnd   = windowEnd;
      return out;
    }
  }
  return null;
}

// ───────────────────────────── Oracle entrypoint ──────────────────────────────
export type OracleHandle = { stop: () => void };

export async function startXelUsdOracle(pool: Pool): Promise<OracleHandle> {
  log('booting oracle', { WS_URL, SYMBOL, INTERVAL, ROUTER_TAG });

  const acc = new CandleAccumulator(MINUTE);
  const router_id = await getOrCreateRouterId(pool, ROUTER_TAG);

  // Ensure assets exist
  const xelHex = NATIVE_ASSET_HASH.toLowerCase();
  const usdHex = VIRTUAL_USD.hashHex.toLowerCase();

  // await ensureAsset(pool, xelHex, 'XEL', 8);
  await ensureAsset(pool, usdHex, 'USD', VIRTUAL_USD.decimals);
    
  // Get asset IDs and ensure USD anchor
  const xelAssetId = await getXelAssetId(pool);
  const usdAssetId = await getUsdAssetId(pool);
  const usdAnchorId = await ensureUsdAnchor(pool, router_id, usdAssetId);

  let ws: WebSocket | null = null;
  let running = true;
  let pingTimer: NodeJS.Timeout | null = null;
  let reopen = REOPEN_BASE;

  let activeBucketStart = -1;
  let activeArpPrice = 0;

  const subscribe = () => {
    const topic = `spot@public.kline.v3.api.pb@${SYMBOL}@${INTERVAL}`;
    ws?.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [topic] }));
  };

  const startPing = () => {
    stopPing();
    pingTimer = setInterval(() => {
      try { ws?.send(JSON.stringify({ method: 'PING' })); } catch {}
    }, PING_MS);
  };
  const stopPing = () => { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } };

  const open = () => {
    if (!running) return;
    ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';

    ws.once('open', () => { reopen = REOPEN_BASE; startPing(); subscribe(); });

    ws.on('message', async (data) => {
      try {
        if (typeof data === 'string') return;
        const wrapper = decodeWrapperBytes(toU8(data));
        if (!wrapper) return;

        const k = extractKlineClose(wrapper);
        if (!k) return;

        // Exchange kline is already USD per XEL (what we want for XEL's price in USD)
        const xelUsdPrice = k.close;
        
        const bucketOpen = k.windowStart != null
          ? Math.floor(k.windowStart / MINUTE) * MINUTE
          : Math.floor(k.ts / MINUTE) * MINUTE;

        // Write completed bucket to ARP
        if (activeBucketStart !== -1 && bucketOpen !== activeBucketStart && activeArpPrice > 0) {
          try {
            await pool.query(
              `INSERT INTO arp_points_1m (
                router_id, anchor_id, asset_id, t_start,
                price_in_anchor, confidence_score, hop_count, flags  -- ✅ Fixed column name
              ) VALUES ($1, $2, $3, $4, $5, 1.0, 0, ARRAY['oracle'])
              ON CONFLICT (router_id, anchor_id, asset_id, t_start)
              DO UPDATE SET 
                price_in_anchor = EXCLUDED.price_in_anchor,  -- ✅ Fixed
                confidence_score = 1.0,
                hop_count = 0,
                flags = EXCLUDED.flags,
                updated_at = now()`,
              [router_id, usdAnchorId, xelAssetId, activeBucketStart, activeArpPrice]
            );
            log('wrote ARP point:', { bucket: new Date(activeBucketStart).toISOString(), price: activeArpPrice });
          } catch (e) {
            warn('persist ARP failed:', (e as any)?.message ?? e);
          }
        }

        // Update live ARP in Redis (using ARP-specific key format)
        try {
          await updateLiveArp(
            xelHex,  // Asset hash (already lowercase, no 0x prefix)
            'usd',   // Anchor currency
            {
              timestamp: bucketOpen,
              price: xelUsdPrice,
              confidence: 1.0,  // Oracle prices have 100% confidence
              hops: 0,          // Direct oracle feed
              source: 'oracle',
              bestPathEdges: [] // No path - direct oracle
            }
          );
        } catch (e) {
          warn('live ARP update failed:', (e as any)?.message ?? e);
        }

        activeBucketStart = bucketOpen;
        activeArpPrice = xelUsdPrice;
        
      } catch (e) {
        warn('frame err:', (e as any)?.message ?? e);
      }
    });

    const scheduleReopen = (why: string) => {
      if (!running) return;
      stopPing();
      try { ws?.terminate(); } catch {}
      ws = null;
      const wait = Math.min(reopen, REOPEN_MAX) | 0;
      setTimeout(open, wait);
      reopen = Math.min(wait * 2, REOPEN_MAX);
      log('ws will reopen in', wait, 'ms:', why);
    };

    ws.once('close', (code, reason) => scheduleReopen(`close ${code} ${reason?.toString?.() ?? ''}`));
    ws.once('error', (err) => scheduleReopen(`error ${(err as any)?.message ?? err}`));
  };

  open();

  return {
    stop() {
      running = false;
      stopPing();
      try { ws?.close(); } catch {}
    }
  };
}