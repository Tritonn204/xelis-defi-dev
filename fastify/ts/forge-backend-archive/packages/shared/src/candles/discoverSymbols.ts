// src/candles/discoverSymbols.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { VMParam } from '../utils/xvmSerializer';

// Minimal adapter surface we need
export interface ChainLike {
  getRouterContract(): Promise<string | undefined>;
  getContractAssets(router: string): Promise<string[]>;
  getContractData(params: { contract: string; key: any }): Promise<any>;
  getAsset(params: { asset: string }): Promise<{ name: string; ticker: string; decimals: number }>;
}

// Normalize symbol as BASE_QUOTE (uppercased, underscore)
export const pairSymbol = (base: string, quote: string) =>
  `${base.toUpperCase()}_${quote.toUpperCase()}`;

// ------------- disk -------------
export async function getSymbolsFromDisk(baseDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name.toUpperCase());
  } catch {
    return [];
  }
}

// ------------- chain -------------
export async function getSymbolsFromChain(baseDir: string, chain: ChainLike): Promise<string[]> {
  try {
    const router = await chain.getRouterContract();
    if (!router) return [];
    const lpAssets = await chain.getContractAssets(router);

    const symbols: string[] = [];
    for (const lp of lpAssets) {
      try {
        const data = await chain.getContractData({ contract: router, key: VMParam.hash(lp) });
        // expect { data: { type:'object', value:[_, {type:'map', value: {tokenA: amountA, tokenB: amountB}}]}}
        const isMap = data?.data?.type === 'object' && data?.data?.value?.[1]?.type === 'map';
        if (!isMap) continue;
        const lpMap = data.data.value[1].value as Record<string, unknown>;
        const hashes = Object.keys(lpMap);
        if (hashes.length !== 2) continue;
        const [a, b] = hashes;

        const ai = await chain.getAsset({ asset: a });
        const bi = await chain.getAsset({ asset: b });

        // You likely chart the direct vs XEL pair most often; but we just emit both directions.
        symbols.push(pairSymbol(ai.ticker, bi.ticker));
        symbols.push(pairSymbol(bi.ticker, ai.ticker));
      } catch {
        // skip bad LP entries
      }
    }
    // Include XEL_USD if your sampler writes it
    symbols.push('XEL_USD');
    return Array.from(new Set(symbols));
  } catch {
    return [];
  }
}

// ------------- merge -------------
export async function getAllSymbols(baseDir: string, chain: ChainLike): Promise<string[]> {
  const [fromDisk, fromChain] = await Promise.all([
    getSymbolsFromDisk(baseDir),
    getSymbolsFromChain(baseDir, chain),
  ]);
  return Array.from(new Set([...fromDisk, ...fromChain]));
}
