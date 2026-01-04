import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { usePools } from './PoolContext';
import { NATIVE_ASSET_HASH } from './NodeContext';
import Big from 'big.js';
import { formatCompactNumber } from '@/utils/number';

const XEL_PRICE_URL = 'https://api.coinpaprika.com/v1/tickers/xel-xelis?quotes=USD';

export interface PriceSourceMeta {
  method: 'direct' | 'hop';
  hops?: number;
  rawValues?: number[];
  filteredValues?: number[];
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
  // NEW: Granular price getter that doesn't cause re-renders
  getAssetPrice: (hash: string) => number | undefined;
}

const PriceContext = createContext<PriceContextType | undefined>(undefined);

export const PriceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activePools, poolAssets } = usePools();

  // Use refs to store the actual data - prevents unnecessary re-renders
  const assetPricesRef = useRef<Map<string, number>>(new Map());
  const priceSourcesRef = useRef<Map<string, PriceSourceMeta>>(new Map());
  const poolTVLsRef = useRef<Map<string, number>>(new Map());
  
  // Only use state for values that NEED to trigger re-renders
  const [xelPrice, setXelPrice] = useState<number | null>(null);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [enableHopPricing, setEnableHopPricing] = useState(false);
  const [updateTrigger, setUpdateTrigger] = useState(0); // Force update when needed

  // Stable getter that doesn't cause re-renders
  const getAssetPrice = useCallback((hash: string) => {
    return assetPricesRef.current.get(hash);
  }, []);

  const fetchXelPrice = useCallback(async () => {
    // try {
    //   const res = await fetch(XEL_PRICE_URL);
    //   const json = await res.json();
    //   setXelPrice(json.quotes?.USD?.price ?? null);
    // } catch (e) {
    //   console.error('Failed to fetch XEL price', e);
    //   setXelPrice(null);
    // }
  }, []);

  // Memoize the expensive price derivation
  const derivePricesFromPools = useMemo(() => {
    return () => {
      if (!xelPrice || activePools.size === 0) return;

      const graph = new Map<string, { peer: string; ratio: Big }[]>();
      const directPrices = new Map<string, Big>();
      const newPriceSources = new Map<string, PriceSourceMeta>();

      const decimalXelPrice = new Big(xelPrice);
      directPrices.set(NATIVE_ASSET_HASH, decimalXelPrice);
      newPriceSources.set(NATIVE_ASSET_HASH, {
        method: 'direct',
        finalPrice: decimalXelPrice.toNumber(),
      });

      // Build graph & collect direct prices
      for (const pool of activePools.values()) {
        const [a, b] = pool.hashes;
        const [lockedAStr, lockedBStr] = pool.locked;
        const assetA = poolAssets.get(a);
        const assetB = poolAssets.get(b);
        if (!assetA || !assetB) continue;

        const decA = new Big(lockedAStr);
        const decB = new Big(lockedBStr);

        const ratioAtoB = decA.div(decB);
        const ratioBtoA = decB.div(decA);

        if (!graph.has(a)) graph.set(a, []);
        if (!graph.has(b)) graph.set(b, []);
        graph.get(a)!.push({ peer: b, ratio: ratioAtoB });
        graph.get(b)!.push({ peer: a, ratio: ratioBtoA });

        if (a === NATIVE_ASSET_HASH && !directPrices.has(b)) {
          const price = decimalXelPrice.mul(ratioAtoB);
          directPrices.set(b, price);
          newPriceSources.set(b, {
            method: 'direct',
            finalPrice: price.toNumber(),
          });
        } else if (b === NATIVE_ASSET_HASH && !directPrices.has(a)) {
          const price = decimalXelPrice.mul(ratioBtoA);
          directPrices.set(a, price);
          newPriceSources.set(a, {
            method: 'direct',
            finalPrice: price.toNumber(),
          });
        }
      }

      if (!enableHopPricing) {
        const result = new Map<string, number>();
        for (const [k, v] of directPrices) result.set(k, v.toNumber());
        
        // Update refs instead of state
        assetPricesRef.current = result;
        priceSourcesRef.current = newPriceSources;
        setUpdateTrigger(prev => prev + 1); // Trigger re-render only when needed
        return;
      }

      // Step 2: BFS with Decimal math
      const prices = new Map(directPrices);
      const hopsMap = new Map<string, number>();
      const multiHopRawPrices = new Map<string, Big[]>();

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
      const filterOutliers = (values: Big[]): Big[] => {
        if (values.length <= 2) return values;

        const sorted = values.slice().sort((a, b) => a.cmp(b));
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
        const avg = filtered.reduce((acc, val) => acc.add(val), new Big(0)).div(filtered.length);
        prices.set(asset, avg);

        newPriceSources.set(asset, {
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
      
      // At the end:
      assetPricesRef.current = finalPrices;
      priceSourcesRef.current = newPriceSources;
      setUpdateTrigger(prev => prev + 1);
    };
  }, [xelPrice, enableHopPricing, activePools, poolAssets]);

  // Memoize TVL calculation
  const calculateTVLs = useMemo(() => {
    return () => {
      if (!assetPricesRef.current || activePools.size === 0) return;

      const tvlMap = new Map<string, number>();

      for (const [poolKey, pool] of activePools.entries()) {
        const [a, b] = pool.hashes;
        const assetA = poolAssets.get(a);
        const assetB = poolAssets.get(b);
        const priceA = assetPricesRef.current.get(a);
        const priceB = assetPricesRef.current.get(b);

        if (!assetA || !assetB || !priceA || !priceB) continue;

        const decA = new Big(pool.locked[0]);
        const decB = new Big(pool.locked[1]);
        const tvl = decA.mul(priceA).add(decB.mul(priceB)).toNumber();

        tvlMap.set(poolKey, tvl);
      }

      poolTVLsRef.current = tvlMap;
    };
  }, [activePools, poolAssets]);

  useEffect(() => {
    fetchXelPrice();
    const interval = setInterval(fetchXelPrice, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (xelPrice) {
      derivePricesFromPools();
    }
  }, [xelPrice, enableHopPricing, activePools, derivePricesFromPools]);

  useEffect(() => {
    calculateTVLs();
  }, [updateTrigger, calculateTVLs]);

  // Expose stable references that don't change
  const contextValue = useMemo(() => ({
    assetPrices: assetPricesRef.current,
    priceSources: priceSourcesRef.current,
    poolTVLs: poolTVLsRef.current,
    xelPrice,
    loadingPrices,
    enableHopPricing,
    setEnableHopPricing,
    getAssetPrice, // NEW: Use this in components that only need specific prices
  }), [xelPrice, loadingPrices, enableHopPricing, updateTrigger, getAssetPrice]);

  return (
    <PriceContext.Provider value={contextValue}>
      {children}
    </PriceContext.Provider>
  );
};

export const usePrices = () => {
  const context = useContext(PriceContext);
  if (!context) throw new Error('usePrices must be used within a PriceProvider');
  return context;
};

export const useAssetPrice = (hash: string) => {
  const { getAssetPrice } = usePrices();
  return getAssetPrice(hash);
};