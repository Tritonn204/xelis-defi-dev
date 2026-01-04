import { useEffect, useRef, useState } from 'react';

export type Resolution = '1'|'5'|'15'|'60'|'240'|'1D'|'1W'|'1M';
export type Candle = { time:number; open:number; high:number; low:number; close:number; volume?:number };

const API_HTTP = import.meta.env.VITE_API_HTTP ?? window.location.origin;
const API_WS   = import.meta.env.VITE_API_WS   ?? window.location.origin.replace(/^http/, 'ws');

const windowSec = (res: Resolution) => ({
  '1': 24*60*60,  '5': 7*24*60*60, '15':14*24*60*60, '60':60*24*60*60,
  '240':180*24*60*60, '1D':365*24*60*60, '1W':2*365*24*60*60, '1M':5*365*24*60*60,
}[res]);

export function useCandles(symbol: string, resolution: Resolution) {
  const [data, setData] = useState<Candle[]>([]);
  const wsRef = useRef<WebSocket>(undefined);

  useEffect(() => {
    let dead = false;

    async function load() {
      const now = Math.floor(Date.now()/1000);
      const from = now - windowSec(resolution);
      const url = new URL(`${API_HTTP}/tv/history`);
      url.searchParams.set('symbol', symbol);
      url.searchParams.set('resolution', resolution);
      url.searchParams.set('from', String(from));
      url.searchParams.set('to', String(now));
      url.searchParams.set('live', '1');

      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      if (dead) return;

      if (j.s !== 'ok') { setData([]); return; }
      const base: Candle[] = j.t.map((t:number, i:number) => ({
        time: t, open: j.o[i], high: j.h[i], low: j.l[i], close: j.c[i], volume: j.v?.[i],
      }));
      setData(base);

      // WS live
      try { wsRef.current?.close(); } catch {}
      const wurl = new URL(`${API_WS}/ws`);
      wurl.searchParams.set('symbol', symbol);
      wurl.searchParams.set('res', resolution);
      const ws = new WebSocket(wurl);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        if (dead) return;
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'bar' && m.bar) {
            const b = m.bar as { t:number,o:number,h:number,l:number,c:number,v:number };
            setData(prev => {
              if (!prev.length) return [{ time:b.t, open:b.o, high:b.h, low:b.l, close:b.c, volume:b.v }];
              const last = prev[prev.length-1];
              if (last.time === b.t) {
                const upd = { time:b.t, open:b.o, high:b.h, low:b.l, close:b.c, volume:b.v };
                const next = prev.slice(); next[next.length-1] = upd; return next;
              } else {
                return [...prev, { time:b.t, open:b.o, high:b.h, low:b.l, close:b.c, volume:b.v }];
              }
            });
          }
        } catch {}
      };
      ws.onclose = () => {
        if (dead) return;
        setTimeout(load, 1000);
      };
    }

    load();
    return () => { dead = true; try { wsRef.current?.close(); } catch {} };
  }, [symbol, resolution]);

  return data;
}