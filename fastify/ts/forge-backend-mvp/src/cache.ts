type Entry = { v: any; exp: number };
export class TinyLRU {
  private map = new Map<string, Entry>();
  constructor(private max = 512) {}
  get(k: string) {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp && e.exp < Date.now()) { this.map.delete(k); return undefined; }
    // bump recency
    this.map.delete(k); this.map.set(k, e);
    return e.v;
    }
  set(k: string, v: any, ttlMs = 15000) {
    if (this.map.size >= this.max) {
      // evict LRU (oldest in iteration order)
      const first = this.map.keys().next().value;
      if (first) this.map.delete(first);
    }
    this.map.set(k, { v, exp: ttlMs ? Date.now() + ttlMs : 0 });
  }
}

export class Singleflight {
  private inflight = new Map<string, Promise<any>>();
  async do<T>(key: string, fn: ()=>Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}