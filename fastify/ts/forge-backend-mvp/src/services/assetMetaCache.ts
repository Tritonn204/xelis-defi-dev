import Decimal from "decimal.js";
import type { XelisNodeAdapter } from "../adapters/xelisNodeAdapter";

export type AssetMeta = { ticker: string; decimals: number };
export type ReserveEnriched = {
  assetHash: string;
  amountU64: bigint;
  meta: AssetMeta;
  amount: number;         // JS number (careful with very large amounts)
  amountDecimal: Decimal; // precise
};

export class AssetMetaCache {
  private cache = new Map<string, AssetMeta>();
  private inflight = new Map<string, Promise<AssetMeta>>();

  constructor(private chain: XelisNodeAdapter, private max = 1000) {}

  private evictIfNeeded() {
    if (this.cache.size <= this.max) return;
    // naive FIFO eviction
    const firstKey = this.cache.keys().next().value;
    if (firstKey) this.cache.delete(firstKey);
  }

  async get(hash: string): Promise<AssetMeta> {
    const key = hash.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    let p = this.inflight.get(key);
    if (!p) {
      p = this.chain.getAsset({ asset: key }).then((a) => {
        const meta: AssetMeta = { ticker: a.ticker, decimals: a.decimals };
        this.cache.set(key, meta);
        this.evictIfNeeded();
        return meta;
      }).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  async enrich(reserves: { assetHash: string; amountU64: bigint }[]): Promise<ReserveEnriched[]> {
    return Promise.all(reserves.map(async (r) => {
      const meta = await this.get(r.assetHash);
      const amountDecimal = new Decimal(r.amountU64.toString()).div(new Decimal(10).pow(meta.decimals));
      const amount = Number(amountDecimal); // convenient for UI; use amountDecimal for precise math
      return { ...r, meta, amount, amountDecimal };
    }));
  }
}
