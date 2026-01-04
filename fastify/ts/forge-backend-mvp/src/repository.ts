import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SnapshotState, Asset, PoolData, LatestPrice, PairTVL } from './types';

export interface Repository {
  load(): Promise<void>;
  save(): Promise<void>;
  setAssets(assets: Asset[]): void;
  setPools(pools: PoolData[]): void;
  upsertLatestPrice(entry: LatestPrice): void;
  upsertPoolTvl(entry: PairTVL): void;
  getAssets(): Asset[];
  getPools(): PoolData[];
  getLatestPrice(asset: string): LatestPrice | undefined;
  getAllPrices(): LatestPrice[];
  getPoolTvl(poolKey: string): PairTVL | undefined;
  getAllTvls(): PairTVL[];
  setXelUsd(v: string | null): void;
  getXelUsd(): string | null;
}

export class MemoryRepo implements Repository {
  private file: string;
  private state: SnapshotState = {
    assets: {}, pools: {}, latestPrices: {}, poolTvls: {}, xelUsd: null, updatedAt: Date.now()
  };

  constructor(snapshotPath = './data/state.json') {
    this.file = path.resolve(snapshotPath);
  }

  async load() {
    try {
      const buf = await fs.readFile(this.file, 'utf8');
      this.state = JSON.parse(buf) as SnapshotState;
    } catch {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await this.save();
    }
  }

  async save() {
    this.state.updatedAt = Date.now();
    await fs.writeFile(this.file, JSON.stringify(this.state, null, 2));
  }

  setAssets(assets: Asset[]) { for (const a of assets) this.state.assets[a.hash] = a; }
  setPools(pools: PoolData[]) { for (const p of pools) this.state.pools[p.poolKey] = p; }
  upsertLatestPrice(e: LatestPrice) { this.state.latestPrices[e.asset] = e; }
  upsertPoolTvl(e: PairTVL) { this.state.poolTvls[e.poolKey] = e; }

  getAssets() { return Object.values(this.state.assets); }
  getPools() { return Object.values(this.state.pools); }
  getLatestPrice(asset: string) { return this.state.latestPrices[asset]; }
  getAllPrices() { return Object.values(this.state.latestPrices); }
  getPoolTvl(poolKey: string) { return this.state.poolTvls[poolKey]; }
  getAllTvls() { return Object.values(this.state.poolTvls); }

  setXelUsd(v: string | null) { this.state.xelUsd = v; }
  getXelUsd() { return this.state.xelUsd; }
}
