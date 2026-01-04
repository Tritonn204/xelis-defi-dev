import type { Pool, PoolClient, QueryConfig, QueryResult } from 'pg';

/** Internal symbol to avoid double wrapping */
const WRAPPED = Symbol('pg_query_wrapped');

type Queryable = {
  query: Pool['query'] | PoolClient['query'];
};

export type PgInstrumentOptions = {
  sampleFirstRow?: boolean;  // default true
  maxQueryLen?: number;      // default 180 chars
  logParams?: boolean;       // default true
  enabled?: boolean;         // default true
  tag?: string;              // optional label in logs
};

const defaults: Required<PgInstrumentOptions> = {
  sampleFirstRow: true,
  maxQueryLen: 180,
  logParams: true,
  enabled: true,
  tag: 'sql',
};

function shortenQuery(text: string, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function safeJson(v: any): string {
  try {
    return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
  } catch {
    return '[unserializable]';
  }
}

function extractTextAndParams(args: any[]): { text: string; params: any[] } {
  // Supports: (text), (text, values), ({ text, values, ... })
  if (typeof args[0] === 'string') {
    return { text: args[0], params: Array.isArray(args[1]) ? args[1] : [] };
  }
  const cfg: QueryConfig | undefined = args[0];
  if (cfg && typeof (cfg as any).text === 'string') {
    return { text: (cfg as any).text, params: Array.isArray((cfg as any).values) ? (cfg as any).values! : [] };
  }
  return { text: String(args[0]), params: [] };
}

/** Wraps a single Queryable (Pool or Client) once. */
export function wrapQueryableOnce(q: Queryable, opts?: PgInstrumentOptions): void {
  const options = { ...defaults, ...(opts || {}) };
  if (!options.enabled) return;

  // @ts-ignore – attach non-enumerable marker
  if ((q as any)[WRAPPED]) return;

  const original: any = (q as any).query;
  if (typeof original !== 'function') return;

  (q as any).query = async function instrumentedQuery(...args: any[]): Promise<QueryResult<any>> {
    const t0 = Date.now();
    let text = '';
    let params: any[] = [];
    try {
      const meta = extractTextAndParams(args);
      text = meta.text;
      params = meta.params;

      const res: QueryResult<any> = await original.apply(this, args);
      const dt = Date.now() - t0;

      // Logging must never throw
      try {
        const rc = typeof res?.rowCount === 'number'
          ? res.rowCount
          : (Array.isArray(res.rows) ? res.rows.length : 0);

        const head = Array.isArray(res.rows) && res.rows.length > 0 ? res.rows[0] : undefined;
        const parts = [
          `[${options.tag}]`,
          shortenQuery(text, options.maxQueryLen),
          `rows=${rc}`,
          `time=${dt}ms`,
        ];
        if (options.logParams && params && params.length > 0) {
          parts.splice(1, 0, `params=${safeJson(params)}`);
        }
        if (options.sampleFirstRow && head) {
          parts.push(`sample=${safeJson(head)}`);
        }
        // eslint-disable-next-line no-console
        if (rc > 0)
          console.log(parts.join(' '));
      } catch (logErr) {
        // eslint-disable-next-line no-console
        console.warn('[sql-log] format-failed:', (logErr as any)?.message ?? logErr);
      }

      return res;
    } catch (err: any) {
      const dt = Date.now() - t0;
      try {
        const parts = [
          `[${options.tag}] ERROR`,
          shortenQuery(text, options.maxQueryLen),
          `time=${dt}ms`,
          `err=${err?.message ?? err}`,
        ];
        if (options.logParams && params && params.length > 0) {
          parts.splice(2, 0, `params=${safeJson(params)}`);
        }
        // eslint-disable-next-line no-console
        console.error(parts.join(' '));
      } catch { /* ignore */ }
      throw err;
    }
  };

  Object.defineProperty(q as any, WRAPPED, { value: true, enumerable: false });
}

/**
 * Public entry: instrument a Pool.
 * - Wraps pool.query
 * - Also wraps each checked-out client via pool's 'connect' event (without overriding pool.connect)
 */
export function instrumentPg(pool: Pool, opts?: PgInstrumentOptions): void {
  wrapQueryableOnce(pool as unknown as Queryable, opts);
  pool.on('connect', (client: PoolClient) => {
    wrapQueryableOnce(client as unknown as Queryable, opts);
  });
}
