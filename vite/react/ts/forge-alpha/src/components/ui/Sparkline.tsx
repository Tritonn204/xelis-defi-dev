import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getSharedDataFeed } from '@/lib/datafeed-singleton';
import { useSparklineFeed } from '@/hooks/useFeed';
import type { Resolution } from '@/types/chart';

type SparklinePoint = { t: number; p: number };

type Props = {
  // Data selection
  symbol?: string;
  base?: string;
  quote?: string;
  window?: '1h' | '24h' | '1w';

  className?: string;
  width?: number | string;
  height?: number;

  // Gradient line (left → right)
  strokeFrom?: string;
  strokeTo?: string;
  lineWidth?: number;

  // Optional under-fill (top → bottom)
  showArea?: boolean;
  areaFrom?: string;
  areaTo?: string;
  areaOpacityTop?: number;
  areaOpacityBottom?: number;

  // Edge fade (mask)
  edgeFade?: boolean;

  // Tooltip
  useUTC?: boolean;
  valueFormatter?: (v: number) => string;

  // Polling
  refreshMs?: number;

  // Smoothing
  smooth?: 'none' | 'ema';
  emaPeriod?: number;
  routerAddress?: string;
  onPriceChange?: (pct: number, currentPrice: number) => void;
};

const WINDOW_TO_RESOLUTION: Record<'1h' | '24h' | '1w', Resolution> = {
  '1h': '1',
  '24h': '5',
  '1w': '15',
};

const WINDOW_TO_MS: Record<'1h' | '24h' | '1w', number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};

function useUID(prefix = 'spark') {
  const ref = useRef<string | undefined>(undefined);
  if (!ref.current) ref.current = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
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

function mergePoints(prev: SparklinePoint[], next: SparklinePoint[]): SparklinePoint[] {
  if (!prev.length) return next;
  if (!next.length) return prev;

  const prevFirstT = prev[0].t;
  const prevLastT = prev[prev.length - 1].t;
  const nextFirstT = next[0].t;

  // If new data starts before our series (schema/window changed), replace
  if (nextFirstT <= prevFirstT) return next;

  // Merge by timestamp, replacing overlaps and appending newer
  const byT = new Map<number, SparklinePoint>();
  for (const p of prev) byT.set(p.t, p);
  for (const p of next) byT.set(p.t, p);
  const merged = Array.from(byT.values()).sort((a, b) => a.t - b.t);

  // Keep only from our original start
  const startIdx = merged.findIndex((p) => p.t >= prevFirstT);
  const trimmed = startIdx > 0 ? merged.slice(startIdx) : merged;

  // If nothing strictly newer than prevLastT, return trimmed
  if (trimmed[trimmed.length - 1].t <= prevLastT) return trimmed;

  return trimmed;
}

export const Sparkline: React.FC<Props> = ({
  symbol,
  base,
  quote = 'XEL',
  window: timeWindow = '24h',

  className,
  width = '100%',
  height = 42,

  strokeFrom = '#462013',
  strokeTo = '#ffffff',
  lineWidth = 2.6,

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
  routerAddress = null,
  onPriceChange = null,
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: height });
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);

  // Historical + merged points state
  const [points, setPoints] = useState<SparklinePoint[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<Error | null>(null);

  // Build symbol for subscription
  const subscribedSymbol = useMemo(() => {
    return symbol
      ? symbol.toUpperCase()
      : `${(base || '').toUpperCase()}_${(quote || 'XEL').toUpperCase()}`;
  }, [symbol, base, quote]);

  const resolution = useMemo(() => WINDOW_TO_RESOLUTION[timeWindow], [timeWindow]);

  // Track last update time for stale detection
  const lastUpdateRef = useRef<number>(Date.now());

  // Handle stale data - triggers history refetch
  const handleStale = useCallback(() => {
    console.log('[Sparkline] Data marked as stale, will refetch history...');
    setHistoryLoaded(false); // This triggers the history effect to run again
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Load initial historical data
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const loadHistory = async () => {
      try {
        const feed = getSharedDataFeed();
        const now = Date.now();
        const windowMs = WINDOW_TO_MS[timeWindow];
        const from = Math.floor((now - windowMs) / 1000);
        const to = Math.floor(now / 1000);

        const candles = await feed.history(
          subscribedSymbol,
          resolution,
          from,
          to,
          true, // includeLive
          routerAddress || undefined
        );

        if (!mounted) return;

        // Convert candles to sparkline points
        const historyPoints: SparklinePoint[] = candles.map((c) => ({
          t: typeof c.time === 'number' ? c.time * 1000 : c.time, // Ensure milliseconds
          p: c.close,
        } as SparklinePoint));

        if (historyPoints.length > 0) {
          setPoints((prev) => {
            // If we have existing points, merge. Otherwise just use history.
            if (prev.length === 0) return historyPoints;
            return mergePoints(historyPoints, prev);
          });
          lastUpdateRef.current = Date.now();
        }

        setHistoryLoaded(true);
        setHistoryError(null);
      } catch (err) {
        console.error('[Sparkline] Failed to load history:', err);
        if (mounted) {
          setHistoryError(err instanceof Error ? err : new Error(String(err)));
          setHistoryLoaded(true); // Mark as "attempted" to prevent infinite loop
        }
      }
    };

    // Reset and load when symbol/window changes
    setPoints([]);
    setHistoryLoaded(false);
    setHistoryError(null);
    loadHistory();

    return () => {
      mounted = false;
    };
  }, [subscribedSymbol, resolution, timeWindow, routerAddress]);

  // ─────────────────────────────────────────────────────────────
  // Periodic HTTP refresh as backup
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!historyLoaded || refreshMs <= 0) return;

    const refreshHistory = async () => {
      try {
        const feed = getSharedDataFeed();
        const now = Date.now();
        const windowMs = WINDOW_TO_MS[timeWindow];
        const from = Math.floor((now - windowMs) / 1000);
        const to = Math.floor(now / 1000);

        const candles = await feed.history(
          subscribedSymbol,
          resolution,
          from,
          to,
          true,
          routerAddress || undefined
        );

        const refreshPoints: SparklinePoint[] = candles.map((c) => ({
          t: typeof c.time === 'number' ? c.time * 1000 : c.time,
          p: c.close,
        }));

        if (refreshPoints.length > 0) {
          setPoints((prev) => mergePoints(prev, refreshPoints));
          lastUpdateRef.current = Date.now();
        }
      } catch (err) {
        console.warn('[Sparkline] Refresh failed:', err);
      }
    };

    const timer = window.setInterval(refreshHistory, refreshMs);
    return () => window.clearInterval(timer);
  }, [historyLoaded, refreshMs, subscribedSymbol, resolution, timeWindow, routerAddress]);

  // ─────────────────────────────────────────────────────────────
  // Subscribe to live updates via hook
  // ─────────────────────────────────────────────────────────────
  const { points: livePoints, status } = useSparklineFeed(subscribedSymbol, resolution, {
    enabled: historyLoaded, // Only subscribe after history is loaded
    maxPoints: 1440,
    onStale: handleStale,
  });

  // Merge live points into our state
  const prevLivePointsRef = useRef<typeof livePoints>([]);
  useEffect(() => {
    if (!historyLoaded) return;

    // Find new points that weren't in the previous live points
    const prevSet = new Set(prevLivePointsRef.current.map((p) => `${p.time}:${p.price}`));
    const newPoints = livePoints.filter((p) => !prevSet.has(`${p.time}:${p.price}`));

    if (newPoints.length > 0) {
      const converted: SparklinePoint[] = newPoints.map((p) => ({
        t: p.time * 1000, // Convert to milliseconds
        p: p.price,
      }));

      setPoints((prev) => mergePoints(prev, converted));
      lastUpdateRef.current = Date.now();
    }

    prevLivePointsRef.current = livePoints;
  }, [livePoints, historyLoaded]);

  // ─────────────────────────────────────────────────────────────
  // Stale detection
  // ─────────────────────────────────────────────────────────────
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const checkStale = () => {
      const timeSinceUpdate = Date.now() - lastUpdateRef.current;
      const staleThreshold = Math.max(refreshMs * 2, 60000);
      setIsStale(timeSinceUpdate > staleThreshold);
    };

    const timer = window.setInterval(checkStale, 10000);
    return () => window.clearInterval(timer);
  }, [refreshMs]);

  // Also consider connection status
  const showStaleIndicator = isStale || status === 'error';

  // Unique IDs for SVG gradients
  const gradStrokeId = useUID('grad-stroke');
  const areaFillId = useUID('grad-area');
  const edgeGradId = useUID('edge-grad');
  const edgeMaskId = useUID('edge-mask');

  // Measure width when width is fluid
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

  useEffect(() => {
    setSize((s) => ({ ...s, h: height }));
  }, [height]);

  // Smoothing
  const plotted = useMemo(() => {
    if (smooth === 'ema' && points.length > 0) {
      return emaPoints(points, emaPeriod);
    }
    return points;
  }, [points, smooth, emaPeriod]);

  // Geometry calculations
  const geo = useMemo(() => {
    const w = size.w;
    const h = size.h;

    // Filter out any bad points instead of nuking the whole series
    const clean = plotted.filter(
      (p) => Number.isFinite(p.t) && Number.isFinite(p.p)
    );

    if (!clean.length || w <= 0 || h <= 0) {
      return {
        path: '',
        area: '',
        firstP: 0,
        lastP: 0,
        minP: 0,
        maxP: 0,
        xOf: (_: number) => 0,
        yOf: (_: number) => h / 2,
        idxForX: (_: number) => 0,
        w,
        h,
      };
    }

    const minP = Math.min(...clean.map((p) => p.p));
    const maxP = Math.max(...clean.map((p) => p.p));

    // Ensure we have a valid range
    const range = maxP - minP;
    const padY = range > 0 ? range * 0.08 : 1; // avoid zero range
    const lo = minP - padY;
    const hi = maxP + padY;

    const t0 = clean[0].t;
    const t1 = clean[clean.length - 1].t;
    const span = Math.max(1, t1 - t0); // never allow zero span

    const xOf = (t: number) => {
      if (!Number.isFinite(t)) return 0;
      return ((t - t0) / span) * (w - 1);
    };

    const yOf = (p: number) => {
      if (!Number.isFinite(p)) return h / 2;
      const rangeY = hi - lo;
      if (rangeY === 0) return h / 2; // flat line in middle if no range
      return (1 - (p - lo) / rangeY) * (h - 1);
    };

    let d = '';
    clean.forEach((pt, i) => {
      const x = xOf(pt.t);
      const y = yOf(pt.p);

      // Skip invalid projected coords
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });

    // If we couldn't build a valid path, bail out but keep helpers sane
    if (!d) {
      return {
        path: '',
        area: '',
        firstP: 0,
        lastP: 0,
        minP: 0,
        maxP: 0,
        xOf,
        yOf,
        idxForX: (_: number) => 0,
        w,
        h,
      };
    }

    const firstX = xOf(clean[0].t);
    const lastX = xOf(clean[clean.length - 1].t);
    const bottomY = h - 1;
    const area = `${d} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;

    const idxForX = (x: number) => {
      const px = Math.max(0, Math.min(w - 1, x));
      const t = t0 + (px / Math.max(1, w - 1)) * span;
      const i = Math.round(((t - t0) / span) * (clean.length - 1));
      return Math.max(0, Math.min(clean.length - 1, i));
    };

    return {
      path: d,
      area,
      firstP: clean[0].p,
      lastP: clean[clean.length - 1].p,
      minP,
      maxP,
      xOf,
      yOf,
      idxForX,
      w,
      h,
    };
  }, [plotted, size.w, size.h]);

  // Hover handlers
  const onMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!wrapRef.current || !plotted.length) return;
    const r = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    setHover({ x, idx: geo.idxForX(x) });
  };
  const onLeave = () => setHover(null);

  const cur = hover ? plotted[hover.idx] : null;
  const dot = cur ? { x: geo.xOf(cur.t), y: geo.yOf(cur.p) } : null;

  // Tooltip formatting
  const fmtValue =
    valueFormatter ?? ((v: number) => v.toLocaleString(undefined, { maximumSignificantDigits: 6 }));

  const fmtDateTime = (tsMs: number) => {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: useUTC ? 'UTC' : undefined,
    };
    const s = new Intl.DateTimeFormat(undefined, opts).format(new Date(tsMs));
    return useUTC ? `${s} UTC` : s;
  };

  // Calculate percentage change
  const pct = plotted.length > 1 ? ((geo.lastP - geo.firstP) / (geo.firstP || 1)) * 100 : 0;

  // Notify parent of price changes
  useEffect(() => {
    if (onPriceChange && plotted.length > 1) {
      const currentPrice = plotted[plotted.length - 1]?.p || 0;
      onPriceChange(pct, currentPrice);
    }
  }, [pct, onPriceChange, plotted]);

  const wCss = typeof width === 'number' ? `${width}px` : width;

  return (
    <div ref={wrapRef} className={className} style={{ width: wCss, height, position: 'relative' }}>
      {/* Tooltip */}
      {cur && (
        <div
          style={{
            position: 'absolute',
            left: Math.max(
              6,
              Math.min(
                (hover!.x ?? 0) + 8,
                Math.max(0, (wrapRef.current?.clientWidth ?? 0) - 160)
              )
            ),
            top: 6,
            background: 'rgba(0,0,0,0.66)',
            color: '#fff',
            padding: '6px 8px',
            borderRadius: 8,
            lineHeight: 1.15,
            fontSize: 12,
            pointerEvents: 'none',
            boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ fontWeight: 600 }}>{fmtValue(cur.p)}</div>
          <div style={{ opacity: 0.85 }}>{fmtDateTime(cur.t)}</div>
        </div>
      )}

      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${geo.w} ${geo.h}`}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <defs>
          {/* line stroke gradient (left → right) */}
          <linearGradient
            id={gradStrokeId}
            x1="0"
            y1="0"
            x2={Math.max(1, geo.w)}
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={strokeFrom} />
            <stop offset="0.4" stopColor={strokeFrom} />
            <stop offset="1" stopColor={strokeTo} />
          </linearGradient>

          {/* under-fill gradient (top → bottom) */}
          <linearGradient id={areaFillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={areaFrom ?? strokeTo} stopOpacity={areaOpacityTop} />
            <stop offset="33%" stopColor={areaFrom ?? strokeTo} stopOpacity={areaOpacityTop} />
            <stop offset="100%" stopColor={areaTo ?? strokeTo} stopOpacity={areaOpacityBottom} />
          </linearGradient>

          {/* edge fade mask */}
          {edgeFade && (
            <>
              <linearGradient
                id={edgeGradId}
                x1="0"
                y1="0"
                x2={geo.w}
                y2="0"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#fff" stopOpacity="0" />
                <stop offset="10%" stopColor="#fff" stopOpacity="0.4" />
                <stop offset="99.5%" stopColor="#fff" stopOpacity="1" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <mask
                id={edgeMaskId}
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width={geo.w}
                height={geo.h}
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
            <line
              x1={hover!.x}
              x2={hover!.x}
              y1={0}
              y2={geo.h}
              stroke="rgba(0,0,0,0.28)"
              strokeDasharray="3 3"
            />
            <circle cx={dot.x} cy={dot.y} r="3.5" fill="#fff" stroke={strokeTo} strokeWidth="2" />
          </>
        )}
      </svg>

      {/* stale/error badge */}
      {showStaleIndicator && (
        <div
          style={{
            position: 'absolute',
            left: 6,
            bottom: -18,
            fontSize: 11,
            color: '#999',
            background: 'rgba(0,0,0,0.35)',
            padding: '2px 6px',
            borderRadius: 6,
          }}
        >
          {status === 'connecting' ? 'connecting...' : status === 'error' ? 'error' : 'paused'}
        </div>
      )}
    </div>
  );
};