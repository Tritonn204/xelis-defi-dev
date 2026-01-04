import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Candle, Resolution, SeriesKey } from './types';
import { MINUTE } from '../constants';

const RES_TO_MIN: Record<Resolution, number> = {
  '1': 1, '5': 5, '15': 15, '60': 60, '240': 240, '1D': 1_440, '1W': 10_800, '1M': 524_160
};

function floorToBucket(tsMs: number, minutes: number): number {
  const sizeMs = minutes * MINUTE;
  return Math.floor(tsMs / sizeMs) * sizeMs;
}

function nextBucketAfter(tsMs: number, minutes: number): number {
  const b = floorToBucket(tsMs, minutes);
  return b + minutes * MINUTE;
}

export class CandleStore {
  /** base 1m bars kept in memory (ring) */
  private series: Map<string, Candle[]> = new Map();
  private maxBars1m: number;
  private dataDir: string;

  constructor(opts: { dataDir: string; maxBars1m?: number }){
    this.dataDir = opts.dataDir;
    this.maxBars1m = opts.maxBars1m ?? 10_000; // ~7 days
  }

  private key({symbol}: SeriesKey) { return `${symbol}::1m`; }

  async loadSeries(key: SeriesKey) {
    const fp = this.filePath(key);
    try {
      const raw = await fs.readFile(fp, 'utf8');
      const arr = JSON.parse(raw) as Candle[];
      this.series.set(this.key(key), arr.slice(-this.maxBars1m));
    } catch {
      await fs.mkdir(path.dirname(fp), { recursive: true });
      this.series.set(this.key(key), []);
      await this.flush(key);
    }
  }

  async flush(key: SeriesKey) {
    const fp = this.filePath(key);
    const arr = this.series.get(this.key(key)) ?? [];
    await fs.writeFile(fp, JSON.stringify(arr));
  }

  /** ingest a tick; updates current 1m candle (creates if needed) */
  ingestTick(key: SeriesKey, price: number, tsMs: number, volume = 0) {
    const k = this.key(key);
    const arr = this.series.get(k) ?? [];
    const bucket = floorToBucket(tsMs, 1);

    const last = arr[arr.length - 1];
    if (!last || last.t !== bucket) {
      // new candle
      arr.push({ t: bucket, o: price, h: price, l: price, c: price, v: volume });
      // ring buffer cap
      if (arr.length > this.maxBars1m) arr.splice(0, arr.length - this.maxBars1m);
    } else {
      // update candle
      last.c = price;
      if (price > last.h) last.h = price;
      if (price < last.l) last.l = price;
      last.v += volume;
    }
    this.series.set(k, arr);
  }

  /** ensure a flat bar if a minute passes with no ticks */
  carryForward(key: SeriesKey, nowMs: number) {
    const k = this.key(key);
    const arr = this.series.get(k) ?? [];
    const bucket = floorToBucket(nowMs, 1);
    const last = arr[arr.length - 1];
    if (!last) {
      // seed with nothing yet
      return;
    }
    if (last.t < bucket) {
      // clone close into a flat bar
      const c = last.c;
      arr.push({ t: bucket, o: c, h: c, l: c, c, v: 0 });
      if (arr.length > this.maxBars1m) arr.splice(0, arr.length - this.maxBars1m);
      this.series.set(k, arr);
    }
  }

  /** ensure flat 1m bars exist up to (and including) the bucket that contains toMs */
  carryForwardTo(key: SeriesKey, toMs: number) {
    const k = this.key(key);
    const arr = this.series.get(k) ?? [];
    if (!arr.length) return; // nothing to extend from

    // create bars from last.t + 1m until we reach the bucket that contains toMs
    let last = arr[arr.length - 1];
    const targetBucket = floorToBucket(toMs, 1);

    let nextT = last.t + MINUTE;
    while (nextT <= targetBucket) {
      const c = last.c; // clone close into a flat bar
      arr.push({ t: nextT, o: c, h: c, l: c, c, v: 0 });
      if (arr.length > this.maxBars1m) arr.splice(0, arr.length - this.maxBars1m);
      last = arr[arr.length - 1];
      nextT += MINUTE;
    }

    this.series.set(k, arr);
  }

  /** get base 1m range */
  get1m(key: SeriesKey, fromMs: number, toMs: number): Candle[] {
    const arr = this.series.get(this.key(key)) ?? [];
    if (!arr.length) return [];
    const firstIdx = arr.findIndex(c => c.t >= fromMs);
    if (firstIdx === -1) return [];
    const out: Candle[] = [];
    for (let i = firstIdx; i < arr.length; i++) {
      const c = arr[i];
      if (c.t > toMs) break;
      out.push(c);
    }
    return out;
  }

  /** aggregate 1m into a higher resolution on the fly */
  get(key: SeriesKey, res: Resolution, fromMs: number, toMs: number): Candle[] {
    if (res === '1') return this.get1m(key, fromMs, toMs);
    const base = this.get1m(key, fromMs - (RES_TO_MIN[res]-1)*MINUTE, toMs);
    if (!base.length) return [];
    const sizeMin = RES_TO_MIN[res];

    const acc: Candle[] = [];
    let curBucket = -1;
    let cur: Candle | null = null;

    for (const b of base) {
      const bucket = floorToBucket(b.t, sizeMin);
      if (bucket !== curBucket) {
        if (cur) acc.push(cur);
        curBucket = bucket;
        cur = { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      } else {
        // merge
        if (!cur) continue;
        if (b.h > cur.h) cur.h = b.h;
        if (b.l < cur.l) cur.l = b.l;
        cur.c = b.c;
        cur.v += b.v;
      }
    }
    if (cur) acc.push(cur);
    // trim to window
    return acc.filter(c => c.t >= fromMs && c.t <= toMs);
  }

  /** latest close for tiles/sparklines */
  lastClose(key: SeriesKey): number | null {
    const arr = this.series.get(this.key(key)) ?? [];
    return arr.length ? arr[arr.length - 1].c : null;
  }

  private filePath(key: SeriesKey) {
    const fname = `candles-${key.symbol}-1m.json`;
    return path.join(this.dataDir, fname);
  }
}
