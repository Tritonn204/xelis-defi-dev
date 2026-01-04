export type Resolution = '1'|'5'|'15'|'60'|'240'|'1D'|'1W'|'1M';

export interface Candle {
  t: number; // ms, start of bucket
  o: number; h: number; l: number; c: number; v: number;
}

export interface SeriesKey { symbol: string; } // always 1m base

export interface CandleStorage {
  ingestTick(key: SeriesKey, price: number, tsMs: number, volume?: number): Promise<void>;
  carryForwardTo(key: SeriesKey, toMs: number): Promise<void>;  // finalize all missing minutes up to toMs
  getSmart(key: { symbol: string }, res: Resolution, fromMs: number, toMs: number): Promise<Candle[]>;
  get(key: SeriesKey, res: Resolution, fromMs: number, toMs: number): Promise<Candle[]>;
  lastClose(key: SeriesKey): Promise<number|null>;
}
