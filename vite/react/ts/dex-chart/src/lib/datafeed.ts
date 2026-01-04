import type { Candle, Resolution } from './types';
import type { Time, UTCTimestamp } from 'lightweight-charts';

const API_HTTP = import.meta.env.VITE_API_HTTP ?? window.location.origin;
const API_WS   = import.meta.env.VITE_API_WS   ?? window.location.origin.replace(/^http/, 'ws');

const toUtcTs = (t: number): UTCTimestamp =>
  (t > 1e12 ? Math.floor(t / 1000) : Math.floor(t)) as UTCTimestamp;

// Extended response types
interface ArpHistoryResponse {
  s: 'ok' | 'no_data';
  t: number[];
  prices: number[];
  confidence: number[];
  hops: number[];
  meta: {
    type: 'arp';
    chart_type: 'line';
    anchor: string;
  };
  base_asset: { id: number; hash: string; ticker: string };
  quote_asset: { id: number; hash: string; ticker: string };
}

interface OhlcHistoryResponse {
  s: 'ok' | 'no_data';
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v?: number[];
  meta?: {
    type: 'trading_pair';
    pair_id?: number;
    inverted?: boolean;
  };
}

type HistoryResponse = ArpHistoryResponse | OhlcHistoryResponse;

// Extended Candle type to include ARP data
export interface ExtendedCandle extends Candle {
  confidence?: number;
  hops?: number;
  isArpData?: boolean;
}

export class DataFeed {
  private ws?: WebSocket;
  private onBar?: (bar: ExtendedCandle) => void;
  private cur?: { symbol: string; res: Resolution, router?: string };

  // Outbound queue so we don't drop subscribe frames before onopen
  private q: string[] = [];

  private send(msg: any) {
    const s = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(s);
    } else {
      this.q.push(s);
    }
  }

  async time(): Promise<Time> {
    const r = await fetch(`${API_HTTP}/tv/time`, { cache: 'no-store' });
    const j = await r.json();
    // normalize (server might send ms or seconds; accept { now|t|time } or raw number)
    const raw = typeof j === 'number' ? j : (j?.now ?? j?.t ?? j?.time);
    return toUtcTs(Number(raw));
  }

  async history(
    symbol: string,
    res: Resolution,
    fromSec: number,
    toSec: number,
    includeLive = true,
    router?: string
  ): Promise<ExtendedCandle[]> {
    const url = new URL(`${API_HTTP}/tv/history`);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('resolution', res);
    url.searchParams.set('from', String(fromSec));
    url.searchParams.set('to', String(toSec));
    if (includeLive) url.searchParams.set('live', '1');
    if (router) url.searchParams.set('router', router);

    console.log(url.toString());

    const r = await fetch(url.toString(), { cache: 'no-store' });
    const j: HistoryResponse = await r.json();

    if (j?.s !== 'ok' || !Array.isArray(j?.t)) return [];

    // Check if this is ARP data
    const isArpData = 'prices' in j && j.meta?.type === 'arp';

    if (isArpData) {
      // Handle ARP data format
      const arpData = j as ArpHistoryResponse;
      return arpData.t.map((t: number, i: number) => ({
        time: toUtcTs(t),
        open: arpData.prices[i],
        high: arpData.prices[i],
        low: arpData.prices[i],
        close: arpData.prices[i],
        volume: 0, // ARP data doesn't have volume
        confidence: arpData.confidence[i],
        hops: arpData.hops[i],
        isArpData: true,
      }));
    } else {
      // Handle regular OHLC data format
      const ohlcData = j as OhlcHistoryResponse;
      return ohlcData.t.map((t: number, i: number) => ({
        time: toUtcTs(t),
        open: ohlcData.o[i],
        high: ohlcData.h[i],
        low: ohlcData.l[i],
        close: ohlcData.c[i],
        volume: ohlcData.v?.[i] ?? 0,
        isArpData: false,
      }));
    }
  }

  private openWS(symbol: string, res: Resolution, onBar: (bar: ExtendedCandle) => void, router?: string) {
    // Reuse existing socket if possible: in-band subscribe instead of reopening
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.onBar = onBar;
      this.cur = { symbol, res, router };
      this.send({ type: 'subscribe', symbol, res, router });
      return;
    }

    const url = new URL(`${API_WS}/ws`);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('res', res);
    if (router) url.searchParams.set('router', router);

    const ws = new WebSocket(url);
    this.ws = ws;
    this.cur = { symbol, res, router };
    this.onBar = onBar;

    ws.onopen = () => {
      // flush any queued frames (including a subscribe we may have queued)
      while (this.q.length) ws.send(this.q.shift()!);
      // ensure subscription even if nothing was queued
      this.send({ type: 'subscribe', symbol, res, router });
    };

    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        
        if (m.type === 'bar' && m.bar) {
          // Regular OHLC bar from WebSocket
          const b = m.bar;
          // guard against null/undefined fields
          if (
            b == null || b.t == null || b.o == null || b.h == null ||
            b.l == null || b.c == null
          ) return;

          this.onBar?.({
            time: toUtcTs(b.t),
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
            volume: b.v ?? 0,
            isArpData: false,
          });
          
        } else if (m.type === 'arp_update') {
          // ARP update from WebSocket
          if (m.price == null || m.timestamp == null) return;
          
          const arpBar: ExtendedCandle = {
            time: toUtcTs(m.timestamp),
            open: m.price,
            high: m.price,
            low: m.price,
            close: m.price,
            volume: 0,
            confidence: m.confidence ?? 1.0,
            hops: m.hops ?? 0,
            isArpData: true,
          };

          this.onBar?.(arpBar);
          
        } else if (m.type === 'arp_price') {
          // Legacy ARP format support
          if (m.price == null || m.timestamp == null) return;
          
          const arpBar: ExtendedCandle = {
            time: toUtcTs(m.timestamp),
            open: m.price,
            high: m.price,
            low: m.price,
            close: m.price,
            volume: 0,
            confidence: 1.0, // default for legacy format
            hops: 0,
            isArpData: true,
          };

          this.onBar?.(arpBar);
          
        } else if (m.type === 'error') {
          console.warn('[WebSocket] Server error:', m.error, m);
          
        } else if (m.type === 'pong') {
          // Heartbeat response - ignore
        }
      } catch (error) {
        console.warn('[WebSocket] Failed to parse message:', error, ev.data);
      }
    };

    ws.onerror = (error) => {
      console.warn('[WebSocket] Connection error:', error);
    };

    ws.onclose = (event) => {
      console.log('[WebSocket] Connection closed:', event.code, event.reason);
      
      // jittered soft auto-reconnect only if still current
      const expect = this.cur;
      if (!expect || !this.onBar) return;
      
      const ms = 400 + Math.floor(Math.random() * 300);
      setTimeout(() => {
        console.log('[WebSocket] Attempting reconnect...');
        this.openWS(expect.symbol, expect.res, this.onBar!, expect.router);
      }, ms);
    };
  }

  subscribe(symbol: string, res: Resolution, onBar: (bar: ExtendedCandle) => void, router?: string) {
    // Do not force-close; allow in-band subscribe or open once if needed
    this.openWS(symbol, res, onBar, router);
  }

  /** Switch stream without tearing down chart components */
  resubscribe(symbol: string, res: Resolution, onBar: (bar: ExtendedCandle) => void, router?: string) {
    // If same stream, just swap the callback; otherwise prefer in-band subscribe
    if (this.cur && this.cur.symbol === symbol && this.cur.res === res && this.cur.router === router) {
      this.onBar = onBar;
      return;
    }
    this.openWS(symbol, res, onBar, router);
  }

  unsubscribe() {
    this.onBar = undefined;
    this.cur = undefined;
    this.q = [];
    try { this.ws?.close(); } catch {}
    this.ws = undefined;
  }
}