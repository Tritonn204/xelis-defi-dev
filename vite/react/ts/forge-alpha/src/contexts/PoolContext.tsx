import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useNode, NATIVE_ASSET_HASH, NodeConfig } from '@/contexts/NodeContext';
import { useWallet } from '@/contexts/WalletContext';
import { Asset } from '@/contexts/AssetContext';
import Big from 'big.js'
import { VMParam } from '@/utils/xvmSerializer';
import { genericTransformer } from '@/utils/types';
import { getForgeMetaForAssets } from '@/utils/getForgeMeta';
import { parseValue } from '@/utils/data';

export interface PoolData {
  name: string
  lpAsset: string,
  tickers: [string, string]
  names: [string, string]
  hashes: [string, string]
  locked: [string, string]
  userShare: string | undefined
  totalLpSupply: BigInt
  userPool: boolean,
  userTracked: boolean
}

const XEL_PRICE_URL = 'https://api.coinpaprika.com/v1/tickers/xel-xelis?quotes=USD,EUR,BTC'

interface PoolContextType {
  activePools: Map<string, PoolData>;
  poolAssets: Map<string, Asset>;
  setActivePools: React.Dispatch<React.SetStateAction<Map<string, PoolData>>>;
  loadingPools: boolean;
  poolsError: string | null;
  refreshPools: () => void;
  routerContract?: string;
}

export type NetId = 'mainnet' | 'testnet' | 'stagenet' | 'custom';

const ENV_CONTRACTS: Partial<Record<NetId, { router?: string; factory?: string }>> = {
  mainnet: { router: import.meta.env.VITE_ROUTER_MAINNET, factory: import.meta.env.VITE_FACTORY_MAINNET },
  testnet: { router: import.meta.env.VITE_ROUTER_TESTNET, factory: import.meta.env.VITE_FACTORY_TESTNET },
};

const isNonEmpty = (s?: string) => typeof s === 'string' && s.trim() !== '';

function pickContracts(
  currentNetwork: NetId,
  currentNode: NodeConfig | null,
  customNetworks: Map<string, { name: string; contractAddresses?: { router?: string; factory?: string } }> | undefined
) {
  // 1) customNetworks (highest priority)
  if (currentNetwork === 'custom' && currentNode?.name && customNetworks) {
    const net = Array.from(customNetworks.values()).find(n => n.name === currentNode.name);
    if (net?.contractAddresses) {
      return {
        router: isNonEmpty(net.contractAddresses.router) ? net.contractAddresses.router : undefined,
        factory: isNonEmpty(net.contractAddresses.factory) ? net.contractAddresses.factory : undefined,
      };
    }
    return { router: undefined, factory: undefined };
  }
  // 2) currentNode.contractAddresses (fetched from API by NodeContext)
  if (currentNode?.contractAddresses) {
    return {
      router: isNonEmpty(currentNode.contractAddresses.router) ? currentNode.contractAddresses.router : undefined,
      factory: isNonEmpty(currentNode.contractAddresses.factory) ? currentNode.contractAddresses.factory : undefined,
    };
  }
  // 3) env overrides (final fallback)
  const env = ENV_CONTRACTS[currentNetwork] ?? {};
  return {
    router: isNonEmpty(env.router) ? env.router : undefined,
    factory: isNonEmpty(env.factory) ? env.factory : undefined,
  };
}

const PoolContext = createContext<PoolContextType | undefined>(undefined);

function formatUnits(raw: bigint | string, decimals: number): string {
  const s = raw.toString();

  if (decimals === 0) return s;

  const negative = s.startsWith("-");
  const digits = negative ? s.slice(1) : s;

  if (digits.length <= decimals) {
    const padded = digits.padStart(decimals + 1, "0");
    const i = padded.length - decimals;
    return `${negative ? "-" : ""}${padded.slice(0, i)}.${padded.slice(i)}`;
  }

  const i = digits.length - decimals;
  return `${negative ? "-" : ""}${digits.slice(0, i)}.${digits.slice(i)}`;
}

// Canonicalize pair order matching smart contract logic (compare hashes as u256)
export function canonicalPoolKey(hashA: string, hashB: string): string {
  const a = hashA.toLowerCase().replace(/^0x/, '');
  const b = hashB.toLowerCase().replace(/^0x/, '');

  const maxLen = Math.max(a.length, b.length);
  const aPadded = a.padStart(maxLen, '0');
  const bPadded = b.padStart(maxLen, '0');

  return aPadded > bPadded ? `${hashA}_${hashB}` : `${hashB}_${hashA}`;
}

export const PoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [poolAssets, setPoolAssets] = useState<Map<string, Asset>>(new Map());
  const [activePools, setActivePools] = useState<Map<string, PoolData>>(new Map());
  const [loadingPools, setLoadingPools] = useState(false);
  const [poolsError, setPoolsError] = useState<string | null>(null);

  const {
    currentNetwork,
    currentNode,
    customNetworks,
    getContractData,
    getContractAssets,
    getAsset,
    getAssetSupply,
  } = useNode();

  const {
    isConnected,
    getRawBalance,
    ownedAssets,
  } = useWallet();

  const resolved = useMemo(() => {
    return pickContracts(currentNetwork as NetId, currentNode, customNetworks);
  }, [currentNetwork, currentNode, customNetworks]);

  // ✅ Keep the same public getters, but source from `resolved`
  const getRouterContract = useCallback(() => resolved.router, [resolved]);
  const getFactoryContract = useCallback(() => resolved.factory, [resolved]);

  const routerContract = getRouterContract();
  const factoryContract = getFactoryContract();

  type AsyncFn<T> = () => Promise<T>;

  function createLimiter(concurrency: number) {
    let active = 0;
    const queue: Array<() => void> = [];

    const runNext = () => {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    };

    return async function limit<T>(fn: AsyncFn<T>): Promise<T> {
      if (active >= concurrency) {
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      active += 1;
      try {
        return await fn();
      } finally {
        runNext();
      }
    };
  }

  const ZERO_HASH = "0".repeat(64);

  const toU256 = (hash: string): bigint => BigInt("0x" + hash.replace(/^0x/, ""));
  const firstSecondForPair = (a: string, b: string): { first: string; second: string } => {
    // contract: (first, second) = a > b ? (a,b) : (b,a)
    return toU256(a) > toU256(b) ? { first: a, second: b } : { first: b, second: a };
  };

  const pairsKey = (assetHash: string) => VMParam.string(`pairs_${assetHash}`);

  const unwrapVm = (node: any): any => {
    let cur = node;
    while (
      cur &&
      typeof cur === "object" &&
      "type" in cur &&
      "value" in cur &&
      (cur.type === "default" || cur.type === "opaque" || cur.type === "primitive")
    ) {
      cur = cur.value;
    }
    return cur;
  };

  const extractReserves = (lpData: any): Record<string, bigint> | null => {
    if (!lpData) return null;
    const unwrapped = unwrapVm(lpData);

    if (unwrapped?.type === "object" && Array.isArray(unwrapped.value) && unwrapped.value.length >= 2) {
      const reservesNodeRaw = unwrapped.value[1];
      const reservesNode = unwrapVm(reservesNodeRaw);

      // Case A: reserves node is a VM map with value already decoded as a plain object
      // (This matches your earlier "mapTypes" response format.)
      if (reservesNode?.type === "map" && reservesNode.value && !Array.isArray(reservesNode.value)) {
        return reservesNode.value as Record<string, bigint>;
      }

      // Case B: reserves node is a VM map with value as iterable entries (older format)
      // If you ever see this, you can parse it safely.
      if (reservesNode?.type === "map" && Array.isArray(reservesNode.value)) {
        const out: Record<string, bigint> = {};
        for (const entry of reservesNode.value) {
          if (!Array.isArray(entry) || entry.length !== 2) continue;
          const k = unwrapVm(entry[0]);
          const v = unwrapVm(entry[1]);
          out[String(k?.value ?? k)] = typeof v === "bigint" ? v : BigInt(v?.value ?? v);
        }
        return out;
      }

      if (reservesNode && typeof reservesNode === "object" && !Array.isArray(reservesNode)) {
        return reservesNode as Record<string, bigint>;
      }

      return null;
    }

    if (unwrapped?.reserves && typeof unwrapped.reserves === "object" && !Array.isArray(unwrapped.reserves)) {
      return unwrapped.reserves as Record<string, bigint>;
    }

    return null;
  };

  const isNative = (h: string) => h === NATIVE_ASSET_HASH;
  const normalizeHash = (h: string) =>
    h.replace(/^0x/, "").toLowerCase().padStart(64, "0");

  const getDisplayOrder = (a: string, b: string): { base: string; quote: string } => {
    const A = normalizeHash(a);
    const B = normalizeHash(b);

    if (isNative(A) && !isNative(B)) return { base: B, quote: A };
    if (isNative(B) && !isNative(A)) return { base: A, quote: B };

    const minMaxKey = canonicalPoolKey(A, B).split("_"); // returns min_max
    const base = minMaxKey[0];
    const quote = minMaxKey[1];
    return { base, quote };
  };

  const loadPools = async () => {
    if (!routerContract) {
      setActivePools(new Map());
      return;
    }

    setLoadingPools(true);
    setPoolsError(null);

    const DEBUG = false;
    const dbg = (...args: any[]) => DEBUG && console.log("[loadPools]", ...args);
    const warn = (...args: any[]) => DEBUG && console.warn("[loadPools]", ...args);

    try {
      const assetMetaMap = new Map<string, Asset>();
      const assetList = await getContractAssets(routerContract);

      dbg("assetList size =", assetList.length);

      const limit = createLimiter(16);

      // Phase 1: fetch pairs_<id> in parallel
      const pairsResults = await Promise.all(
        assetList.map((id) =>
          limit(async () => {
            try {
              const resp = await getContractData({ contract: routerContract, key: pairsKey(id) });

              const pairsMap: Record<string, string> | null =
                resp?.data?.type === "map" && resp.data.value && typeof resp.data.value === "object"
                  ? (resp.data.value as Record<string, string>)
                  : resp?.data && typeof resp.data === "object" && !Array.isArray(resp.data)
                    ? (resp.data as Record<string, string>)
                    : null;

              const count = pairsMap ? Object.keys(pairsMap).length : 0;
              if (count > 0) dbg("pairs_", id.slice(0, 6), "entries =", count);

              return { id, pairsMap };
            } catch (e: any) {
              warn("pairs_ fetch failed for", id.slice(0, 6), e?.message ?? e);
              return { id, pairsMap: null as Record<string, string> | null };
            }
          })
        )
      );

      // Phase 2: build canonical pair entries (dedupe)
      type PairEntry = {
        tokenA: string; // smaller
        tokenB: string; // larger
        first: string;
        second: string;
        lpHash: string;
        from: string; // which id map produced it (debug)
      };

      const seen = new Set<string>();
      const pairEntries: PairEntry[] = [];

      let totalPairsMapEntries = 0;
      let skippedNotFirst = 0;
      let skippedKeyMismatch = 0;

      for (const { id, pairsMap } of pairsResults) {
        if (!pairsMap) continue;

        const seconds = Object.keys(pairsMap);
        totalPairsMapEntries += seconds.length;

        for (const second of seconds) {
          const lpHash = pairsMap[second];
          if (!lpHash) continue;

          const { first, second: computedSecond } = firstSecondForPair(id, second);

          if (computedSecond !== second) {
            skippedKeyMismatch += 1;
            warn("key mismatch: map under", id.slice(0, 6), "has second=", second.slice(0, 6), "but computedSecond=", computedSecond.slice(0, 6));
            continue;
          }

          if (id !== first) {
            skippedNotFirst += 1;
            continue;
          }

          const tokenA = computedSecond;
          const tokenB = first;
          const poolKey = `${tokenA}_${tokenB}`;

          if (seen.has(poolKey)) continue;
          seen.add(poolKey);

          pairEntries.push({ tokenA, tokenB, first, second: computedSecond, lpHash, from: id });
        }
      }

      dbg("pairs_ total entries seen =", totalPairsMapEntries);
      dbg("pairEntries unique pools =", pairEntries.length);
      dbg("skippedNotFirst =", skippedNotFirst, "skippedKeyMismatch =", skippedKeyMismatch);

      if (pairEntries.length === 0) {
        warn("No pairEntries built. Sample a non-empty pairs_ map and check u256 rule / which ids you query.");
        setPoolAssets(new Map(assetMetaMap));
        setActivePools(new Map());
        return;
      }

      // Phase 3: prefetch token metadata + forge meta
      const tokenSet = new Set<string>();
      for (const p of pairEntries) {
        tokenSet.add(p.tokenA);
        tokenSet.add(p.tokenB);
      }

      dbg("unique tokens in pools =", tokenSet.size);

      const assetInfoCache = new Map<string, Awaited<ReturnType<typeof getAsset>>>();
      await Promise.all(
        Array.from(tokenSet).map((hash) =>
          limit(async () => {
            try {
              const info = await getAsset({ asset: hash });
              assetInfoCache.set(hash, info);
            } catch (e: any) {
              warn("getAsset failed for", hash.slice(0, 6), e?.message ?? e);
            }
          })
        )
      );

      const forgeMetaMap = factoryContract
        ? await getForgeMetaForAssets(factoryContract, Array.from(tokenSet), getContractData)
        : {};

      // Phase 4: load LPAsset structs + supplies, build pools
      const pools = new Map<string, PoolData>();

      let lpLoadsOk = 0;
      let lpLoadsFail = 0;
      let reservesMissing = 0;
      let reservesTokenMissing = 0;

      const built = await Promise.all(
        pairEntries.map((entry) =>
          limit(async () => {
            const { tokenA, tokenB, lpHash, from } = entry;

            let lpResp: any;
            try {
              lpResp = await getContractData({
                contract: routerContract,
                key: VMParam.hash(lpHash),
              });
              lpLoadsOk += 1;
            } catch (e: any) {
              lpLoadsFail += 1;
              warn("LP load failed", { lpHash: lpHash.slice(0, 6), from: from.slice(0, 6), err: e?.message ?? e });
              return null;
            }

            const lpData = lpResp?.data;
            const reserves = extractReserves(lpData);
            if (!reserves) {
              reservesMissing += 1;
              warn("No reserves extracted for lp", lpHash.slice(0, 6), "lpData keys:", lpData ? Object.keys(lpData) : null, "raw:", lpData);
              return null;
            }

            const rawA = reserves[tokenA];
            const rawB = reserves[tokenB];
            if (rawA === undefined || rawB === undefined) {
              reservesTokenMissing += 1;
              warn("Reserves missing token key(s)", {
                lp: lpHash.slice(0, 6),
                tokenA: tokenA.slice(0, 6),
                tokenB: tokenB.slice(0, 6),
                reserveKeys: Object.keys(reserves).map((k) => k.slice(0, 6)),
              });
              return null;
            }

            const dataA = assetInfoCache.get(tokenA);
            const dataB = assetInfoCache.get(tokenB);
            if (!dataA || !dataB) {
              warn("Missing asset meta", { tokenA: tokenA.slice(0, 6), tokenB: tokenB.slice(0, 6) });
              return null;
            }

            // register assets for UI
            const forgeDataA = forgeMetaMap[tokenA];
            const forgeDataB = forgeMetaMap[tokenB];

            assetMetaMap.set(tokenA, {
              hash: tokenA,
              ticker: dataA.ticker,
              name: dataA.name,
              balance: "0",
              price: 0,
              isForge: !!forgeDataA,
              mintable: false,
              logo: forgeDataA?.[4]?.value,
              decimals: dataA.decimals,
            });

            assetMetaMap.set(tokenB, {
              hash: tokenB,
              ticker: dataB.ticker,
              name: dataB.name,
              balance: "0",
              price: 0,
              isForge: !!forgeDataB,
              mintable: false,
              logo: forgeDataB?.[4]?.value,
              decimals: dataB.decimals,
            });

            const totalA = BigInt(rawA) / BigInt(10 ** dataA.decimals);
            const totalB = BigInt(rawB) / BigInt(10 ** dataB.decimals);

            let lpTotal: bigint = 0n;
            try {
              lpTotal = (await getAssetSupply({ asset: lpHash })).data;
            } catch (e: any) {
              warn("getAssetSupply failed for lp", lpHash.slice(0, 6), e?.message ?? e);
            }

            let userShare: string | undefined;
            let userLp: bigint | undefined;

            if (isConnected && lpTotal > 0n) {
              try {
                userLp = BigInt(await getRawBalance(lpHash));
                userShare = new Big(userLp.toString())
                  .div(lpTotal.toString())
                  .mul(100)
                  .toFixed(3)
                  .toString();
              } catch (e: any) {
                warn("getRawBalance failed for lp", lpHash.slice(0, 6), e?.message ?? e);
              }
            }

            const poolKey = canonicalPoolKey(tokenA, tokenB);

const { base, quote } = getDisplayOrder(tokenA, tokenB);

// Pull metadata based on display order
const dataBase = assetInfoCache.get(base);
const dataQuote = assetInfoCache.get(quote);
if (!dataBase || !dataQuote) {
  warn("Missing asset meta (display order)", { base: base.slice(0, 6), quote: quote.slice(0, 6) });
  return null;
}

// Reserves must align with chosen order
const rawBase = reserves[base];
const rawQuote = reserves[quote];
if (rawBase === undefined || rawQuote === undefined) {
  reservesTokenMissing += 1;
  warn("Reserves missing token key(s) after display order", {
    lp: lpHash.slice(0, 6),
    base: base.slice(0, 6),
    quote: quote.slice(0, 6),
    reserveKeys: Object.keys(reserves).map((k) => k.slice(0, 6)),
  });
  return null;
}

// Register assets for UI
const forgeBase = forgeMetaMap[base];
const forgeQuote = forgeMetaMap[quote];

assetMetaMap.set(base, {
  hash: base,
  ticker: dataBase.ticker,
  name: dataBase.name,
  balance: "0",
  price: 0,
  isForge: !!forgeBase,
  mintable: false,
  logo: forgeBase?.[4]?.value,
  decimals: dataBase.decimals,
});

assetMetaMap.set(quote, {
  hash: quote,
  ticker: dataQuote.ticker,
  name: dataQuote.name,
  balance: "0",
  price: 0,
  isForge: !!forgeQuote,
  mintable: false,
  logo: forgeQuote?.[4]?.value,
  decimals: dataQuote.decimals,
});

const totalBase = formatUnits(rawBase, dataBase.decimals);
const totalQuote = formatUnits(rawQuote, dataQuote.decimals);

const poolData: PoolData = {
  name: `${dataBase.ticker} - ${dataQuote.ticker}`, // native will be second
  lpAsset: lpHash,
  tickers: [dataBase.ticker, dataQuote.ticker],
  names: [dataBase.name, dataQuote.name],
  hashes: [base, quote],
  locked: [totalBase.toString(), totalQuote.toString()],
  userShare,
  userPool: !!ownedAssets?.get(lpHash),
  userTracked: !!userLp,
  totalLpSupply: lpTotal,
};

return { poolKey, poolData };
          })
        )
      );

      for (const item of built) {
        if (!item) continue;
        pools.set(item.poolKey, item.poolData);
      }

      dbg("LP loads ok/fail =", lpLoadsOk, "/", lpLoadsFail);
      dbg("reservesMissing =", reservesMissing, "reservesTokenMissing =", reservesTokenMissing);
      dbg("final pools count =", pools.size);

      setPoolAssets(new Map(assetMetaMap));
      setActivePools(new Map(pools));
    } catch (error: any) {
      console.error("Error loading pools:", error.message || error);
      setPoolsError(error.message || "Failed to load pools");
    } finally {
      setLoadingPools(false);
    }
  };

  // Clear pools/assets immediately when network or node URL changes to prevent stale data
  const currentNodeUrl = currentNode?.url;
  useEffect(() => {
    setActivePools(new Map());
    setPoolAssets(new Map());
    setPoolsError(null);
  }, [currentNetwork, currentNodeUrl]);

  // Load pools when router contract is available or connection status changes
  useEffect(() => {
    loadPools();
  }, [routerContract, isConnected, currentNetwork, currentNode, ownedAssets]);

  const refreshPools = () => {
    loadPools();
  };

  return (
    <PoolContext.Provider value={{
      activePools,
      setActivePools,
      loadingPools,
      poolsError,
      refreshPools,
      routerContract,
      poolAssets
    }}>
      {children}
    </PoolContext.Provider>
  );
};

export const usePools = () => {
  const context = useContext(PoolContext);
  if (!context) {
    throw new Error('usePools must be used within a PoolProvider');
  }
  return context;
};