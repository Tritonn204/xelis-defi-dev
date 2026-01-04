import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

export type Quote = { price: number; ts: number; source?: string };
export class PriceHub extends EventEmitter {
  private quotes = new Map<string, Quote>();
  private saveTimer?: NodeJS.Timeout;
  constructor(private snapshotPath: string) { super(); }

  private key(sym: string) { return String(sym).toUpperCase(); }

  async load() {
    try {
      const dir = path.dirname(this.snapshotPath);
      await fs.mkdir(dir, { recursive: true });
      const raw = await fs.readFile(this.snapshotPath, 'utf8');
      const arr = JSON.parse(raw) as Array<{ symbol: string } & Quote>;
      for (const r of arr) this.quotes.set(this.key(r.symbol), { price: r.price, ts: r.ts, source: r.source });
    } catch { /* empty on first run */ }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = undefined;
      try {
        const arr = Array.from(this.quotes, ([symbol, q]) => ({ symbol, ...q }));
        await fs.writeFile(this.snapshotPath, JSON.stringify(arr, null, 2));
      } catch {}
    }, 2000);
  }

  set(symbol: string, price: number, source?: string) {
    const sym = this.key(symbol);
    const q = { price, ts: Date.now(), source };
    this.quotes.set(sym, q);
    this.scheduleSave();
    this.emit('quote', { symbol: sym, ...q });        // in-process fanout
  }

  get(symbol: string): Quote | null {
    return this.quotes.get(this.key(symbol)) ?? null;
  }

  list(): Array<{ symbol: string } & Quote> {
    return Array.from(this.quotes, ([symbol, q]) => ({ symbol, ...q }));
  }

  registerRoutes(app: FastifyInstance) {
    // GET /v1/quote?symbol=BASE_QUOTE
    app.get('/v1/quote', async (req, reply) => {
      const sym = String((req.query as any).symbol || '').toUpperCase();
      if (!sym) return reply.code(400).send({ error: 'missing_symbol' });
      const q = this.get(sym);
      if (!q) return reply.code(404).send({ error: 'not_found' });
      return { symbol: sym, ...q };
    });

    app.get('/v1/quotes', async () => ({ quotes: this.list(), updatedAt: Date.now() }));

    // SSE stream of updates (newline-delimited JSON)
    app.get('/v1/quotes/stream', async (req, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (ev: any) => reply.raw.write(`data:${JSON.stringify(ev)}\n\n`);
      const onQuote = (payload: any) => send(payload);
      this.on('quote', onQuote);
      // push a snapshot first
      send({ type: 'snapshot', quotes: this.list(), ts: Date.now() });

      req.raw.on('close', () => this.off('quote', onQuote));
    });
  }
}
