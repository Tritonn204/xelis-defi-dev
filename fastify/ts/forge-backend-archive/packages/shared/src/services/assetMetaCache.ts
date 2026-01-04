import Decimal from "decimal.js";
import type { XelisNodeAdapter } from "../adapters/xelisNodeAdapter";
import type { Pool } from "pg";
import type { AssetDataWithTicker } from "../utils/types";
import { NATIVE_ASSET_HASH } from "../constants";

export type AssetMeta = { ticker: string; decimals: number };

export class AssetMetaCache {
  private cache = new Map<string, { id: number; ticker: string; decimals: number }>();
  private inflight = new Map<string, Promise<{ id: number; ticker: string; decimals: number }>>();

  constructor(private pool: Pool, private chain: XelisNodeAdapter, private max = 1000) {}

  private norm(h: string) { return h.toLowerCase(); }
  private evict() { if (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!); }

  private async dbGet(hex: string) {
    const { rows } = await this.pool.query(
      `SELECT id, ticker, decimals FROM assets WHERE hash=$1::bytea`,
      [Buffer.from(hex, 'hex')]
    );
    return rows[0] ? { id: +rows[0].id, ticker: rows[0].ticker, decimals: +rows[0].decimals } : null;
  }
  private async dbUpsert(hex: string, ticker: string, decimals: number) {
    const { rows } = await this.pool.query(
      `INSERT INTO assets (hash, ticker, decimals)
       VALUES ($1::bytea, $2, $3)
       ON CONFLICT (hash) DO UPDATE
         SET ticker=EXCLUDED.ticker, decimals=EXCLUDED.decimals, updated_at=now()
       RETURNING id, ticker, decimals`,
      [Buffer.from(hex, 'hex'), ticker, decimals]
    );
    return { id: +rows[0].id, ticker: rows[0].ticker, decimals: +rows[0].decimals };
  }

  async get(hash: string): Promise<{ ticker: string; decimals: number }> {
    const key = this.norm(hash);
    const hit = this.cache.get(key);
    if (hit) return { ticker: hit.ticker, decimals: hit.decimals };

    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        const fromDb = await this.dbGet(key);
        if (fromDb) { this.cache.set(key, fromDb); this.evict(); return fromDb; }
        const a = await this.chain.getAsset({ asset: key }) as AssetDataWithTicker;
        const up = await this.dbUpsert(key, a.ticker, a.decimals);
        this.cache.set(key, up); this.evict(); return up;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    const v = await p;
    return { ticker: v.ticker, decimals: v.decimals }; // same shape as before
  }

  // Optional: expose id without breaking old callers
  async getWithId(hash: string): Promise<{ id: number; ticker: string; decimals: number }> {
    const key = this.norm(hash);
    const meta = this.cache.get(key) || await (async () => {
      const db = await this.dbGet(key);
      if (db) return db;
      const a = await this.chain.getAsset({ asset: key }) as AssetDataWithTicker;
      return await this.dbUpsert(key, a.ticker, a.decimals);
    })();
    this.cache.set(key, meta); this.evict();
    return meta;
  }

  async enrich(reserves: { assetHash: string; amountU64: bigint }[]) {
    return Promise.all(reserves.map(async (r) => {
      const m = await this.get(r.assetHash);
      const amountDecimal = new Decimal(r.amountU64.toString()).div(new Decimal(10).pow(m.decimals));
      return { ...r, meta: m, amount: Number(amountDecimal), amountDecimal };
    }));
  }
}