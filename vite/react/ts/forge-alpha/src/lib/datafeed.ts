import type { Candle, Resolution } from '@/types/chart';
import type { Time, UTCTimestamp } from 'lightweight-charts';

const API_HTTP = import.meta.env.VITE_API_HTTP ?? window.location.origin;
const API_WS   = import.meta.env.VITE_API_WS   ?? window.location.origin.replace(/^http/, 'ws');

const toUtcTs = (t: number): UTCTimestamp =>
  (t > 1e12 ? Math.floor(t / 1000) : Math.floor(t)) as UTCTimestamp;

// Types (keep your existing ones, add these)
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

export interface ExtendedCandle extends Candle {
  confidence?: number;
  hops?: number;
  isArpData?: boolean;
}

export interface ArpUpdate {
  timestamp: number;
  price: number;
  confidence: number;
  hops: number;
  source?: string;
  bestPathEdges?: number[];
}

export interface SparklinePoint {
  time: number;
  price: number;
}

// Listener types for fan-out
type BarListener = (bar: ExtendedCandle) => void;
type ArpListener = (update: ArpUpdate) => void;
type SparklineListener = (point: SparklinePoint) => void;
type AnyListener = BarListener | ArpListener | SparklineListener;

// Subscription state with reference counting
interface SubscriptionState {
  refCount: number;
  listeners: Set<AnyListener>;
  lastData: any | null;
  status: 'connecting' | 'active' | 'error';
  error?: Error;
}

export function buildSubscriptionKey(
  type: 'bar' | 'sparkline' | 'arp',
  symbol: string,
  res?: Resolution,
  router?: string
): string {
  if (type === 'arp') {
    // ARP format: arp:{asset}:{anchor}
    const [base, anchor = 'usd'] = symbol.split('_');
    return `arp:${base.toLowerCase()}:${anchor.toLowerCase()}`;
  }

  // Check if this is actually an ARP subscription (USD quote)
  if (symbol.toUpperCase().endsWith('_USD')) {
    const [base] = symbol.split('_');
    return `arp:${base.toLowerCase()}:usd`;
  }

  if (type === 'sparkline') {
    return `sparkline:${symbol}:${res}`;
  }

  return router ? `bar:${symbol}:${res}:${router}` : `bar:${symbol}:${res}`;
}

export class DataFeed {
  private ws?: WebSocket;
  private subscriptions = new Map<string, SubscriptionState>();
  private reconnectTimer?: number;
  private lastActivity = Date.now();
  private staleCheckTimer?: number;
  private q: string[] = [];
  
  // Debounce cleanup to handle React StrictMode / rapid remounts
  private cleanupTimers = new Map<string, number>();
  private readonly CLEANUP_DELAY_MS = 100;

  private send(msg: any) {
    const s = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(s);
    } else {
      this.q.push(s);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Core subscription with reference counting
  // ─────────────────────────────────────────────────────────────
  
  private addSubscription(key: string, listener: AnyListener): () => void {
    // Cancel any pending cleanup for this key
    const pendingCleanup = this.cleanupTimers.get(key);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup);
      this.cleanupTimers.delete(key);
    }
    
    let state = this.subscriptions.get(key);
    
    if (!state) {
      // First subscriber - create state and subscribe
      state = {
        refCount: 0,
        listeners: new Set(),
        lastData: null,
        status: 'connecting'
      };
      this.subscriptions.set(key, state);
      
      // Open WS if needed and subscribe
      this.openWS();
      this.send({ type: 'subscribe', key });
    }
    
    state.listeners.add(listener);
    state.refCount++;
    
    // Late subscriber gets last known data immediately
    if (state.lastData && state.refCount > 1) {
      try {
        listener(state.lastData);
      } catch (err) {
        console.error(`[DataFeed] Listener error for ${key}:`, err);
      }
    }
    
    // Return unsubscribe function
    return () => {
      const currentState = this.subscriptions.get(key);
      if (!currentState) return;
      
      currentState.listeners.delete(listener);
      currentState.refCount--;
      
      if (currentState.refCount === 0) {
        // Debounce cleanup to handle rapid mount/unmount
        const timer = window.setTimeout(() => {
          this.cleanupTimers.delete(key);
          
          // Re-check refCount in case something resubscribed
          const finalState = this.subscriptions.get(key);
          if (finalState && finalState.refCount === 0) {
            this.send({ type: 'unsubscribe', key });
            this.subscriptions.delete(key);
            
            // Close WS if no more subscriptions
            if (this.subscriptions.size === 0) {
              this.closeWS();
            }
          }
        }, this.CLEANUP_DELAY_MS);
        
        this.cleanupTimers.set(key, timer);
      }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Public subscription methods with fan-out
  // ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to bar updates with reference counting.
   * Multiple calls with same key share one server subscription.
   * Returns unsubscribe function.
   */
  subscribeBar(
    symbol: string, 
    res: Resolution, 
    onBar: BarListener, 
    router?: string
  ): () => void {
    const key = buildSubscriptionKey('bar', symbol, res, router);
    return this.addSubscription(key, onBar);
  }

  /**
   * Subscribe to ARP updates with reference counting.
   * Returns unsubscribe function.
   */
  subscribeArp(
    asset: string, 
    anchor: string = 'usd', 
    onUpdate: ArpListener
  ): () => void {
    const key = `arp:${asset.toLowerCase()}:${anchor.toLowerCase()}`;
    return this.addSubscription(key, onUpdate);
  }

  /**
   * Subscribe to sparkline updates with reference counting.
   * Returns unsubscribe function.
   */
  subscribeSparklineRefCounted(
    symbol: string, 
    res: Resolution, 
    onPoint: SparklineListener
  ): () => void {
    const key = buildSubscriptionKey('sparkline', symbol, res);
    return this.addSubscription(key, onPoint);
  }

  /**
   * Get current data for a subscription key (for late subscribers / initial render)
   */
  getSnapshot(key: string): any | null {
    return this.subscriptions.get(key)?.lastData ?? null;
  }

  /**
   * Get subscription status
   */
  getStatus(key: string): 'connecting' | 'active' | 'error' | 'inactive' {
    return this.subscriptions.get(key)?.status ?? 'inactive';
  }

  // ─────────────────────────────────────────────────────────────
  // Legacy methods (keep for backward compatibility)
  // ─────────────────────────────────────────────────────────────

  /** @deprecated Use subscribeBar() instead */
  subscribe(symbol: string, res: Resolution, onBar: BarListener, router?: string) {
    // Legacy: doesn't return unsubscribe, caller must use unsubscribe()/unsubscribeKey()
    const key = buildSubscriptionKey('bar', symbol, res, router);
    this.addSubscription(key, onBar);
  }

  /** @deprecated Use subscribeSparklineRefCounted() instead */
  subscribeSparkline(symbol: string, res: Resolution, onPoint: SparklineListener) {
    const key = buildSubscriptionKey('sparkline', symbol, res);
    this.addSubscription(key, onPoint);
  }

  resubscribe(symbol: string, res: Resolution, onBar: BarListener, router?: string) {
    // Unsubscribe from all current bars (but keep sparklines and ARP)
    const barKeys = Array.from(this.subscriptions.keys()).filter(k => k.startsWith('bar:'));
    for (const key of barKeys) {
      const state = this.subscriptions.get(key);
      if (state) {
        this.send({ type: 'unsubscribe', key });
        this.subscriptions.delete(key);
      }
    }
    
    // Subscribe to new
    this.subscribeBar(symbol, res, onBar, router);
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP methods (unchanged)
  // ─────────────────────────────────────────────────────────────

  async time(): Promise<Time> {
    const r = await fetch(`${API_HTTP}/tv/time`, { cache: 'no-store' });
    const j = await r.json();
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

    const r = await fetch(url.toString(), { cache: 'no-store' });
    const j: HistoryResponse = await r.json();

    console.log("j:",j);

    if (j?.s !== 'ok' || !Array.isArray(j?.t)) return [];

    const isArpData = 'prices' in j && j.meta?.type === 'arp';

    if (isArpData) {
      const arpData = j as ArpHistoryResponse;
      return arpData.t.map((t: number, i: number) => ({
        time: toUtcTs(t),
        open: arpData.prices[i],
        high: arpData.prices[i],
        low: arpData.prices[i],
        close: arpData.prices[i],
        volume: 0,
        confidence: arpData.confidence[i],
        hops: arpData.hops[i],
        isArpData: true,
      }));
    } else {
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

  // ─────────────────────────────────────────────────────────────
  // WebSocket management (mostly unchanged)
  // ─────────────────────────────────────────────────────────────

  private openWS() {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      return;
    }

    const ws = new WebSocket(`${API_WS}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      console.log('[DataFeed] WebSocket connected');
      this.lastActivity = Date.now();
      
      // Flush queued messages
      while (this.q.length) {
        ws.send(this.q.shift()!);
      }
      
      // Resubscribe to all active subscriptions
      const activeKeys = Array.from(this.subscriptions.keys())
        .filter(key => (this.subscriptions.get(key)?.refCount ?? 0) > 0);
      
      if (activeKeys.length > 0) {
        this.send({ type: 'subscribe_multi', keys: activeKeys });
      }

      this.startStaleDetection();
    };

    ws.onmessage = (ev) => {
      try {
        this.lastActivity = Date.now();
        const m = JSON.parse(ev.data);
        
        if (m.type === 'batch') {
          if (m.dropped > 0) {
            console.warn(`[DataFeed] Server dropped ${m.dropped} messages`);
            this.handleDroppedMessages();
          }
          for (const msg of m.messages) {
            this.handleMessage(msg);
          }
          return;
        }
        
        this.handleMessage(m);
        
      } catch (error) {
        console.warn('[DataFeed] Failed to parse message:', error);
      }
    };

    ws.onerror = (error) => {
      console.warn('[DataF] Connection error:', error);
    };

    ws.onclose = (event) => {
      console.log('[DataFeed] Connection closed:', event.code, event.reason);
      this.stopStaleDetection();
      
      // Only reconnect if we have active subscriptions
      const hasActive = Array.from(this.subscriptions.values())
        .some(state => state.refCount > 0);
      
      if (hasActive) {
        const ms = 400 + Math.floor(Math.random() * 300);
        this.reconnectTimer = window.setTimeout(() => {
          console.log('[DataFeed] Attempting reconnect...');
          this.openWS();
        }, ms);
      }
    };

    ws.addEventListener('message', (ev) => {
      if (ev.data === 'ping' || ev.data === '{"type":"ping"}') {
        ws.send('{"type":"pong"}');
      }
    });
  }

  private closeWS() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.stopStaleDetection();
    try { 
      this.ws?.close(); 
    } catch {}
    this.ws = undefined;
  }

  private handleMessage(m: any) {
    const state = m.key ? this.subscriptions.get(m.key) : null;
    
    if (m.type === 'bar' && m.bar && state) {
      const b = m.bar;
      if (b.t == null || b.o == null || b.h == null || b.l == null || b.c == null) return;

      const candle: ExtendedCandle = {
        time: toUtcTs(b.t),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v ?? 0,
        isArpData: false,
      };
      
      state.lastData = candle;
      state.status = 'active';
      state.listeners.forEach(listener => {
        try {
          (listener as BarListener)(candle);
        } catch (err) {
          console.error(`[DataFeed] Listener error:`, err);
        }
      });
      
    } else if (m.type === 'arp_update' && state) {
      if (m.price == null || m.timestamp == null) return;
      
      const update: ArpUpdate = {
        timestamp: m.timestamp,
        price: m.price,
        confidence: m.confidence ?? 1.0,
        hops: m.hops ?? 0,
        source: m.source,
        bestPathEdges: m.bestPathEdges,
      };
      
      state.lastData = update;
      state.status = 'active';
      state.listeners.forEach(listener => {
        try {
          (listener as ArpListener)(update);
        } catch (err) {
          console.error(`[DataFeed] Listener error:`, err);
        }
      });
      
    } else if (m.type === 'sparkline_point' && state) {
      if (m.p == null || m.t == null) return;
      
      const point: SparklinePoint = {
        time: m.t,
        price: m.p
      };
      
      state.lastData = point;
      state.status = 'active';
      state.listeners.forEach(listener => {
        try {
          (listener as SparklineListener)(point);
        } catch (err) {
          console.error(`[DataFeed] Listener error:`, err);
        }
      });
      
    } else if (m.type === 'subscribed') {
      console.log('[DataFeed] Subscribed:', m.key);
      const subState = this.subscriptions.get(m.key);
      if (subState) subState.status = 'active';
      
    } else if (m.type === 'unsubscribed') {
      console.log('[DataFeed] Unsubscribed:', m.key);
      
    } else if (m.type === 'error') {
      console.warn('[DataFeed] Server error:', m.error, m);
      if (m.key) {
        const subState = this.subscriptions.get(m.key);
        if (subState) {
          subState.status = 'error';
          subState.error = new Error(m.message || m.error);
        }
      }
    }
  }

  private startStaleDetection() {
    this.stopStaleDetection();
    
    this.staleCheckTimer = window.setInterval(() => {
      const staleTime = Date.now() - this.lastActivity;
      
      if (staleTime > 180000) {
        console.warn(`[DataFeed] Connection stale (${Math.round(staleTime / 1000)}s)`);
        try {
          this.send({ type: 'ping' });
        } catch {
          this.ws?.close();
        }
      }
    }, 5000);
  }

  private stopStaleDetection() {
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = undefined;
    }
  }

  private handleDroppedMessages() {
    window.dispatchEvent(new CustomEvent('datafeed:dropped_messages'));
  }

  // ─────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────

  unsubscribe() {
    // Clear all cleanup timers
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    
    // Unsubscribe all on server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'unsubscribe_all' });
    }
    
    // Clear local state
    this.subscriptions.clear();
    this.q = [];
    
    this.closeWS();
  }

  unsubscribeKey(key: string) {
    const state = this.subscriptions.get(key);
    if (state) {
      // Force cleanup regardless of refCount
      this.send({ type: 'unsubscribe', key });
      this.subscriptions.delete(key);
      
      const pendingTimer = this.cleanupTimers.get(key);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.cleanupTimers.delete(key);
      }

      if (this.subscriptions.size === 0) {
        this.closeWS();
      }
    }
  }
}