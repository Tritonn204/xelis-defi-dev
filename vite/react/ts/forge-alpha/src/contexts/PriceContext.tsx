import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePools } from './PoolContext';
import { NATIVE_ASSET_HASH } from './NodeContext';
import Decimal from 'decimal.js';
import { formatCompactNumber } from '@/utils/number';

const XEL_PRICE_URL = 'https://api.coinpaprika.com/v1/tickers/xel-xelis?quotes=USD';

export interface PriceSourceMeta {
  method: 'direct' | 'hop';
  hops?: number;
  rawValues?: number[];     // for hop
  filteredValues?: number[];// for hop
  finalPrice: number;
}

interface PriceContextType {
  assetPrices: Map<string, number>;
  priceSources: Map<string, PriceSourceMeta>;
  poolTVLs: Map<string, number>;
  xelPrice: number | null;
  loadingPrices: boolean;
  enableHopPricing: boolean;
  setEnableHopPricing: (val: boolean) => void;
}

const PriceContext = createContext<PriceContextType | undefined>(undefined);

export const PriceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activePools, poolAssets } = usePools();

  const [assetPrices, setAssetPrices] = useState<Map<string, number>>(new Map());
  const [priceSources, setPriceSources] = useState<Map<string, PriceSourceMeta>>(new Map());
  const [poolTVLs, setPoolTVLs] = useState<Map<string, number>>(new Map());
  const [xelPrice, setXelPrice] = useState<number | null>(null);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [enableHopPricing, setEnableHopPricing] = useState(false);

  const fetchXelPrice = async () => {
    try {
      const res = await fetch(XEL_PRICE_URL);
      const json = await res.json();
      setXelPrice(json.quotes?.USD?.price ?? null);
    } catch (e) {
      console.error('Failed to fetch XEL price', e);
      setXelPrice(null);
    }
  };

  const derivePricesFromPools = () => {
    if (!xelPrice || activePools.size === 0) return;

    const graph = new Map<string, { peer: string; ratio: Decimal }[]>();
    const directPrices = new Map<string, Decimal>();
    const priceSources = new Map<string, PriceSourceMeta>();

    const decimalXelPrice = new Decimal(xelPrice);
    directPrices.set(NATIVE_ASSET_HASH, decimalXelPrice);
    priceSources.set(NATIVE_ASSET_HASH, {
      method: 'direct',
      finalPrice: decimalXelPrice.toNumber(),
    });

    // Step 1: Build graph & collect direct prices
    for (const pool of activePools.values()) {
      const [a, b] = pool.hashes;
      const [lockedAStr, lockedBStr] = pool.locked;
      const assetA = poolAssets.get(a);
      const assetB = poolAssets.get(b);
      if (!assetA || !assetB) continue;

      const decA = new Decimal(lockedAStr);
      const decB = new Decimal(lockedBStr);

      const ratioAtoB = decA.div(decB);
      const ratioBtoA = decB.div(decA);

      if (!graph.has(a)) graph.set(a, []);
      if (!graph.has(b)) graph.set(b, []);
      graph.get(a)!.push({ peer: b, ratio: ratioAtoB });
      graph.get(b)!.push({ peer: a, ratio: ratioBtoA });

      if (a === NATIVE_ASSET_HASH && !directPrices.has(b)) {
        const price = decimalXelPrice.mul(ratioAtoB);
        directPrices.set(b, price);
        priceSources.set(b, {
          method: 'direct',
          finalPrice: price.toNumber(),
        });
      } else if (b === NATIVE_ASSET_HASH && !directPrices.has(a)) {
        const price = decimalXelPrice.mul(ratioBtoA);
        directPrices.set(a, price);
        priceSources.set(a, {
          method: 'direct',
          finalPrice: price.toNumber(),
        });
      }
    }

    if (!enableHopPricing) {
      const result = new Map<string, number>();
      for (const [k, v] of directPrices) result.set(k, v.toNumber());
      setAssetPrices(result);
      setPriceSources(priceSources);
      return;
    }

    // Step 2: BFS with Decimal math
    const prices = new Map(directPrices);
    const hopsMap = new Map<string, number>();
    const multiHopRawPrices = new Map<string, Decimal[]>();

    const queue = [...prices.entries()].map(([asset, price]) => {
      hopsMap.set(asset, 0);
      return { asset, price, hops: 0 };
    });

    while (queue.length > 0) {
      const { asset, price, hops } = queue.shift()!;
      const neighbors = graph.get(asset) || [];

      for (const { peer, ratio } of neighbors) {
        if (prices.has(peer)) continue;

        const derivedPrice = price.mul(ratio);
        const prev = multiHopRawPrices.get(peer) || [];
        multiHopRawPrices.set(peer, [...prev, derivedPrice]);

        if (!hopsMap.has(peer)) {
          hopsMap.set(peer, hops + 1);
          queue.push({ asset: peer, price: derivedPrice, hops: hops + 1 });
        }
      }
    }

    // Step 3: Outlier filtering
    const filterOutliers = (values: Decimal[]): Decimal[] => {
      if (values.length <= 2) return values;

      const sorted = values.slice().sort((a, b) => a.comparedTo(b));
      const q1 = sorted[Math.floor(sorted.length / 4)];
      const q3 = sorted[Math.ceil(sorted.length * (3 / 4))];
      const iqr = q3.sub(q1);
      const lower = q1.sub(iqr.mul(1.5));
      const upper = q3.add(iqr.mul(1.5));

      const filtered = sorted.filter(v => v.gte(lower) && v.lte(upper));
      return filtered.length > 0 ? filtered : values; // fallback to original if all filtered
    };

    for (const [asset, values] of multiHopRawPrices.entries()) {
      const filtered = filterOutliers(values);
      const avg = filtered.reduce((acc, val) => acc.add(val), new Decimal(0)).div(filtered.length);
      prices.set(asset, avg);

      priceSources.set(asset, {
        method: 'hop',
        hops: hopsMap.get(asset),
        rawValues: values.map(v => v.toNumber()),
        filteredValues: filtered.map(v => v.toNumber()),
        finalPrice: avg.toNumber(),
      });
    }

    const finalPrices = new Map<string, number>();
    for (const [k, v] of prices.entries()) {
      finalPrices.set(k, v.toNumber());
    }

    setAssetPrices(finalPrices);
    setPriceSources(priceSources);
  };

  useEffect(() => {
    fetchXelPrice();
  }, []);

  useEffect(() => {
    if (xelPrice) {
      derivePricesFromPools();
    }
  }, [xelPrice, enableHopPricing, activePools]);

  useEffect(() => {
    if (!assetPrices || activePools.size === 0) return;

    console.log("new pool TVL data")

    const tvlMap = new Map<string, number>();
    const d10 = new Decimal(10);

    for (const [poolKey, pool] of activePools.entries()) {
      const [a, b] = pool.hashes;
      const assetA = poolAssets.get(a);
      const assetB = poolAssets.get(b);
      const priceA = assetPrices.get(a);
      const priceB = assetPrices.get(b);

      if (!assetA || !assetB || !priceA || !priceB) continue;

      const decA = new Decimal(pool.locked[0]);
      const decB = new Decimal(pool.locked[1]);
      const tvl = decA.mul(priceA).add(decB.mul(priceB)).toNumber();

      tvlMap.set(poolKey, tvl);
    }

    setPoolTVLs(new Map(tvlMap));
  }, [assetPrices, activePools, poolAssets]);

  return (
    <PriceContext.Provider value={{ 
      assetPrices, 
      priceSources, 
      poolTVLs,
      xelPrice, 
      loadingPrices, 
      enableHopPricing, 
      setEnableHopPricing 
    }}>
      {children}
    </PriceContext.Provider>
  );
};

export const usePrices = () => {
  const context = useContext(PriceContext);
  if (!context) throw new Error('usePrices must be used within a PriceProvider');
  return context;
};