import { Bar } from './types';

export class CandleAccumulator {
  private minuteMs: number;
  private current?: Bar;

  constructor(minuteMs = 60_000) {
    this.minuteMs = minuteMs;
  }

  private bucket(ts: number) { return Math.floor(ts / this.minuteMs) * this.minuteMs; }

  /** Tick-style update (works as before) */
  update(ts: number, price: number, volume: number): Bar {
    const t = this.bucket(ts);
    if (!this.current || this.current.t !== t) {
      this.current = { t, o: price, h: price, l: price, c: price, v: volume };
    } else {
      const b = this.current;
      if (price > b.h) b.h = price;
      if (price < b.l) b.l = price;
      b.c = price;
      b.v += volume;
    }
    return this.current;
  }

  /** NEW: merge a full kline snapshot for its bucket (source-of-truth path) */
  mergeKline(bucketOpenMs: number, o: number, h: number, l: number, c: number, v = 0): Bar {
    const t = this.bucket(bucketOpenMs);
    if (!this.current || this.current.t !== t) {
      this.current = { t, o, h, l, c, v };
    } else {
      const b = this.current;
      // keep the first open, but merge high/low/close/volume
      b.h = Math.max(b.h, h);
      b.l = Math.min(b.l, l);
      b.c = c;
      // if exchange volume is cumulative inside minute, prefer non-zero v
      if (v && !Number.isNaN(v)) b.v = v > 0 ? v : b.v;
    }
    return this.current;
  }

  snapshot(): Bar | undefined {
    return this.current ? { ...this.current } : undefined;
  }

  /** Optional: close out previous bucket when minute rolls */
  roll(ts: number): Bar | undefined {
    const t = this.bucket(ts);
    if (this.current && this.current.t < t) {
      const done = this.current;
      // new bucket initialized as flat @ prev close, zero vol
      this.current = { t, o: done.c, h: done.c, l: done.c, c: done.c, v: 0 };
      return done;
    }
    return undefined;
  }
}