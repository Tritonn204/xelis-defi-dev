import React, { useEffect, useMemo, useRef, useState } from 'react';

type SparklinePoint = { t: number; p: number };

type Props = {
  // Data selection (backed by your /v1/sparkline)
  symbol?: string;
  base?: string;
  quote?: string;                  // default 'XEL'
  window?: '1h'|'24h'|'1w';        // time window; note: NOT the JS window

  className?: string;
  width?: number | string;         // px or '100%' (default)
  height?: number;                 // default 42

  // Gradient line (left → right)
  strokeFrom?: string;             // default '#462013'
  strokeTo?: string;               // default '#ffffff'
  lineWidth?: number;              // default 2.6

  // Optional under-fill (top → bottom)
  showArea?: boolean;              // default false
  areaFrom?: string;               // default = strokeTo
  areaTo?: string;                 // default = strokeTo
  areaOpacityTop?: number;         // default 0.18
  areaOpacityBottom?: number;      // default 0.03

  // Edge fade (mask)
  edgeFade?: boolean;              // default true

  // Tooltip
  useUTC?: boolean;                // default false (local time)
  valueFormatter?: (v:number)=>string;

  // Polling
  refreshMs?: number;              // default 30000

  // Smoothing
  smooth?: 'none' | 'ema';         // default 'none'
  emaPeriod?: number;              // default 8
};

const API_HTTP = import.meta.env.VITE_API_HTTP ?? globalThis.location?.origin ?? '';

function useUID(prefix = 'spark') {
  const ref = useRef<string|undefined>(undefined);
  if (!ref.current) ref.current = `${prefix}-${Math.random().toString(36).slice(2,8)}`;
  return ref.current;
}

function emaPoints(pts: SparklinePoint[], period = 8): SparklinePoint[] {
  if (pts.length === 0) return pts;
  const k = 2 / (period + 1);
  let last = pts[0].p;
  const out: SparklinePoint[] = [{ t: pts[0].t, p: last }];
  for (let i = 1; i < pts.length; i++) {
    last = (pts[i].p - last) * k + last;
    out.push({ t: pts[i].t, p: last });
  }
  return out;
}

function mergePoints(prev: SparklinePoint[], next: SparklinePoint[]) {
  if (!prev.length) return next;
  if (!next.length) return prev;

  const prevFirstT = prev[0].t;
  const prevLastT  = prev[prev.length - 1].t;
  const nextFirstT = next[0].t;

  // If new data starts before our series (schema/window changed), replace.
  if (nextFirstT <= prevFirstT) return next;

  // Merge by timestamp, replacing overlaps and appending newer.
  const byT = new Map<number, SparklinePoint>();
  for (const p of prev) byT.set(p.t, p);
  for (const p of next) byT.set(p.t, p);
  const merged = Array.from(byT.values()).sort((a,b)=>a.t-b.t);

  // Keep only from our original start
  const startIdx = merged.findIndex(p => p.t >= prevFirstT);
  const trimmed = startIdx > 0 ? merged.slice(startIdx) : merged;

  // If nothing strictly newer than prevLastT, return trimmed.
  if (trimmed[trimmed.length - 1].t <= prevLastT) return trimmed;

  return trimmed;
}

export const Sparkline: React.FC<Props> = ({
  symbol,
  base,
  quote = 'XEL',
  window: timeWindow = '24h',      // alias to avoid shadowing global window

  className,
  width = '100%',
  height = 42,

  strokeFrom = '#462013',
  strokeTo   = '#ffffff',
  lineWidth  = 2.6,

  showArea = false,
  areaFrom,
  areaTo,
  areaOpacityTop = 0.18,
  areaOpacityBottom = 0.03,

  edgeFade = true,

  useUTC = false,
  valueFormatter,
  refreshMs = 30_000,

  smooth = 'none',
  emaPeriod = 8,
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w:number; h:number }>({ w: 0, h: height });
  const [points, setPoints] = useState<SparklinePoint[]>([]);
  const [hover, setHover] = useState<{ x:number; idx:number } | null>(null);

  // stale state + watchdog
  const [stale, setStale] = useState(false);
  const watchdogRef = useRef<number | null>(null);
  function armWatchdog(ms: number) {
    if (watchdogRef.current) globalThis.clearTimeout(watchdogRef.current);
    watchdogRef.current = globalThis.setTimeout(() => setStale(true), ms) as unknown as number;
  }

  // unique ids
  const gradStrokeId = useUID('grad-stroke');
  const areaFillId   = useUID('grad-area');
  const edgeGradId   = useUID('edge-grad');
  const edgeMaskId   = useUID('edge-mask');

  // measure width when width is fluid
  useEffect(() => {
    if (typeof width === 'number') {
      setSize({ w: width, h: height });
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(1, Math.floor(el.clientWidth)), h: height });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [width, height]);

  // keep height in state when prop changes
  useEffect(() => { setSize(s => ({ ...s, h: height })); }, [height]);

  // Build a key for resets when query changes
  const queryKey = useMemo(() => {
    const sym = symbol
      ? symbol.toUpperCase()
      : `${(base||'').toUpperCase()}_${(quote||'XEL').toUpperCase()}`;
    return `${sym}:${timeWindow}`;
  }, [symbol, base, quote, timeWindow]);

  // fetch sparkline data (env-based API, symbol OR base/quote)
  useEffect(() => {
    // Reset only when the query changes
    setPoints([]);
    setStale(false);
    if (watchdogRef.current) { globalThis.clearTimeout(watchdogRef.current); watchdogRef.current = null; }

    const qs = new URLSearchParams();
    if (symbol) qs.set('symbol', symbol.toUpperCase());
    else qs.set('symbol', `${(base||'').toUpperCase()}_${(quote||'XEL').toUpperCase()}`);
    qs.set('window', timeWindow);

    let dead = false;
    let timer: number | null = null;
    let backoff = 800;
    const maxBackoff = 6000;
    const watchdogMs = Math.max(refreshMs * 2 + 10_000, 70_000); // ~2× cadence

    const load = async () => {
      try {
        const r = await fetch(`${API_HTTP}/v1/sparkline?${qs}`, {
          cache: 'no-store',
          credentials: 'omit',
        });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (dead) return;

        if (j.s === 'ok') {
          const tArr: number[] = j.t || [];
          const pArr: number[] = j.p || [];
          const incoming: SparklinePoint[] = tArr
            .map((t, i) => ({ t, p: pArr[i] }))
            .filter(pt => Number.isFinite(pt.t) && Number.isFinite(pt.p));

          if (incoming.length) {
            setPoints(prev => mergePoints(prev, incoming));
            setStale(false);
            armWatchdog(watchdogMs);
          }
        }
        // On success, schedule normally and reset backoff
        backoff = 800;
        scheduleNext(refreshMs);
      } catch {
        // On error: keep last points, retry sooner with jittered backoff
        scheduleNext(Math.min(backoff, maxBackoff));
        backoff = Math.min(maxBackoff, Math.floor(backoff * 1.6) + (Math.random()*200)|0);
      }
    };

    function scheduleNext(ms: number) {
      if (timer) globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(load, ms) as unknown as number;
    }

    load(); // kick off immediately

    return () => {
      dead = true;
      if (timer) globalThis.clearTimeout(timer);
      if (watchdogRef.current) { globalThis.clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    };
  }, [queryKey, refreshMs, symbol, base, quote, timeWindow]);

  // smoothing
  const plotted = useMemo(() => {
    if (smooth === 'ema') return emaPoints(points, emaPeriod);
    return points;
  }, [points, smooth, emaPeriod]);

  // geometry
  const geo = useMemo(() => {
    const w = size.w;
    const h = size.h;
    if (!plotted.length || w <= 0 || h <= 0) {
      return {
        path: '', area: '',
        firstP: 0, lastP: 0, minP: 0, maxP: 0,
        xOf: (_:number)=>0, yOf: (_:number)=>h/2,
        idxForX: (_:number)=>0, w, h
      };
    }
    const minP = Math.min(...plotted.map(p=>p.p));
       const maxP = Math.max(...plotted.map(p=>p.p));
    const padY = (maxP - minP) * 0.08 || 1e-9;
    const lo = minP - padY, hi = maxP + padY;

    const t0 = plotted[0].t, t1 = plotted[plotted.length-1].t;
    const span = Math.max(1, t1 - t0);

    const xOf = (t:number) => ((t - t0) / span) * (w - 1);
    const yOf = (p:number) => (1 - (p - lo) / (hi - lo)) * (h - 1);

    let d = '';
    plotted.forEach((pt,i) => {
      const x = xOf(pt.t), y = yOf(pt.p);
      d += (i === 0) ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });

    const firstX = xOf(plotted[0].t);
    const lastX  = xOf(plotted[plotted.length-1].t);
    const baseY  = yOf(lo);
    const area   = `${d} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;

    const idxForX = (x:number) => {
      const px = Math.max(0, Math.min(w - 1, x));
      const t  = t0 + (px / Math.max(1, w - 1)) * span;
      const i  = Math.round(((t - t0) / span) * (plotted.length - 1));
      return Math.max(0, Math.min(plotted.length - 1, i));
    };

    return {
      path: d, area,
      firstP: plotted[0].p, lastP: plotted[plotted.length-1].p,
      minP, maxP, xOf, yOf, idxForX, w, h
    };
  }, [plotted, size.w, size.h]);

  // hover
  const onMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!wrapRef.current || !plotted.length) return;
    const r = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    setHover({ x, idx: geo.idxForX(x) });
  };
  const onLeave = () => setHover(null);

  const cur = hover ? plotted[hover.idx] : null;
  const dot = cur ? { x: geo.xOf(cur.t), y: geo.yOf(cur.p) } : null;

  // tooltip formatting
  const fmtValue = valueFormatter ?? ((v:number) =>
    v.toLocaleString(undefined, { maximumSignificantDigits: 6 })
  );
  const fmtDateTime = (tsMs:number) => {
    const opts: Intl.DateTimeFormatOptions = {
      year:'numeric', month:'short', day:'2-digit',
      hour:'2-digit', minute:'2-digit',
      hour12:false, timeZone: useUTC ? 'UTC' : undefined,
    };
    const s = new Intl.DateTimeFormat(undefined, opts).format(new Date(tsMs));
    return useUTC ? `${s} UTC` : s;
  };

  const pct = plotted.length > 1
    ? (((geo.lastP - geo.firstP) / (geo.firstP || 1)) * 100)
    : 0;

  const wCss = typeof width === 'number' ? `${width}px` : width;

  return (
    <div ref={wrapRef} className={className} style={{ width: wCss, height, position:'relative' }}>
      {/* Tooltip */}
      {cur && (
        <div style={{
          position:'absolute',
          left: Math.max(6, Math.min((hover!.x ?? 0) + 8, Math.max(0, (wrapRef.current?.clientWidth ?? 0) - 160))),
          top: 6,
          background: 'rgba(0,0,0,0.66)',
          color: '#fff',
          padding: '6px 8px',
          borderRadius: 8,
          lineHeight: 1.15,
          fontSize: 12,
          pointerEvents:'none',
          boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
        }}>
          <div style={{ fontWeight: 600 }}>{fmtValue(cur.p)}</div>
          <div style={{ opacity: 0.85 }}>{fmtDateTime(cur.t)}</div>
        </div>
      )}

      <svg
        width="100%" height="100%"
        viewBox={`0 0 ${geo.w} ${geo.h}`}
        onMouseMove={onMove} onMouseLeave={onLeave}
      >
        <defs>
          {/* line stroke gradient (left → right) */}
          <linearGradient
            id={gradStrokeId}
            x1="0" y1="0" x2={Math.max(1, geo.w)} y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0"   stopColor={strokeFrom}/>
            <stop offset="0.4" stopColor={strokeFrom}/>
            <stop offset="1"   stopColor={strokeTo}/>
          </linearGradient>

          {/* under-fill gradient (top → bottom) */}
          <linearGradient id={areaFillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={areaFrom ?? strokeTo} stopOpacity={areaOpacityTop}/>
            <stop offset="33%"  stopColor={areaFrom ?? strokeTo} stopOpacity={areaOpacityTop}/>
            <stop offset="100%" stopColor={areaTo   ?? strokeTo} stopOpacity={areaOpacityBottom}/>
          </linearGradient>

          {/* edge fade mask — WHITE visible, BLACK transparent */}
          {edgeFade && (
            <>
              <linearGradient
                id={edgeGradId}
                x1="0" y1="0" x2={geo.w} y2="0"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%"    stopColor="#fff" stopOpacity="0"/>
                <stop offset="10%"   stopColor="#fff" stopOpacity="0.4"/>
                <stop offset="99.5%" stopColor="#fff" stopOpacity="1"/>
                <stop offset="100%"  stopColor="#fff" stopOpacity="0"/>
              </linearGradient>
              <mask
                id={edgeMaskId}
                maskUnits="userSpaceOnUse"
                x="0" y="0" width={geo.w} height={geo.h}
                style={{ maskType: 'alpha' as any }}
              >
                <rect x="0" y="0" width={geo.w} height={geo.h} fill={`url(#${edgeGradId})`} />
              </mask>
            </>
          )}
        </defs>

        {/* optional under-area */}
        {showArea && geo.area && (
          <path
            d={geo.area}
            fill={`url(#${areaFillId})`}
            {...(edgeFade ? { mask: `url(#${edgeMaskId})` } : {})}
          />
        )}

        {/* main gradient line */}
        {geo.path && (
          <path
            d={geo.path}
            fill="none"
            stroke={`url(#${gradStrokeId})`}
            strokeWidth={lineWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            {...(edgeFade ? { mask: `url(#${edgeMaskId})` } : {})}
          />
        )}

        {/* hover aids */}
        {dot && (
          <>
            <line x1={hover!.x} x2={hover!.x} y1={0} y2={geo.h}
                  stroke="rgba(0,0,0,0.28)" strokeDasharray="3 3"/>
            <circle cx={dot.x} cy={dot.y} r="3.5" fill="#fff" stroke={strokeTo} strokeWidth="2"/>
          </>
        )}
      </svg>

      {/* tiny % badge */}
      {plotted.length > 1 && (
        <div style={{ position:'absolute', right:6, top:-25, fontSize:12, opacity:.75 }}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
        </div>
      )}

      {/* stale badge */}
      {stale && (
        <div style={{
          position:'absolute', left:6, bottom:-18, fontSize:11,
          color:'#999', background:'rgba(0,0,0,0.35)', padding:'2px 6px',
          borderRadius:6
        }}>
          paused
        </div>
      )}
    </div>
  );
};