import 'dotenv/config';
import Decimal from 'decimal.js';

import { ensureSchemaFromFile } from './dbSchema';
import { Pool } from 'pg';
import { instrumentPg } from './pg-instrument';

import { fromEnvOrFile } from '@forge-backend/shared/utils/env';
import { XelisNodeAdapter } from '@forge-backend/shared/adapters/xelisNodeAdapter';
import { ensureRedis, isRedisHealthy } from '@forge-backend/shared/adapters/redis';
import { VMParam } from '@forge-backend/shared/utils/xvmSerializer';
import { pairSymbol } from '@forge-backend/shared/utils/symbols';

import { decodeVmMapLpReserves } from '@forge-backend/shared/events/swap';
import { AssetMetaCache } from '@forge-backend/shared/services/assetMetaCache';

// Keep candle service separate; main() can still start it by ROLE if you want.
import { startCandleBuilder } from './candle';

import { seedNodesOnce, acquireNode, releaseLease, startLeaseHeartbeat } from './bulletin';
import { NATIVE_ASSET_HASH } from '@forge-backend/shared/constants';
import { getOrCreateAssetIdByHash } from './registry';

// ---------- env ----------
const ROUTER_CONTRACT = process.env.ROUTER_CONTRACT || '';
const NODE_WS_URLS     = process.env.NODE_WS_URLS || '';
const DATABASE_URL    = fromEnvOrFile('DATABASE_URL');
if (!DATABASE_URL) throw new Error('Missing DATABASE_URL or DATABASE_URL_FILE');

// Swarm identity for leases
const TASK_ID   = process.env.HOSTNAME || `pid:${process.pid}`;

// ---------- pg ----------
const pool = new Pool({ connectionString: DATABASE_URL });
// await ensureSchemaFromFile(pool);
instrumentPg(pool, { tag: 'sql', maxQueryLen: 160, sampleFirstRow: true, logParams: true });

// ---------- constants ----------
const MINUTE = 60_000;
const EPS = new Decimal('1e-18');

// ---------- helpers ----------
const bucket = (t: number) => Math.floor(t / MINUTE) * MINUTE;
const toHuman = (u64: bigint, decimals: number) =>
  new Decimal(u64.toString()).div(new Decimal(10).pow(decimals));

const hex = (s: string) => s.toLowerCase();
const assetIdByHash = new Map<string, number>();          // hex -> asset_id
const pairIdByCanon = new Map<string, number>();          // "a_hex_b_hex" (a<=b) -> pair_id

async function getOrCreatePairIdByHashes(
  pool: Pool,
  aHashHex: string,
  bHashHex: string,
  metaCache: AssetMetaCache
): Promise<number> {
  let a = hex(aHashHex), b = hex(bHashHex);
  if (a > b) [a, b] = [b, a]; // canonical: a<=b
  const key = `${a}_${b}`;
  const cached = pairIdByCanon.get(key);
  if (cached) return cached;

  // ensure assets (and learn tickers for display symbol)
  const [aDb, bDb] = await Promise.all([
    getOrCreateAssetIdByHash(pool, a, metaCache),
    getOrCreateAssetIdByHash(pool, b, metaCache),
  ]);
  const symbol = pairSymbol(aDb.ticker, bDb.ticker);
  // pairs row (unique on a_hash,b_hash)
  const ins = await pool.query(
    `INSERT INTO pairs (symbol, a_hash, b_hash)
     VALUES ($1, $2::bytea, $3::bytea)
     ON CONFLICT (a_hash, b_hash) DO UPDATE
       SET symbol = EXCLUDED.symbol, updated_at = now()
     RETURNING id`,
    [symbol, Buffer.from(a, 'hex'), Buffer.from(b, 'hex')]
  );
  const pairId = Number(ins.rows[0].id);

  // pair_components must align to (a_hash,b_hash) == (base,quote)
  await pool.query(
    `INSERT INTO pair_components (pair_id, base_asset_id, quote_asset_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (pair_id) DO UPDATE
       SET base_asset_id=$2, quote_asset_id=$3, updated_at=now()`,
    [pairId, aDb.id, bDb.id]
  );

  pairIdByCanon.set(key, pairId);
  return pairId;
}

/** Return canonical ordering by asset hash and a mapper to/from event order. */
function canonicalizeByHash<T>(aHash: string, bHash: string, aVal: T, bVal: T) {
  const a = hex(aHash), b = hex(bHash);
  const eventIsCanon = a <= b;
  const canonAHash = eventIsCanon ? a : b;
  const canonBHash = eventIsCanon ? b : a;
  const canonAVal  = eventIsCanon ? aVal : bVal;
  const canonBVal  = eventIsCanon ? bVal : aVal;
  return { canonAHash, canonBHash, canonAVal, canonBVal, eventIsCanon };
}

/** Map previous canonical reserves into canonical A/B deltas for this event. */
function deltasInCanonicalFrame(
  prevCanon: { A: Decimal; B: Decimal } | null,
  eventA_amt: Decimal,
  eventB_amt: Decimal,
  eventIsCanon: boolean,
  EPS: Decimal
) {
  if (!prevCanon) {
    return { dAcanon: new Decimal(0), dBcanon: new Decimal(0) };
  }
  // previous reserves are stored canonical: (A,B)
  // event amounts arrive in event order (may match or be flipped)
  const prevA = prevCanon.A;
  const prevB = prevCanon.B;

  // Align event reserves to canonical A/B before differencing
  const A_now = eventIsCanon ? eventA_amt : eventB_amt;
  const B_now = eventIsCanon ? eventB_amt : eventA_amt;

  let dAcanon = A_now.minus(prevA);
  let dBcanon = B_now.minus(prevB);

  if (dAcanon.abs().lt(EPS)) dAcanon = new Decimal(0);
  if (dBcanon.abs().lt(EPS)) dBcanon = new Decimal(0);

  return { dAcanon, dBcanon };
}

// ---------- Dim helpers (get-or-create with tiny in-proc cache) ----------
const routerIdCache = new Map<string, number>();
const pairIdCache   = new Map<string, number>();

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

async function getOrCreatePairId(pool: Pool, symbol: string): Promise<number> {
  const hit = pairIdCache.get(symbol);
  if (hit) return hit;
  const { rows } = await pool.query(
    `INSERT INTO pairs (symbol)
     VALUES ($1)
     ON CONFLICT (symbol) DO UPDATE SET symbol = EXCLUDED.symbol
     RETURNING id`,
    [symbol]
  );
  const id = Number(rows[0].id);
  pairIdCache.set(symbol, id);
  return id;
}

// ---------- DB: swaps (ID-based) ----------
async function upsertSwap(row: {
  id: string;
  router_id: number;
  pair_id: number;
  ts_ms: number;
  block: number;
  side: 1 | -1;
  price: number;
  base_in: number;
  quote_out: number;
}) {
  await pool.query(
    `INSERT INTO swaps (id, router_id, pair_id, ts_ms, block, side, price, base_in, quote_out)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO NOTHING`,
    [row.id, row.router_id, row.pair_id, row.ts_ms, row.block, row.side, row.price, row.base_in, row.quote_out]
  );
}

// ---------- DB: reserves_latest (topo-aware; TEXT router & pool_key kept) ----------
type CanonRes = { A: Decimal; B: Decimal; t_ms: number; topo: number };

async function getReservesLatest(router: string, aHash: string, bHash: string) {
  const ah = hex(aHash), bh = hex(bHash);
  const [a, b] = ah <= bh ? [ah, bh] : [bh, ah];
  const pool_key = `${a}_${b}`;
  const { rows } = await pool.query(
    `SELECT a_amount, b_amount, t_ms, topo
       FROM reserves_latest
      WHERE router=$1 AND pool_key=$2`,
    [router, pool_key]
  );
  if (!rows.length) return null;
  return {
    A: new Decimal(rows[0].a_amount),
    B: new Decimal(rows[0].b_amount),
    t_ms: Number(rows[0].t_ms),
    topo: Number(rows[0].topo),
  };
}

/** Insert/Update latest reserves if (topo, t_ms) is newer. */
async function upsertReservesLatest(
  router: string,
  h0: string, h1: string,
  A_in: Decimal, B_in: Decimal,
  t_ms: number,
  topo: number
) {
  const a0 = hex(h0), b0 = hex(h1);
  const a_hash = a0 <= b0 ? a0 : b0;
  const b_hash = a0 <= b0 ? b0 : a0;
  const A = a0 <= b0 ? A_in : B_in;
  const B = a0 <= b0 ? B_in : A_in;
  const pool_key = `${a_hash}_${b_hash}`;

  await pool.query(
    `INSERT INTO reserves_latest (router, pool_key, a_amount, b_amount, t_ms, topo)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (router, pool_key) DO UPDATE
       SET a_amount=EXCLUDED.a_amount,
           b_amount=EXCLUDED.b_amount,
           t_ms=EXCLUDED.t_ms,
           topo=EXCLUDED.topo,
           updated_at=now()
       WHERE (EXCLUDED.topo > reserves_latest.topo)
          OR (EXCLUDED.topo = reserves_latest.topo AND EXCLUDED.t_ms > reserves_latest.t_ms)`,
    [router, pool_key, A.toString(), B.toString(), t_ms, topo]
  );
}

// ---------- bootstrap reserves into DB (no candle writes here) ----------
async function seedFromRouter(
  chain: XelisNodeAdapter,
  metaCache: AssetMetaCache,
  topoCounterRef: { v: number }
) {
  const router = ROUTER_CONTRACT;
  if (!router) return;

  // Ensure router row exists
  await getOrCreateRouterId(pool, router);

  const lpIds = await chain.getContractAssets(router);
  const now = Date.now();

  for (const lpId of lpIds) {
    try {
      const cd = await chain.getContractData({ contract: router, key: VMParam.hash(lpId) });
      const obj = cd?.data?.type === 'object' && cd?.data?.value?.[1];
      const map = obj?.type === 'map' ? (obj.value as Record<string, any>) : null;
      if (!map) continue;

      const [aHash, bHash] = Object.keys(map) as [string, string];

      // Get decimals to humanize reserves
      const [m0, m1] = await Promise.all([
        metaCache.get(aHash),
        metaCache.get(bHash),
      ]);

      const A_evt = toHuman(BigInt(map[aHash] as any), m0.decimals);
      const B_evt = toHuman(BigInt(map[bHash] as any), m1.decimals);
      if (A_evt.isZero() || B_evt.isZero()) continue;

      // Canonicalize by hash (a<=b) and align amounts to canonical sides
      const { canonAHash, canonBHash } =
        canonicalizeByHash<string>(aHash, bHash, aHash, bHash);

      const A_canon = (canonAHash === aHash) ? A_evt : B_evt;
      const B_canon = (canonAHash === aHash) ? B_evt : A_evt;

      // Persist latest reserves baseline (topo-aware) in canonical order
      await upsertReservesLatest(
        router,
        canonAHash,
        canonBHash,
        A_canon,
        B_canon,
        now,
        topoCounterRef.v++
      );

      // Ensure pairs + pair_components exist (canonical by hashes; symbol is display only)
      await getOrCreatePairIdByHashes(pool, aHash, bHash, metaCache);
    } catch {
      // ignore individual LP errors during bootstrap
    }
  }
}

// ---------- main indexer ----------
let localSeq = 0;

async function waitForRedis() {
  await ensureRedis();
  const deadline = Date.now() + 10_000;
  while (!(await isRedisHealthy(800))) {
    if (Date.now() > deadline) throw new Error('redis not healthy after 10s');
    await new Promise(r => setTimeout(r, 250));
  }
}

async function startIndexer() {
  await waitForRedis();
  if (NODE_WS_URLS) await seedNodesOnce(NODE_WS_URLS);

  let lease = await acquireNode(TASK_ID);
  let backoff = 250;
  while (!lease) {
    await new Promise(r => setTimeout(r, backoff));
    lease = await acquireNode(TASK_ID);
    backoff = Math.min(backoff * 2, 2000);
  }

  const { nodeId, url: NODE_WS_URL } = lease;
  console.log('[indexer] acquired node', { nodeId, url: NODE_WS_URL });

  const stopLeaseHb = startLeaseHeartbeat(nodeId, TASK_ID, () => {
    console.error('[indexer] lease lost; exiting so another replica can reacquire');
    process.exit(1);
  });

  console.log('[indexer] connecting to node', NODE_WS_URL);
  const chain = await XelisNodeAdapter.connect(NODE_WS_URL);
  
  const metaCache = new AssetMetaCache(pool, chain);

  // until you wire real topoheight from node events:
  const topoCounter = { v: 0 };

  await seedFromRouter(chain, metaCache, topoCounter);

  const routerId = await getOrCreateRouterId(pool, ROUTER_CONTRACT);

  console.log('[indexer] listening for swap/reserve events…');

  chain.onContractEvent(ROUTER_CONTRACT, 1, async (evt) => {
    try {
      const reserves = decodeVmMapLpReserves(evt.data as any);
      if (reserves.length !== 2) return;

      const [r0, r1] = reserves;
      const [m0, m1] = await Promise.all([metaCache.get(r0.assetHash), metaCache.get(r1.assetHash)]);

      // Humanized amounts in **event order**
      const a_evt_amt = toHuman(r0.amountU64, m0.decimals);
      const b_evt_amt = toHuman(r1.amountU64, m1.decimals);

      // Canonicalize by hash; also map metas to canonical side
      const {
        canonAHash, canonBHash,
        canonAVal: a_evt_amt_cand,  // same object as a_evt_amt or b_evt_amt
        canonBVal: b_evt_amt_cand,
        eventIsCanon
      } = canonicalizeByHash<Decimal>(r0.assetHash, r1.assetHash, a_evt_amt, b_evt_amt);

      const pairId = await getOrCreatePairIdByHashes(pool, r0.assetHash, r1.assetHash, metaCache);

      const now = Date.now();

      // Fetch previous canonical reserves from DB (already canonical in your schema)
      const prevCanon = await getReservesLatest(ROUTER_CONTRACT, canonAHash, canonBHash);

      // Compute deltas in canonical frame (A,B)
      const { dAcanon, dBcanon } = deltasInCanonicalFrame(
        prevCanon,
        a_evt_amt,  // raw event order; function will align via eventIsCanon
        b_evt_amt,
        eventIsCanon,
        EPS
      );

      // Determine swap vs LP in **canonical frame**
      const isSwapAB = dAcanon.gt(0) && dBcanon.lt(0); // input A, output B
      const isSwapBA = dAcanon.lt(0) && dBcanon.gt(0); // input B, output A
      const isLP     = !isSwapAB && !isSwapBA;

      // Execution price (A in B) from **deltas**, stored canonical
      if (prevCanon && !isLP) {
        // Price is always A_in_B, relative to canonical A/B
        const priceAinB = isSwapAB
          ? dBcanon.abs().div(dAcanon)
          : dBcanon.div(dAcanon.abs()); 

        const side: 1 | -1 = isSwapAB ? 1 : -1;       // relative to canonical A_B

        // Volumes stored relative to canonical A_B:
        const base_in   = (isSwapAB ? dAcanon : dBcanon).abs();
        const quote_out = (isSwapAB ? dBcanon : dAcanon).abs();

        // NOTE: keep a stable id; replace with TXID when available
        const seqStr = String(localSeq++).padStart(9, '0'); // enough for 1k+ ticks/ms
        const id = `${routerId}:${now}:${seqStr}:${pairId}`;

        await upsertSwap({
          id,
          router_id: routerId,
          pair_id: pairId,
          ts_ms: now,
          block: 0,                     // fill with real block when available
          side,
          price: priceAinB.toNumber(),
          base_in: base_in.toNumber(),
          quote_out: quote_out.toNumber()
        });
      }

      // Persist latest reserves baseline (topo-aware), **canonical order**
      await upsertReservesLatest(
        ROUTER_CONTRACT,
        canonAHash, canonBHash,
        eventIsCanon ? a_evt_amt : b_evt_amt,   // amounts aligned to canonical
        eventIsCanon ? b_evt_amt : a_evt_amt,
        now,
        topoCounter.v++
      );

    } catch (e) {
      console.error('[indexer] event processing failed', e);
    }
  });

  const stop = async () => {
    try {
      try { stopLeaseHb?.(); } catch {}
      try { await releaseLease(nodeId, TASK_ID); } catch {}
      try { await (chain as any)?.close?.(); } catch {}
      await pool.end();
    }
     finally { process.exit(0); }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });
  process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });
}

// ---------- entry ----------
async function main() {
  const role = (process.env.ROLE || 'indexer').toLowerCase();
  const service = process.env.SERVICE_NAME || role;

  console.log(`[boot] service=${service} role=${role}`);

  if (role.includes('indexer')) {
    await startIndexer();
  } else if (role.includes('candle')) {
    await startCandleBuilder(pool, process.env.ROUTER_CONTRACT!);
  } else {
    throw new Error(`Unknown ROLE=${role}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });