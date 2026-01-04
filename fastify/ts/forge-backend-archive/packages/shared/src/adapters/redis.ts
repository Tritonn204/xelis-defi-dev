import { fromEnvOrFile } from '@forge-backend/shared/utils/env';
import { createClient } from 'redis';
import dns from 'node:dns';
import { EventEmitter } from 'events';
import { createRequire } from 'node:module';

// ---------- env ----------
const REDIS_URL =
  fromEnvOrFile('REDIS_URL') ||
  (process.env.REDIS_HOST
    ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
    : 'redis://127.0.0.1:6379');

const REDIS_PASS =
  fromEnvOrFile('REDIS_PASS') ||
  fromEnvOrFile('REDIS_PASSWORD') ||
  '';

const REDIS_SENTINEL_PASSWORD =
  process.env.REDIS_SENTINEL_PASSWORD || REDIS_PASS;

const REDIS_SENTINELS = (process.env.REDIS_SENTINELS || '').trim(); // "host:26379,host:26379"
const REDIS_SENTINEL_SERVICE = process.env.REDIS_SENTINEL_SERVICE || ''; // DNSRR service name
const REDIS_SENTINEL_PORT = Number(process.env.REDIS_SENTINEL_PORT || 26379);
const REDIS_MASTER_NAME = process.env.REDIS_MASTER_NAME || 'mymaster';

// ---------- single-node socket tune ----------
const socket = {
  reconnectStrategy: (r: number) => Math.min(200 * r, 10_000),
  keepAlive: true,
  noDelay: true,
};
const common = { socket, disableOfflineQueue: true };

const PING_INTERVAL_CMD_MS = 15_000;
const PING_INTERVAL_SUB_MS = 30_000;

// ---------- API surface your code uses ----------
export type SetOptions = {
  EX?: number;       // seconds
  PX?: number;       // milliseconds
  NX?: boolean;
  XX?: boolean;
  KEEPTTL?: boolean;
};

// ---------- helpers (ioredis SET options -> argv) ----------
function toIORedisSetArgs(opts?: SetOptions): (string | number)[] {
  if (!opts) return [];
  const args: (string | number)[] = [];
  if (opts.KEEPTTL) args.push('KEEPTTL');
  if (opts.NX) args.push('NX');
  if (opts.XX) args.push('XX');
  if (typeof opts.EX === 'number') args.push('EX', opts.EX);
  if (typeof opts.PX === 'number') args.push('PX', opts.PX);
  return args;
}

type Redisish = {
  connect: () => Promise<void>;
  quit: () => Promise<void>;
  ping: () => Promise<string>;
  on: (ev: string, fn: (...args: any[]) => void) => any;

  eval: (script: string, opts: { keys: string[]; arguments: string[] }) => Promise<any>;
  zAdd: (key: string, members: { score: number; value: string }[]) => Promise<number>;
  hSet: (key: string, map: Record<string, string>) => Promise<number>;
  hGet: (key: string, field: string) => Promise<string | null>;
  sAdd: (key: string, member: string) => Promise<number>;
  setNX: (key: string, val: string) => Promise<boolean>;
  expire: (key: string, ttlSec: number) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, val: string, options?: SetOptions) => Promise<'OK' | null>;
  del: (key: string) => Promise<number>;
  publish: (channel: string, message: string) => Promise<number>;
  pipeline?: () => any;
  multi?: () => any;
  evalsha?: (sha: string, opts: { keys: string[]; arguments: string[] }) => Promise<any>;
  subscribe: (channel: string, callback: (message: string, channel: string) => void) => Promise<void>;
  unsubscribe: (channel: string) => Promise<void>;
  pSubscribe?: (pattern: string, callback: (message: string, channel: string) => void) => Promise<void>;
  pUnsubscribe?: (pattern: string) => Promise<void>;
};

// ---------- adapters (typed as any to avoid node-redis v5 generics friction) ----------
function adaptNodeRedis(c: any): Redisish {
  const channelCallbacks = new Map<string, (message: string, channel: string) => void>();

  c.on('message', (channel: string, message: string) => {
    const callback = channelCallbacks.get(channel);
    if (callback) callback(message, channel);
  });

  return {
    connect: () => c.connect().then(() => undefined), // normalize to void
    quit: () => c.quit().then(() => undefined),
    ping: () => c.ping(),
    on: (ev, fn) => c.on(ev, fn),

    eval: (script, { keys, arguments: args }) => c.eval(script, { keys, arguments: args }),
    zAdd: (key, members) => c.zAdd(key, members),
    hSet: (key, map) => c.hSet(key, map),
    hGet: (key, field) => c.hGet(key, field),
    sAdd: (key, member) => c.sAdd(key, member),
    setNX: (key, val) => c.setNX(key, val),
    expire: (key, ttl) => c.expire(key, ttl),
    get: (key) => c.get(key),
    set: (key, val, options?: SetOptions) => c.set(key, val, options),
    del: (key) => c.del(key),
    publish: (channel, message) => c.publish(channel, message),
    pipeline: typeof c.pipeline === 'function' ? () => c.pipeline() : undefined,
    multi: typeof c.multi === 'function' ? () => c.multi() : undefined,
    evalsha: typeof c.evalSha === 'function'
      ? (sha, { keys, arguments: args }) => c.evalSha(sha, { keys, arguments: args })
      : undefined,
    
    // Proper node-redis v4+ pub/sub implementation
    subscribe: async (channel: string, callback: (message: string, channel: string) => void) => {
      // node-redis v4+ passes the message as the first param, channel as second
      await c.subscribe(channel, (message: string) => {
        callback(message, channel);
      });
    },
    
    unsubscribe: async (channel: string) => {
      await c.unsubscribe(channel);
    },
    
    pSubscribe: async (pattern: string, callback: (message: string, channel: string) => void) => {
      await c.pSubscribe(pattern, (message: string, channel: string) => {
        callback(message, channel);
      });
    },
    
    pUnsubscribe: async (pattern: string) => {
      await c.pUnsubscribe(pattern);
    },
  };
}

function adaptIORedis(c: any): Redisish {
  const channelCallbacks = new Map<string, (message: string, channel: string) => void>();

  c.on('message', (channel: string, message: string) => {
    const callback = channelCallbacks.get(channel);
    if (callback) callback(message, channel);
  });
  
  c.on('pmessage', (pattern: string, channel: string, message: string) => {
    const callback = channelCallbacks.get(pattern);
    if (callback) callback(message, channel);
  });

  return {
    connect: async () => { await c.connect(); },
    quit: async () => { await c.quit(); },
    ping: () => c.ping(),
    on: (ev, fn) => c.on(ev as any, fn),

    eval: (script, { keys, arguments: args }) => c.eval(script, keys.length, ...keys, ...(args ?? [])),
    zAdd: (key, members) => c.zadd(key, ...(members.flatMap(m => [m.score, m.value]) as any)),
    hSet: (key, map) => c.hset(key, map as any),
    hGet: (key, field) => c.hget(key, field),
    sAdd: (key, member) => c.sadd(key, member),
    setNX: async (key, val) => (await c.set(key, val, 'NX')) === 'OK',
    expire: (key, ttl) => c.expire(key, ttl),
    get: (key) => c.get(key),
    set: (key, val, options?: SetOptions) => (c.set as any)(key, val, ...toIORedisSetArgs(options)),
    del: (key) => c.del(key),
    publish: (channel, message) => c.publish(channel, message),
    pipeline: typeof c.pipeline === 'function' ? () => c.pipeline() : undefined,
    multi: typeof c.multi === 'function' ? () => c.multi() : undefined,
    evalsha: typeof c.evalsha === 'function'
      ? (sha, { keys, arguments: args }) => c.evalsha(sha, keys.length, ...keys, ...(args ?? []))
      : undefined,
    
    subscribe: async (channel: string, callback: (message: string, channel: string) => void) => {
      channelCallbacks.set(channel, callback);
      await c.subscribe(channel);
    },
    
    unsubscribe: async (channel: string) => {
      channelCallbacks.delete(channel);
      await c.unsubscribe(channel);
    },
    
    pSubscribe: async (pattern: string, callback: (message: string, channel: string) => void) => {
      channelCallbacks.set(pattern, callback);
      await c.psubscribe(pattern);
    },
    
    pUnsubscribe: async (pattern: string) => {
      channelCallbacks.delete(pattern);
      await c.punsubscribe(pattern);
    },
  };
}

// ---------- sentinel discovery ----------
async function parseExplicitSentinels(): Promise<{ host: string; port: number }[] | null> {
  if (!REDIS_SENTINELS) return null;
  return REDIS_SENTINELS.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [host, p] = s.split(':');
    return { host, port: Number(p || 26379) };
  });
}

async function discoverSentinels(): Promise<{ host: string; port: number }[]> {
  const explicit = await parseExplicitSentinels();
  if (explicit && explicit.length) return explicit;

  if (!REDIS_SENTINEL_SERVICE) return [];
  try {
    // requires sentinel service with endpoint_mode: dnsrr
    const addrs = await dns.promises.lookup(REDIS_SENTINEL_SERVICE, { all: true, verbatim: false });
    if (addrs.length) return addrs.map(a => ({ host: a.address, port: REDIS_SENTINEL_PORT }));
  } catch { /* ignore */ }
  return [{ host: REDIS_SENTINEL_SERVICE, port: REDIS_SENTINEL_PORT }];
}

// ---------- state / events ----------
export const redisEvents = new EventEmitter();

let implCmd: Redisish | null = null;
let implSub: Redisish | null = null;

let ready = false;
let subReady = false;
let lastOKAt = 0;

let cmdPingTimer: NodeJS.Timeout | undefined;
let subPingTimer: NodeJS.Timeout | undefined;

function startHeartbeat(client: Redisish, label: 'cmd' | 'sub', intervalMs: number, onOk?: () => void) {
  stopHeartbeat(label);
  const t = setInterval(async () => {
    try { const pong = await client.ping(); if (pong === 'PONG') onOk?.(); } catch {}
  }, intervalMs);
  if (label === 'cmd') cmdPingTimer = t; else subPingTimer = t;
}
function stopHeartbeat(label: 'cmd' | 'sub') {
  const t = label === 'cmd' ? cmdPingTimer : subPingTimer;
  if (t) clearInterval(t);
  if (label === 'cmd') cmdPingTimer = undefined; else subPingTimer = undefined;
}

function wireEvents(c: Redisish, which: 'cmd' | 'sub') {
  const tag = which === 'cmd' ? 'redis' : 'redisSub';
  c.on('connect', () => console.log(`[${tag}] connect`));
  c.on('ready', () => {
    if (which === 'cmd') {
      ready = true;
      console.log('[redis] ready');
      startHeartbeat(c, 'cmd', PING_INTERVAL_CMD_MS, markRedisOK);
      redisEvents.emit('ready');
    } else {
      subReady = true;
      console.log('[redisSub] ready');
      startHeartbeat(c, 'sub', PING_INTERVAL_SUB_MS);
      redisEvents.emit('sub:ready');
    }
  });
  // node-redis emits 'end'; ioredis emits 'close'
  c.on('end', () => {
    if (which === 'cmd') { ready = false; stopHeartbeat('cmd'); console.warn('[redis] end'); redisEvents.emit('end'); }
    else { subReady = false; stopHeartbeat('sub'); console.warn('[redisSub] end'); redisEvents.emit('sub:end'); }
  });
  c.on('close', () => {
    if (which === 'cmd') { ready = false; stopHeartbeat('cmd'); console.warn('[redis] close'); redisEvents.emit('end'); }
    else { subReady = false; stopHeartbeat('sub'); console.warn('[redisSub] close'); redisEvents.emit('sub:end'); }
  });
  c.on('error', (e: any) => console.error(`[${tag}]`, e));
}

async function tryInitSentinel(): Promise<boolean> {
  const sentinels = await discoverSentinels();
  if (!sentinels.length) return false;

  console.log('[redis] trying sentinel', `name=${REDIS_MASTER_NAME}`, 'endpoints=', sentinels.map(s => `${s.host}:${s.port}`).join(','));

  // Load ioredis at runtime to avoid ESM bundler "dynamic require" issues
  const require = createRequire(import.meta.url);
  let IOR: any;
  try {
    IOR = require('ioredis'); // CJS module; Node resolves builtins (events) fine
  } catch (e) {
    console.warn('[redis] ioredis not available, falling back to single-node:', (e as Error)?.message);
    return false;
  }
  const RedisCtor = IOR.default || IOR; // default export in TS, function/class in CJS

  const opts: any = {
    sentinels,
    name: REDIS_MASTER_NAME,
    password: REDIS_PASS || undefined,
    sentinelPassword: REDIS_SENTINEL_PASSWORD || undefined,
    enableOfflineQueue: false,
    retryStrategy: (ms: number) => Math.min(ms + 200, 10_000),
    keepAlive: 1,
    noDelay: true,
    lazyConnect: true,
  };

  const c1 = new RedisCtor(opts);
  const c2 = new RedisCtor(opts);
  const a1 = adaptIORedis(c1);
  const a2 = adaptIORedis(c2);

  try {
    implCmd = a1;
    implSub = a2;
    wireEvents(implCmd, 'cmd');
    wireEvents(implSub, 'sub');
    await a1.connect(); // ensures connectivity + master resolution
    console.log('[redis] sentinel mode engaged');
    return true;
  } catch (e: any) {
    console.warn('[redis] sentinel connect failed, falling back:', e?.message ?? e);
    try { await c1.quit(); } catch {}
    try { await c2.quit(); } catch {}
    implCmd = null;
    implSub = null;
    return false;
  }
}

function initSingle() {
  console.log('[redis] single mode url=', REDIS_URL);
  const c1: any = createClient({ url: REDIS_URL, ...common });
  const c2: any = createClient({ url: REDIS_URL, ...common });
  implCmd = adaptNodeRedis(c1);
  implSub = adaptNodeRedis(c2);
  wireEvents(implCmd, 'cmd');
  wireEvents(implSub, 'sub');
}

let initOnce: Promise<void> | null = null;
async function initIfNeeded() {
  if (initOnce) return initOnce;
  initOnce = (async () => {
    // prefer sentinel if configured; fall back to single
    if (REDIS_SENTINEL_SERVICE || REDIS_SENTINELS) {
      const ok = await tryInitSentinel();
      if (!ok) initSingle();
    } else {
      initSingle();
    }
  })();
  return initOnce;
}

// ---------- exported health helpers ----------
export function isRedisReady(): boolean { return ready; }
export function isRedisSubReady(): boolean { return subReady; }
export function markRedisOK() { lastOKAt = Date.now(); }
export function wasRedisOKWithin(windowMs = 2000): boolean {
  return lastOKAt > 0 && (Date.now() - lastOKAt) <= windowMs;
}

export async function isRedisHealthy(timeoutMs = 750): Promise<boolean> {
  await initIfNeeded();
  if (!isRedisReady()) return false;
  try {
    const pong = await Promise.race([
      implCmd!.ping(),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('redis_timeout')), timeoutMs)),
    ]);
    if (pong === 'PONG') { markRedisOK(); return true; }
  } catch {}
  return false;
}

// ---------- ensure & close ----------
export async function ensureRedis(): Promise<Redisish> {
  await initIfNeeded();
  if (!ready) await implCmd!.connect();
  return implCmd!;
}
export async function ensureRedisSub(): Promise<Redisish> {
  await initIfNeeded();
  if (!subReady) await implSub!.connect();
  return implSub!;
}
export async function closeRedis(): Promise<void> {
  try { await initIfNeeded(); await implCmd?.quit(); } catch {}
}
export async function closeRedisSub(): Promise<void> {
  try { await initIfNeeded(); await implSub?.quit(); } catch {}
}

// ---------- exported facades (compat with `import { redis } ...`) ----------
export const redis: Redisish = new Proxy({} as any, {
  get(_t, prop: keyof Redisish) {
    return async (...args: any[]) => {
      const c = await ensureRedis();
      // @ts-ignore
      return c[prop](...args);
    };
  }
});

export const redisSub: Redisish = new Proxy({} as any, {
  get(_t, prop: keyof Redisish) {
    return async (...args: any[]) => {
      const c = await ensureRedisSub();
      // @ts-ignore
      return c[prop](...args);
    };
  }
});
