import Decimal from 'decimal.js';
import { NATIVE_ASSET_HASH, Asset, PoolData, LatestPrice, PairTVL } from './types';

export function computeDirectPricesFromXEL(
  pools: PoolData[],
  assetIndex: Map<string, Asset>,
  xelUsd: Decimal
): LatestPrice[] {
  const out: LatestPrice[] = [];

  for (const p of pools) {
    const [a, b] = p.hashes;
    const decA = new Decimal(p.locked[0]);
    const decB = new Decimal(p.locked[1]);
    const ratioAtoB = decA.div(decB);
    const ratioBtoA = decB.div(decA);

    if (a === NATIVE_ASSET_HASH) {
      out.push({ asset: b, priceUsd: xelUsd.mul(ratioAtoB).toString(), source: 'direct', updatedAt: Date.now() });
    } else if (b === NATIVE_ASSET_HASH) {
      out.push({ asset: a, priceUsd: xelUsd.mul(ratioBtoA).toString(), source: 'direct', updatedAt: Date.now() });
    }
  }

  out.push({ asset: NATIVE_ASSET_HASH, priceUsd: xelUsd.toString(), source: 'direct', updatedAt: Date.now() });

  const uniq = new Map<string, LatestPrice>();
  for (const e of out) uniq.set(e.asset, e);
  return [...uniq.values()];
}

export function computePoolTvls(pools: PoolData[], priceMap: Map<string, Decimal>): PairTVL[] {
  const out: PairTVL[] = [];
  for (const p of pools) {
    const [a, b] = p.hashes;
    const pa = priceMap.get(a);
    const pb = priceMap.get(b);
    if (!pa || !pb) continue;
    const decA = new Decimal(p.locked[0]);
    const decB = new Decimal(p.locked[1]);
    out.push({ poolKey: p.poolKey, tvlUsd: decA.mul(pa).add(decB.mul(pb)).toString(), updatedAt: Date.now() });
  }
  return out;
}
