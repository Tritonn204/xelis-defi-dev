import { Pool } from 'pg';
import { AssetMetaCache } from '@forge-backend/shared/services/assetMetaCache';
import { NATIVE_ASSET_HASH } from '@forge-backend/shared/constants';

// module-level caches (shared singleton when imported from same path)
export const assetIdByHash = new Map<string, number>();      // hex -> id
export const pairIdByCanon = new Map<string, number>();      // "a_b" (a<=b) -> pair_id

const hex = (s: string) => s.toLowerCase();

export async function getOrCreateAssetIdByHash(
  pool: Pool,
  hashHex: string,
  meta: AssetMetaCache,
  opts?: { fallbackTicker?: string; fallbackDecimals?: number }
): Promise<{ id: number; ticker: string; decimals: number }> {
  const k = hex(hashHex);
  const cached = assetIdByHash.get(k);
  if (cached) {
    const { rows } = await pool.query(`SELECT ticker, decimals FROM assets WHERE id=$1`, [cached]);
    return { id: cached, ticker: rows[0]?.ticker ?? '', decimals: Number(rows[0]?.decimals ?? 0) };
  }

  // DB first
  let q = await pool.query(
    `SELECT id, ticker, decimals FROM assets WHERE hash=$1::bytea`,
    [Buffer.from(k, 'hex')]
  );

  if (!q.rows.length) {
    // chain/meta fallback
    const m = await meta.get(k);
    if (k === NATIVE_ASSET_HASH) {
      m.decimals = 8; // or your canonical native value
    }
    if (opts?.fallbackTicker && !m.ticker) m.ticker = opts.fallbackTicker;
    if (opts?.fallbackDecimals != null && (m.decimals == null || m.decimals === 0)) {
      m.decimals = opts.fallbackDecimals;
    }

    // Non-destructive upsert (no overwrite of ticker/decimals)
    q = await pool.query(
      `INSERT INTO assets (hash, ticker, decimals)
       VALUES ($1::bytea, $2, $3)
       ON CONFLICT (hash) DO UPDATE
         SET updated_at = now()
       RETURNING id, ticker, decimals`,
      [Buffer.from(k, 'hex'), m.ticker, m.decimals]
    );
  }

  const out = { id: Number(q.rows[0].id), ticker: q.rows[0].ticker, decimals: Number(q.rows[0].decimals) };
  assetIdByHash.set(k, out.id);
  return out;
}

export async function getOrCreatePairIdByHashes(
  pool: Pool,
  aHashHex: string,
  bHashHex: string,
  meta: AssetMetaCache,
  pairSymbol: (aTicker: string, bTicker: string) => string
): Promise<{ pairId: number; liveTail: string; aHex: string; bHex: string }> {
  let a = hex(aHashHex), b = hex(bHashHex);
  if (a > b) [a, b] = [b, a];
  const key = `${a}_${b}`;

  const hit = pairIdByCanon.get(key);
  if (hit) return { pairId: hit, liveTail: key, aHex: a, bHex: b };

  const [aDb, bDb] = await Promise.all([
    getOrCreateAssetIdByHash(pool, a, meta, { fallbackTicker: 'XEL', fallbackDecimals: 8 }),
    getOrCreateAssetIdByHash(pool, b, meta, { fallbackTicker: 'USD', fallbackDecimals: 2 }),
  ]);
  const symbol = pairSymbol(aDb.ticker, bDb.ticker);

  const ins = await pool.query(
    `INSERT INTO pairs (symbol, a_hash, b_hash)
     VALUES ($1, $2::bytea, $3::bytea)
     ON CONFLICT (a_hash, b_hash) DO UPDATE
       SET symbol = EXCLUDED.symbol, updated_at = now()
     RETURNING id`,
    [symbol, Buffer.from(a, 'hex'), Buffer.from(b, 'hex')]
  );
  const pairId = Number(ins.rows[0].id);

  await pool.query(
    `INSERT INTO pair_components (pair_id, base_asset_id, quote_asset_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (pair_id) DO UPDATE
       SET base_asset_id=$2, quote_asset_id=$3, updated_at=now()`,
    [pairId, aDb.id, bDb.id]
  );

  pairIdByCanon.set(key, pairId);
  return { pairId, liveTail: key, aHex: a, bHex: b };
}
