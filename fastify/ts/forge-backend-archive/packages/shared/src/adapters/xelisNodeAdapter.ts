import DaemonWS, { DaemonEventsData } from '@xelis/sdk/daemon/websocket';
import * as types from '@xelis/sdk/daemon/types';
import { responseTransformers } from '../utils/types';

type ReconnectOptions = {
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: number;                 // 0..1 (±%)
  healthCheckIntervalMs: number;
};

const DEFAULT_RECONNECT: ReconnectOptions = {
  initialDelayMs: 1_000,
  maxDelayMs: 120_000,
  factor: 1.8,
  jitter: 0.2,
  healthCheckIntervalMs: 20_000,
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const jittered = (ms: number, j: number) => {
  const d = ms * j;
  return Math.max(0, Math.floor(ms - d + Math.random() * (2 * d)));
};

type ListenerFn<T> = (data?: T, err?: Error) => void;

type ContractSub = {
  contract: string;
  id: number;
  listener: ListenerFn<types.ContractEvent>;
};

type ContractEventEnvelope = {
  contract_event: { contract: string; id: number };
  data?: any;
  block_hash?: string;
  topoheight?: number;
  [k: string]: any; 
};

const waitForOpen = (ws: WebSocket, timeoutMs = 10_000) =>
  new Promise<void>((resolve, reject) => {
    if (ws.readyState === ws.OPEN) return resolve();
    const onOpen = () => { cleanup(); resolve(); };
    const onErr  = (e: any) => { cleanup(); reject(e); };
    const timer  = setTimeout(() => { cleanup(); reject(new Error('WS open timeout')); }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('open', onOpen as any);
      ws.removeEventListener('error', onErr as any);
    };
    ws.addEventListener('open', onOpen as any);
    ws.addEventListener('error', onErr as any);
  });

export class XelisNodeAdapter {
  private daemon: DaemonWS;
  private url: string;
  private opts: ReconnectOptions;
  private reconnecting = false;
  private closed = false;
  private watchdog?: NodeJS.Timeout;
  private connecting = false;

  // we only need ContractEvent right now; add maps for others if needed
  private contractSubs: ContractSub[] = [];

  private constructor(daemon: DaemonWS, url: string, opts?: Partial<ReconnectOptions>) {
    this.daemon = daemon;
    this.url = url;
    this.opts = { ...DEFAULT_RECONNECT, ...opts };
  }

  private onMsg?: (arg1: any, arg2?: any) => void;
  private onClose?: () => void;
  private onError?: () => void;

  private _bindSocketHandlers(sock?: WebSocket) {
    if (!sock) return;

    // remove old
    if (this.onClose) try { sock.removeEventListener('close', this.onClose as any); } catch {}
    if (this.onError) try { sock.removeEventListener('error', this.onError as any); } catch {}

    // create new bound fns (stable identity)
    this.onClose = () => this.reconnect('close');
    this.onError = () => this.reconnect('error');

    sock.addEventListener('close', this.onClose as any);
    sock.addEventListener('error', this.onError as any);
  }

  private _unbindSocketHandlers(sock?: WebSocket) {
    if (!sock) return;
    try { if (this.onMsg)  sock.removeEventListener('message', this.onMsg as any); } catch {}
    try { if (this.onClose) sock.removeEventListener('close',  this.onClose as any); } catch {}
    try { if (this.onError) sock.removeEventListener('error',  this.onError as any); } catch {}
  }

  /** Decode Buffer/ArrayBuffer/TypedArray/string to UTF-8 text */
  private _toText(data: any): string | undefined {
    try {
      if (typeof data === 'string') return data;
      // Node Buffer
      if ((global as any).Buffer?.isBuffer?.(data)) return (data as Buffer).toString('utf8');
      // Browser ArrayBuffer
      if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
      // TypedArray / DataView
      if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Extract a contract_event from the various response/notify shapes */
  private _extractContractEvent(msg: any): ContractEventEnvelope | undefined {
    // Case: event piggybacked on result (you logged this)
    if (msg?.result?.event?.contract_event) {
      const ce = msg.result.event.contract_event;
      const { data, block_hash, topoheight, ...rest } = msg.result;
      return { contract_event: ce, data, block_hash, topoheight, ...rest };
    }
    // notify direct
    if (msg?.method === 'notify' && msg?.params?.contract_event) {
      const { contract_event, data, block_hash, topoheight, ...rest } = msg.params;
      return { contract_event, data, block_hash, topoheight, ...rest };
    }
    // notify nested
    if (msg?.method === 'notify' && msg?.params?.notify?.contract_event) {
      const n = msg.params.notify;
      const { contract_event, data, block_hash, topoheight, ...rest } = n;
      return { contract_event, data, block_hash, topoheight, ...rest };
    }
    // result-notify nested (rare)
    if (msg?.result?.notify?.contract_event) {
      const n = msg.result.notify;
      const { contract_event, data, block_hash, topoheight, ...rest } = n;
      return { contract_event, data, block_hash, topoheight, ...rest };
    }
    // generic event wrapper
    if (msg?.method === 'notify'
        && msg?.params?.event === 'contract_event'
        && msg?.params?.data) {
      return {
        contract_event: (msg.params.contract_event ?? msg.params.event_payload ?? {}) as any,
        data: msg.params.data,
        block_hash: msg.params.block_hash,
        topoheight: msg.params.topoheight,
        ...msg.params,
      };
    }
    return undefined;
  }

  /** Deliver one extracted event to matching subscribers */
  private _fanOutContractEvent(env: ContractEventEnvelope) {
    const ce = env.contract_event;
    if (!ce?.contract || ce.id === undefined) return;

    // Deliver a backward-compatible object:
    // - .data = VM payload (so your existing handler works)
    // - .meta + .contract_event for context
    // - .raw = full envelope, if you ever need everything
    const delivered = {
      data: env.data,
      meta: { block_hash: env.block_hash, topoheight: env.topoheight },
      contract_event: env.contract_event,
      raw: env,
    };

    for (const sub of this.contractSubs) {
      if (ce.contract === sub.contract && ce.id === sub.id) {
        try { sub.listener(delivered as any); } catch (e) {
          console.error('[contractSub:listener:error]', e);
        }
      }
    }
  }

  /** Remove message listener from a socket if previously attached */
  private _detachMessage(sock: any) {
    if (!sock || !this.onMsg) return;
    try { sock.removeEventListener?.('message', this.onMsg as any); } catch {}
    try { sock.off?.('message', this.onMsg as any); } catch {}
    try { sock.removeListener?.('message', this.onMsg as any); } catch {}
  }

  /** Add message listener to a socket, supporting both DOM and Node ws */
  private _attachMessage(sock: any) {
    if (!sock || !this.onMsg) return;
    if (typeof sock.addEventListener === 'function') {
      sock.addEventListener('message', this.onMsg as any);
    } else if (typeof sock.on === 'function') {
      sock.on('message', this.onMsg as any); // node: (data, isBinary)
    }
  }

  /** (Re)wire the message pump to the current daemon socket */
  private wireMessagePump() {
    const sock = (this.daemon as any).socket;
    if (!sock) return;

    // If we were already wired, unbind to avoid duplicates
    this._detachMessage(sock);

    // One handler that accepts either (event) or (data, isBinary)
    this.onMsg = (arg1: any, arg2?: any) => {
      try {
        // Node ws: (data, isBinary). Browser: (MessageEvent) with .data
        const raw = (arg2 !== undefined // node path
          || (global as any).Buffer?.isBuffer?.(arg1)
          || typeof arg1 === 'string'
          || arg1 instanceof ArrayBuffer
          || ArrayBuffer.isView(arg1))
          ? arg1
          : arg1?.data;

        const text = this._toText(raw);
        if (!text) return;

        let msg: any;
        try { msg = JSON.parse(text); } catch { return; }

        const evt = this._extractContractEvent(msg);
        if (!evt) return;

        this._fanOutContractEvent(evt);
      } catch {
        // swallow to keep the pump alive
      }
    };

    // Bind to whichever API the socket exposes
    this._attachMessage(sock);
  }

  private async establish() {
    await waitForOpen((this.daemon as any).socket, this.opts.maxDelayMs);
    await this.daemon.methods.getInfo();
  }

  /** Create + wait for initial health check with backoff */
  static async connect(url: string, opts?: Partial<ReconnectOptions>) {
    let delay: number | undefined;
    let lastOpts: ReconnectOptions | undefined;

    for (;;) {
      let adapter: XelisNodeAdapter | undefined;

      try {
        const daemon = new DaemonWS(url);
        adapter = new XelisNodeAdapter(daemon, url, opts);
        adapter.connecting = true;

        lastOpts = adapter.opts;
        if (delay === undefined) delay = adapter.opts.initialDelayMs;

        await adapter.establish();
        adapter.connecting = false;

        adapter.wireMessagePump();
        const sock = (adapter.daemon as any).socket;
        
        adapter._bindSocketHandlers(sock);
        adapter.startWatchdog();

        console.info(
          `[connect] successfully established connection to ${url}`
        );

        return adapter;
      } catch (e) {
        try { await (adapter as any)?.daemon?.socket?.close(); } catch {}

        const o = lastOpts!;
        const wait = jittered(Math.min(delay ?? o.initialDelayMs, o.maxDelayMs), o.jitter);

        const secs = (wait / 1000).toFixed(1);
        console.warn(
          `[connect] failed to establish: ${(e as Error).message}. Retrying in ${secs}s…`
        );

        await sleep(wait);
        delay = Math.min(Math.floor((delay ?? o.initialDelayMs) * o.factor), o.maxDelayMs);
      }
    }
  }

  private async ensureConnected() {
    if (this.closed) throw new Error('Adapter is closed');
    try {
      await this.establish();
    } catch {
      await this.reconnect('health-check failed');
    }
  }

  private async reconnect(_reason: string) {
    if (this.reconnecting || this.closed || this.connecting) return;
    this.reconnecting = true;

    let delay = this.opts.initialDelayMs;
    try {
      for (;;) {
        if (this.closed) return;
        try {
          const oldSock = (this.daemon as any).socket as WebSocket | undefined;
          this._unbindSocketHandlers(oldSock);
          try { await oldSock?.close(); } catch {}

          this.daemon = new DaemonWS(this.url);
          await this.establish();

          this.wireMessagePump();
          const sock = (this.daemon as any).socket;
          
          this._bindSocketHandlers(sock);

          await this.resubscribeAll();
          this.startWatchdog();

          console.info(
            `[reconnect] successfully re-established connection to ${this.url}`
          );

          return;
        } catch(e) {
          const wait = jittered(Math.min(delay, this.opts.maxDelayMs), this.opts.jitter);
          const secs = (wait / 1000).toFixed(1);
          console.warn(
            `[reconnect] attempt failed: ${(e as Error).message}. Retrying in ${secs}s…`
          );

          await sleep(wait);
          delay = Math.min(Math.floor(delay * this.opts.factor), this.opts.maxDelayMs);
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(async () => {
      if (this.closed) return;
      try {
        await this.daemon.methods.getInfo();
      } catch {
        await this.reconnect('watchdog');
      }
    }, this.opts.healthCheckIntervalMs);
    (this.watchdog as any).unref?.();
  }

  private async resubscribeAll() {
    for (const { contract, id } of this.contractSubs) {
      await this.daemon.methods
        .dataCall('subscribe', { notify: { contract_event: { contract, id } } })
        .catch(e => console.error('[resubscribe:error]', contract, id, e));
    }
  }

  async close() {
    this.closed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this._unbindSocketHandlers((this.daemon as any).socket);
    try { await (this.daemon as any).socket?.close(); } catch {}
  }

  // ---------- env helpers ----------
  async getRouterContract(): Promise<string | undefined> {
    return process.env.ROUTER_CONTRACT || undefined;
  }
  async getFactoryContract(): Promise<string | undefined> {
    return process.env.FACTORY_CONTRACT || undefined;
  }

  // ---------- RPC wrappers ----------
  async getContractData(params: types.GetContractDataPrams): Promise<types.GetContractDataResult> {
    await this.ensureConnected();
    const raw = await this.daemon.dataCall('get_contract_data', params) as types.GetContractDataResult;
    return responseTransformers.contractDataTransformer(raw) as types.GetContractDataResult;
  }

  async getContractAssets(contract: string): Promise<string[]> {
    await this.ensureConnected();
    const res = await this.daemon.dataCall('get_contract_assets', { contract });
    return res as string[];
  }

  async getAsset(params: types.GetAssetParams): Promise<types.AssetData> {
    await this.ensureConnected();
    return await this.daemon.dataCall('get_asset', params) as types.AssetData;
  }

  async getAssetSupply(params: types.GetAssetParams) {
    await this.ensureConnected();
    return await this.daemon.dataCall('get_asset_supply', params);
  }

  // ---------- Event wrapper (filter by contract + id) ----------
  onContractEvent(
    contract: string,
    id: number,
    handler: (data: DaemonEventsData[types.RPCEvent.ContractEvent]) => void,
  ) {
    const listener: ListenerFn<DaemonEventsData[types.RPCEvent.ContractEvent]> = (res, err) => {
      if (err || !res) return;
      handler(res as any);
    };

    this.contractSubs.push({ contract, id, listener });

    this.ensureConnected().finally(() => {
      this.daemon
        .dataCall('subscribe', { notify: { contract_event: { contract, id } } })
        .catch((e) => console.error('[subscribe:error]', e));
    });

    return () => {
      this.daemon
        .dataCall('unsubscribe', { notify: { contract_event: { contract, id } } })
        .catch((e) => console.error('[unsubscribe:error]', e));

      const i = this.contractSubs.findIndex(s => s.listener === listener);
      if (i >= 0) this.contractSubs.splice(i, 1);
    };
  }
}
