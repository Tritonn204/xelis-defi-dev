import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Candle, CandleStorage, Resolution, SeriesKey } from './types';
import { MINUTE } from '../constants';

// Minute sizes for minute/hour tiers:
const MIN_RES_MINUTES: Record<'1'|'5'|'15'|'60'|'240', number> = {
  '1': 1, '5': 5, '15': 15, '60': 60, '240': 240
};

const ALL_RES: Resolution[] = ['1','5','15','60','240','1D','1W','1M'];

const ymd = (ts: number) => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
};
const ym = (ts: number) => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
};
const startOfDayUTC = (ts: number) => {
  const d = new Date(ts);
  d.setUTCHours(0,0,0,0);
  return d.getTime();
};
const startOfWeekUTC_Mon = (ts: number) => {
  // Monday 00:00 UTC of the week containing ts
  const d = new Date(ts);
  d.setUTCHours(0,0,0,0);
  const dow = d.getUTCDay(); // Sun=0 … Sat=6
  const delta = (dow === 0 ? -6 : 1 - dow); // shift to Monday
  d.setUTCDate(d.getUTCDate() + delta);
  return d.getTime();
};
const startOfMonthUTC = (ts: number) => {
  const d = new Date(ts);
  d.setUTCDate(1);
  d.setUTCHours(0,0,0,0);
  return d.getTime();
};
const floorMinuteBucket = (ts: number, minutes: number) =>
  Math.floor(ts / (minutes * MINUTE)) * (minutes * MINUTE);

function bucketStart(res: Resolution, ts: number): number {
  if (res in MIN_RES_MINUTES) {
    return floorMinuteBucket(ts, MIN_RES_MINUTES[res as keyof typeof MIN_RES_MINUTES]);
  }
  if (res === '1D') return startOfDayUTC(ts);
  if (res === '1W') return startOfWeekUTC_Mon(ts);
  return startOfMonthUTC(ts); // '1M'
}

type OpenBar = { t: number; o: number; h: number; l: number; c: number; v: number };

export class DiskCandleStore implements CandleStorage {
  /** per-series working state (constant RAM) for 1m only */
  private open: Map<string, OpenBar> = new Map();             // current 1m bar (not yet on disk)
  private lastWritten: Map<string, number> = new Map();        // last 1m bucket written

  constructor(private dir: string) {}

  // ---------- paths ----------
  private resDir(symbol: string, res: Resolution) {
    return path.join(this.dir, symbol, res.toLowerCase());
  }
  private fpath(symbol: string, res: Resolution, ts: number) {
    if (res === '1' || res === '5' || res === '15' || res === '60' || res === '240' || res === '1D') {
      return path.join(this.resDir(symbol, res), `${ymd(ts)}.ndjson`);
    }
    if (res === '1W') {
      // one file per week: use Monday YYYY-MM-DD as key
      const wk = ymd(startOfWeekUTC_Mon(ts));
      return path.join(this.resDir(symbol, res), `wk_${wk}.ndjson`);
    }
    // 1M → one file per month
    return path.join(this.resDir(symbol, res), `${ym(ts)}.ndjson`);
  }
  private async ensureDir(symbol: string, res: Resolution = '1') {
    await fs.mkdir(this.resDir(symbol, res), { recursive: true });
  }

  // ---------- writing 1m ----------
  async ingestTick(key: SeriesKey, price: number, tsMs: number, volume = 0): Promise<void> {
    const sym = key.symbol.toUpperCase();
    const bucket = bucketStart('1', tsMs);

    // current open bar (if any)
    const ob = this.open.get(sym);

    // same bucket → just update H/L/C/V (DO NOT touch 'o')
    if (ob && ob.t === bucket) {
      if (price > ob.h) ob.h = price;
      if (price < ob.l) ob.l = price;
      ob.c = price;
      ob.v += volume;
      return;
    }

    // new minute (or first ever):
    // 1) figure out the time-based open = previous close
    let prevClose: number | null = null;
    if (ob && ob.t < bucket) {
      // we’re rolling from the prior live minute: its close is the open of the new minute
      prevClose = ob.c;
    } else {
      prevClose = await this.lastClose({ symbol: sym }); // may be null on very first tick
    }
    const open = (prevClose ?? price);

    // 2) finalize the prior live bar (if any)
    if (ob) await this.finalizeUpTo(sym, ob.t);

    // 3) fill any missing minutes up to prev minute with flats (O=H=L=C=prevClose)
    await this.carryForwardTo({ symbol: sym }, bucket - 1);

    // 4) create the new open 1m bar anchored to time (not trade)
    this.open.set(sym, {
      t: bucket,
      o: open,
      h: Math.max(open, price),
      l: Math.min(open, price),
      c: price,
      v: volume || 0,
    });
  }

  async carryForwardTo(key: SeriesKey, toMs: number): Promise<void> {
    const sym = key.symbol.toUpperCase();
    const target = bucketStart('1', toMs);
    await this.ensureDir(sym, '1');

    // discover last written 1m if unknown
    let last = this.lastWritten.get(sym);
    if (last == null) {
      last = await this.findLastWritten1m(sym);
      this.lastWritten.set(sym, last ?? -Infinity);
    }

    // if there is an open bar whose bucket is <= target, persist it (closing that minute)
    const ob = this.open.get(sym);
    if (ob && ob.t <= target) {
      await this.upsert(sym, '1', ob);
      this.lastWritten.set(sym, ob.t);
      this.open.delete(sym);
    }

    // carry-forward flat bars for any whole-minute gaps after the last written bucket
    let cur = this.lastWritten.get(sym) ?? -Infinity;
    if (cur === -Infinity) return; // nothing written yet; first ingestTick will synthesize from trade

    while (cur + MINUTE <= target) {
      const nextT = cur + MINUTE;
      const close = await this.lastCloseFromDiskOrOpen(sym, cur); // prev minute's close
      const flat: Candle = { t: nextT, o: close, h: close, l: close, c: close, v: 0 };
      await this.upsert(sym, '1', flat);
      cur = nextT;
      this.lastWritten.set(sym, cur);
    }
  }

  async getSmart(key: { symbol: string }, res: Resolution, fromMs: number, toMs: number) {
    await this.carryForwardTo(key, toMs);
    return this.get(key, res, fromMs, toMs);
  }

  // ---------- reading ----------
  async get(key: SeriesKey, res: Resolution, fromMs: number, toMs: number): Promise<Candle[]> {
    const sym = key.symbol.toUpperCase();

    // Try to serve from stored tier first
    const direct = await this.readTierRange(sym, res, fromMs, toMs);

    if (direct.length || res === '1') {
      // Include current open 1m if asking for 1m and it is in range
      if (res === '1') {
        const ob = this.open.get(sym);
        if (ob && ob.t >= fromMs && ob.t <= toMs) direct.push(ob);
        direct.sort((a,b) => a.t - b.t);
      }
      return direct;
    }

    // Fallback: aggregate from 1m if target tier files not present yet
    const base = await this.readTierRange(sym, '1', fromMs, toMs);
    const ob = this.open.get(sym);
    if (ob && ob.t >= fromMs && ob.t <= toMs) base.push(ob);
    if (!base.length) return [];

    base.sort((a,b) => a.t - b.t);
    return aggregateTo(res, base);
  }

  async lastClose(key: SeriesKey): Promise<number|null> {
    const sym = key.symbol.toUpperCase();
    const ob = this.open.get(sym);
    if (ob) return ob.c;

    const t = await this.findLastWritten1m(sym);
    if (t == null) return null;

    const c = await this.readExact('1', sym, t);
    return c?.c ?? null;
  }

  // ---------- helpers (IO) ----------

  private async append(sym: string, res: Resolution, c: Candle) {
    const fp = this.fpath(sym, res, c.t);
    await this.ensureDir(sym, res);
    const last = this.lastWritten.get(sym);
    if (last != null && c.t <= last) return;

    await fs.appendFile(fp, JSON.stringify(c) + '\n', 'utf8');
    this.lastWritten.set(sym, c.t);
  }

  private async upsert(sym: string, res: Resolution, c: Candle) {
    const day = ymd(c.t);
    const fp = this.fpath(sym, res, c.t);
    await this.ensureDir(sym, res);

    // read existing (if any)
    let lines: string[] = [];
    try {
      const text = await fs.readFile(fp, 'utf8');
      if (text) lines = text.trimEnd().split('\n');
    } catch {/* new file */}

    // parse last (fast path)
    if (lines.length) {
      const last = JSON.parse(lines[lines.length - 1]) as Candle;

      if (last.t === c.t) {
        // overwrite last line
        lines[lines.length - 1] = JSON.stringify(c);
      } else if (last.t < c.t) {
        // strictly newer -> append
        lines.push(JSON.stringify(c));
      } else {
        // rare: out-of-order (backfill or race) — rebuild map and rewrite sorted
        const map = new Map<number, Candle>();
        for (const ln of lines) {
          if (!ln) continue;
          const x = JSON.parse(ln) as Candle;
          map.set(x.t, x);
        }
        map.set(c.t, c);
        const sorted = [...map.values()].sort((a,b) => a.t - b.t);
        lines = sorted.map(x => JSON.stringify(x));
      }
    } else {
      // first line of the day
      lines = [JSON.stringify(c)];
    }

    // atomic write
    try {
      const tmp = fp + '.tmp';
      await fs.writeFile(tmp, lines.join('\n') + '\n', 'utf8');
      await fs.rename(tmp, fp);
    } catch (e) {}

    this.lastWritten.set(sym, c.t);
  }

  private async readExact(res: Resolution, sym: string, t: number): Promise<Candle | null> {
    const fp = this.fpath(sym, res, t);
    try {
      const text = await fs.readFile(fp, 'utf8');
      const lines = text.trimEnd().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const c = JSON.parse(lines[i]) as Candle;
        if (c.t === t) return c;
        if (c.t < t) break;
      }
      return null;
    } catch { return null; }
  }

  private async lastCloseFromDiskOrOpen(sym: string, lastWrittenT: number): Promise<number> {
    const ob = this.open.get(sym);
    if (ob && ob.t === lastWrittenT) return ob.c;
    const prev = await this.readExact('1', sym, lastWrittenT);
    if (!prev) throw new Error('Invariant: missing previous 1m candle for carryForward');
    return prev.c;
  }

  private async findLastWritten1m(sym: string): Promise<number | undefined> {
    // Probe today, then yesterday
    const days = [0, -86400_000].map(delta => ymd(Date.now() + delta));
    for (const day of days) {
      const fp = path.join(this.resDir(sym, '1'), `${day}.ndjson`);
      try {
        const text = await fs.readFile(fp, 'utf8');
        const lines = text.trimEnd().split('\n');
        if (!lines.length) continue;
        const c = JSON.parse(lines[lines.length - 1]) as Candle;
        return c.t;
      } catch { /* no file */ }
    }
    return undefined;
  }

  private async readTierRange(sym: string, res: Resolution, fromMs: number, toMs: number): Promise<Candle[]> {
    // Build file list to scan for this res
    const files: string[] = [];

    if (res === '1' || res === '5' || res === '15' || res === '60' || res === '240' || res === '1D') {
      // day files
      const startDay = startOfDayUTC(fromMs);
      const endDay   = startOfDayUTC(toMs);
      for (let d = startDay; d <= endDay; d += 86400_000) {
        files.push(path.join(this.resDir(sym, res), `${ymd(d)}.ndjson`));
      }
    } else if (res === '1W') {
      const start = startOfWeekUTC_Mon(fromMs);
      const end   = startOfWeekUTC_Mon(toMs);
      for (let w = start; w <= end; w += 7 * 86400_000) {
        files.push(path.join(this.resDir(sym, '1W'), `wk_${ymd(w)}.ndjson`));
      }
    } else { // '1M'
      const start = startOfMonthUTC(fromMs);
      const end   = startOfMonthUTC(toMs);
      for (let m = start; m <= end; ) {
        files.push(path.join(this.resDir(sym, '1M'), `${ym(m)}.ndjson`));
        // advance to next month
        const d = new Date(m);
        d.setUTCMonth(d.getUTCMonth() + 1);
        m = d.getTime();
      }
    }

    const out: Candle[] = [];
    for (const fp of files) {
      try {
        const text = await fs.readFile(fp, 'utf8');
        if (!text) continue;
        const lines = text.split('\n');
        for (const ln of lines) {
          if (!ln) continue;
          const c = JSON.parse(ln) as Candle;
          if (c.t < fromMs || c.t > toMs) continue;
          out.push(c);
        }
      } catch {
        // file missing -> skip
      }
    }
    out.sort((a,b) => a.t - b.t);
    return out;
  }

  private async finalizeUpTo(sym: string, upToT: number) {
    const ob = this.open.get(sym);
    if (!ob) return;
    if (ob.t <= upToT) {
      await this.upsert(sym, '1', ob);
      this.lastWritten.set(sym, ob.t);
      this.open.delete(sym);
    }
  }
}

// ---------- aggregation helper ----------
function aggregateTo(res: Resolution, base: Candle[]): Candle[] {
  if (res === '1') return base.slice();

  const out: Candle[] = [];
  let curBucket = -1;
  let acc: Candle | null = null;

  for (const b of base) {
    const buck = bucketStart(res, b.t);
    if (buck !== curBucket) {
      if (acc) out.push(acc);
      curBucket = buck;
      acc = { t: buck, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      if (!acc) continue;
      if (b.h > acc.h) acc.h = b.h;
      if (b.l < acc.l) acc.l = b.l;
      acc.c = b.c;
      acc.v += b.v;
    }
  }
  if (acc) out.push(acc);
  return out;
}

export { bucketStart };
