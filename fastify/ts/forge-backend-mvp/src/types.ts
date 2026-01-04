export type Hash = string;

export interface Bar { t:number; o:number; h:number; l:number; c:number; v:number };

export const NATIVE_ASSET_HASH: Hash =
  process.env.NATIVE_ASSET_HASH || '<XEL_HASH>';

export interface Asset {
  ticker: string
  name: string
  hash: string
  decimals: number
}

export interface PoolData {
  poolKey: string;             // `${tokenA}_${tokenB}`
  lpAsset: Hash;
  hashes: [Hash, Hash];
  tickers: [string, string];
  locked: [string, string];    // decimal-adjusted strings
  totalLpSupply: string;       // string for safety
}

export interface LatestPrice {
  asset: Hash;
  priceUsd: string;
  source: 'direct';
  updatedAt: number;           // ms
}

export interface PairTVL {
  poolKey: string;
  tvlUsd: string;
  updatedAt: number;
}

export interface SnapshotState {
  assets: Record<Hash, Asset>;
  pools: Record<string, PoolData>;
  latestPrices: Record<Hash, LatestPrice>;
  poolTvls: Record<string, PairTVL>;
  xelUsd: string | null;
  updatedAt: number;
}

export type LpReserve = { assetHash: string; amountU64: bigint };