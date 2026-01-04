import type { SocketStream } from '@fastify/websocket';
import type { Resolution } from '../candles/types';

// minutes per resolution
const RES_TO_MIN: Record<Resolution, number> = {
  '1': 1, '5': 5, '15': 15, '60': 60, '240': 240, '1D': 1440, '1W': 10080, '1M': 43200
};
const MINUTE = 60_000;

type SeriesKey = { symbol: string };
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export interface CandleStorageLike {
  carryForwardTo(key: SeriesKey, toMs: number): Promise<void> | void;
  get(key: SeriesKey, res: Resolution, fromMs: number, toMs: number): Promise<Candle[]> | Candle[];
}

type WSLikeInput = SocketStream | any;       // accepts Fastify SocketStream or raw ws
type MinimalWS = {                            // duck-typed minimal WebSocket we use
  on(event: string, cb: (...args: any[]) => void): any;
  send(data: string): any;
  close?(code?: number): any;
  terminate?(): any;
  readyState?: number; // optional, we don't rely on numeric constants
};

function floorBucket(ts: number, minutes: number) {
  const size = minutes * MINUTE;
  return Math.floor(ts / size) * size;
}

export class RealtimeHub {
  private clients = new Map<MinimalWS, { symbol: string; res: Resolution }>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private store: CandleStorageLike,
    private opts: { pingMs?: number; logger?: { info?: Function; warn?: Function; error?: Function } } = {}
  ) {
    const pingMs = this.opts.pingMs ?? 25_000;
    this.pingTimer = setInterval(() => this.pingAll(), pingMs);
  }

  /** Normalize SocketStream | raw ws → MinimalWS via duck typing */
  private toWS(client: WSLikeInput): MinimalWS {
    const maybe = client as any;
    const ws: MinimalWS | undefined =
      (maybe && typeof maybe.send === 'function' && typeof maybe.on === 'function') ? maybe :
      (maybe?.socket && typeof maybe.socket.send === 'function' && typeof maybe.socket.on === 'function') ? maybe.socket :
      undefined;

    if (!ws) throw new Error('RealtimeHub.add: invalid websocket client');
    return ws;
  }

  add(client: WSLikeInput, symbol: string, res: Resolution) {
    const ws = this.toWS(client);

    // replace prior registration (if any)
    this.remove(ws);

    const upper = symbol.toUpperCase();
    this.clients.set(ws, { symbol: upper, res });

    ws.on('close', () => this.remove(ws));
    ws.on('error', () => this.remove(ws));

    this.safeSend(ws, { type: 'hello', symbol: upper, res });
    this.publish(upper, Date.now()).catch(() => {});

    // Optional: client can change subscription on the fly
    ws.on('message', (buf: any) => {
      try {
        const msg = JSON.parse(String(buf || ''));
        if (msg?.type === 'subscribe' && msg.symbol && msg.res) {
          const sub = this.clients.get(ws);
          if (sub) {
            sub.symbol = String(msg.symbol).toUpperCase();
            sub.res = String(msg.res) as Resolution;
            this.safeSend(ws, { type: 'subscribed', symbol: sub.symbol, res: sub.res });
          }
        }
      } catch { /* ignore */ }
    });

    this.opts.logger?.info?.({ symbol: upper, res }, 'ws client subscribed');
  }

  remove(clientOrWS: WSLikeInput | MinimalWS) {
    const ws = (clientOrWS as any)?.socket ?? clientOrWS;
    if (ws && this.clients.has(ws)) {
      this.clients.delete(ws);
      this.opts.logger?.info?.('ws client removed');
    }
  }

  /** Push the latest bar of `symbol` to all subscribers of that symbol */
  async publish(symbol: string, nowMs: number) {
    const upper = symbol.toUpperCase();
    const subs = [...this.clients.entries()].filter(([, s]) => s.symbol === upper);
    if (!subs.length) return;

    for (const [ws, s] of subs) {
      try {
        const sizeMin = RES_TO_MIN[s.res] || 1;
        const bucketStart = floorBucket(nowMs, sizeMin);

        const bars = await this.store.get({ symbol: upper }, s.res, bucketStart, nowMs);
        if (!bars?.length) continue;

        const last = bars[bars.length - 1];
        this.safeSend(ws, {
          type: 'bar',
          bar: { t: Math.floor(last.t / 1000), o: last.o, h: last.h, l: last.l, c: last.c, v: last.v }
        });
      } catch (e) {
        this.opts.logger?.warn?.(e, 'ws publish failed');
        try { (ws as any).terminate?.(); } catch {}
        this.remove(ws);
      }
    }
  }

  /** Optional bulk snapshot */
  async snapshot(symbol: string, res: Resolution, fromMs: number, toMs: number) {
    const upper = symbol.toUpperCase();
    const bars = await this.store.get({ symbol: upper }, res, fromMs, toMs);
    const payload = { type: 'snapshot', symbol: upper, res, bars };
    for (const [ws, s] of this.clients) {
      if (s.symbol === upper && s.res === res) this.safeSend(ws, payload);
    }
  }

  private pingAll() {
    for (const ws of this.clients.keys()) {
      this.safeSend(ws, { type: 'ping', ts: Date.now() });
    }
  }

  private safeSend(ws: MinimalWS, obj: any) {
    try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }

  stop() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const ws of this.clients.keys()) {
      try { ws.close?.(1000); } catch {}
    }
    this.clients.clear();
  }
}

export default RealtimeHub;