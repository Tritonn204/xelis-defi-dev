import fetch from 'node-fetch';
import type { PriceHub } from './priceHub';
import { MINUTE } from '../constants';

const nextMin = (t: number) => Math.floor(t / MINUTE) * MINUTE + MINUTE;

export class XelUsdSampler {
  private running = false;
  private minuteTimer?: NodeJS.Timeout;
  private sampleTimer?: NodeJS.Timeout;
  constructor(private hub: PriceHub, private symbol = 'XEL_USD') {}

  private handler?: (now: number) => void;
  onTick(fn: (now: number) => void) { this.handler = fn; }

  async start() {
    if (this.running) return; this.running = true;

    // seed once
    try { const p0 = await this.fetchXelUsd(); if (p0 !== null) this.hub.set(this.symbol, p0, 'paprika'); } catch {}

    // UNIX-aligned keepalive: if nothing came in this minute, carry-forward will be handled by candles layer
    const schedule = () => {
      if (!this.running) return;
      const now = Date.now(), at = nextMin(now);
      this.minuteTimer = setTimeout(() => schedule(), Math.max(0, at - now + 2));
    };
    schedule();

    // sampling loop (adjust cadence as you like)
    const loop = async () => {
      if (!this.running) return;
      try {
        const p = await this.fetchXelUsd();
        if (p !== null) {
          this.hub.set(this.symbol, p, 'paprika');
          this.handler?.(Date.now());
        }
      } catch {}
      const jitter = 10_000 + Math.floor(Math.random() * 5_000);
      this.sampleTimer = setTimeout(loop, jitter);
    };
    loop();
  }
  stop() { this.running = false; if (this.minuteTimer) clearTimeout(this.minuteTimer); if (this.sampleTimer) clearTimeout(this.sampleTimer); }

  private async fetchXelUsd(): Promise<number|null> {
    try {
      const r = await fetch('https://api.coinpaprika.com/v1/tickers/xel-xelis?quotes=USD');
      const j: any = await r.json();
      const v = j?.quotes?.USD?.price;
      return typeof v === 'number' ? v : null;
    } catch { return null; }
  }
}