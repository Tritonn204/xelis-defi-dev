import React, { useEffect, useMemo, useRef, memo, useCallback, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  BaselineSeries,
  PriceScaleMode,
  type IChartApi,
  type Time,
} from 'lightweight-charts';
import { useChart, type CandleMode } from '@/contexts/ChartContext';
import type { Resolution, Candle, VolPoint } from '@/types/chart';
import ChartControls from './ChartControls';
import type { ExtendedCandle } from '@/lib/datafeed';
import { usePools } from '@/contexts/PoolContext';
import { useChartFeed } from '@/hooks/useChartFeed';
import Tooltip from './Tooltip';

const UP_COLOR = '#26a69a';
const DOWN_COLOR = '#ef5350';

interface ArpCandle {
  time: Time;
  price: number;
  confidence: number;
  hops: number;
}

interface ArpFeedResponse {
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

const detectDataType = (response: any): 'arp' | 'ohlc' => {
  // Check for ARP response structure
  if (response.meta?.type === 'arp' || response.prices) {
    return 'arp';
  }
  // Default to OHLC for trading pairs
  return 'ohlc';
};

const rangeFor = (res: Resolution) =>
({
  '1': 24 * 60 * 60,
  '5': 7 * 24 * 60 * 60,
  '15': 14 * 24 * 60 * 60,
  '60': 60 * 24 * 60 * 60,
  '240': 180 * 24 * 60 * 60,
  '1D': 365 * 24 * 60 * 60,
  '1W': 2 * 365 * 60 * 60 * 24,
  '1M': 5 * 365 * 60 * 60 * 24,
}[res]!);

type Props = { className?: string; theme?: 'dark' | 'light' };

type Guard = {
  series: any;
  update: (from: number, to: number) => void;
  remove: () => void;
};

function addGuardForSeries(
  chart: IChartApi,
  paneIndex: number,
  sourceSeries: any,
  opts: { min: number; max: number; margins?: { top: number; bottom: number } }
): Guard {
  const { min, max, margins = { top: 0, bottom: 0 } } = opts;

  const guard = chart.addSeries(
    LineSeries,
    {
      // share pane implicitly via paneIndex; priceScaleId will match default ("right")
      color: 'rgba(0,0,0,0)',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    },
    paneIndex
  );

  // match scale margins (pin bottom/top visually)
  guard.priceScale().applyOptions({ autoScale: true, scaleMargins: margins });

  const update = () => {
    const logical = chart.timeScale().getVisibleLogicalRange?.();
    if (!logical) return;

    // Use the SERIES’ visible bars to get real boundary times
    const rng = sourceSeries?.barsInLogicalRange?.(logical);
    const tFrom = (rng?.from as any)?.time as Time | undefined;
    const tTo = (rng?.to as any)?.time as Time | undefined;

    if (tFrom == null || tTo == null) return; // nothing visible yet

    guard.setData([
      { time: tFrom, value: min },
      { time: tTo, value: max },
    ]);
  };

  const remove = () => { try { chart.removeSeries(guard); } catch { } };

  // seed once
  update();

  return { series: guard, update, remove };
}

export const Chart: React.FC<Props> = ({ className, theme = 'dark' }) => {
  const { 
    symbol, 
    tickerSymbol, 
    resolution, 
    feed, 
    lastBarRef, 
    indicators, 
    candleMode,
    shouldResetView,
    clearResetView,
  } = useChart();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [isLog, setIsLog] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const arpDataRef = useRef<ArpCandle[]>([]);
  const confidenceSeriesRef = useRef<any>(null);
  const priceLineSeriesRef = useRef<any>(null);

  const candleModeRef = React.useRef<CandleMode>(candleMode);  // always-fresh mode for WS/crosshair
  const heikinRef = React.useRef<Array<{ time: Time; open: number; high: number; low: number; close: number }>>([]);
  const volumeByTimeRef = React.useRef<Map<number, number>>(new Map());

  const rsiGuardRef = React.useRef<Guard | null>(null);
  const volGuardRef = React.useRef<Guard | null>(null);
  const lastRSIRef = React.useRef<number | undefined>(undefined);

  const { routerContract } = usePools();

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const lastRefreshTimeRef = useRef<number>(0);
  const MIN_REFRESH_INTERVAL_MS = 5000; 

  const [hover, setHover] = React.useState<{
    time: Time | undefined | null;
    open?: number; high?: number; low?: number; close?: number;
    volume?: number; isUp?: boolean;
  } | null>(null);

  // Candles (pane 0)
  const candleSeriesRef = useRef<any>(null);
  const candleDataRef = useRef<Array<{ time: Time; open: number; high: number; low: number; close: number }>>([]);

  // EMA overlays (pane 0)
  const emaSeriesRef = useRef<Map<string, any>>(new Map());

  const emaCommittedRef = useRef<Map<string, number>>(new Map());
  const emaEphemeralRef = useRef<Map<string, number>>(new Map());

  // Sub-panes
  const volumeSeriesRef = useRef<any>(null);

  // RSI pane: shaded band + main RSI + faint signal
  const rsiBandSeriesRef = useRef<any>(null);
  const rsiSeriesRef = useRef<any>(null);
  const rsiSignalSeriesRef = useRef<any>(null);
  const rsiLinesRef = useRef<{ upper?: any; lower?: any }>({});
  const rsiAnchorsRef = useRef<{ min?: any; max?: any }>({});

  // Buffers
  const closesRef = useRef<number[]>([]);
  const lastTimeRef = useRef<Time | null>(null);

  // Infinite scroll state
  const earliestLoadedTimeRef = useRef<number | null>(null);
  const isLoadingMoreRef = useRef(false);
  const hasMoreDataRef = useRef(true);
  const dataTypeRef = useRef<'arp' | 'ohlc' | null>(null);

  // precision/minMove (your rule)
  const precision = useMemo(() => (/_((USD|USDT|USDC))$/.test(tickerSymbol) ? 5 : 8), [tickerSymbol]);
  const minMove = useMemo(() => Math.pow(10, -precision), [precision]);

  const [base, quote] = React.useMemo(() => {
    const m = tickerSymbol.match(/^([^_/]+)[_/-]([^_/]+)$/i);
    return m ? [m[1], m[2]] : [tickerSymbol, ''];
  }, [tickerSymbol]);

  /* ---------------- helpers ---------------- */
  function timeToSec(t: Time): number {
    return typeof t === 'number' ? t : Math.floor(Date.now() / 1000);
  }
  function fmtPrice(n: number | undefined) {
    if (n == null) return '—';
    return n.toLocaleString(undefined, { maximumFractionDigits: precision });
  }
  function fmtVol(
    v: number | undefined,
    base: string,
    quote?: string,
    close?: number
  ) {
    if (v == null) return '—';

    const abs = Math.abs(v);
    const abbr =
      abs >= 1e9 ? (v / 1e9).toFixed(2) + 'B' :
        abs >= 1e6 ? (v / 1e6).toFixed(2) + 'M' :
          abs >= 1e3 ? (v / 1e3).toFixed(2) + 'K' :
            v;

    // Always label with base units (e.g., XEL)
    let out = `${abbr} ${base}`;

    // Optional: append quote notional if price is available
    // if (quote && typeof close === 'number') {
    //   const q = v * close;
    //   const qAbs = Math.abs(q);
    //   const qAbbr =
    //     qAbs >= 1e9 ? (q / 1e9).toFixed(2) + 'B' :
    //     qAbs >= 1e6 ? (q / 1e6).toFixed(2) + 'M' :
    //     qAbs >= 1e3 ? (q / 1e3).toFixed(2) + 'K' :
    //     String(q);
    //   out += ` · ~${qAbbr} ${quote}`;
    // }

    return out;
  }
  function fmtTime(t: Time | undefined | null) {
    if (!t) return '—';
    const d = new Date(timeToSec(t) * 1000);
    // show date+time (24h); tweak as you like
    return d.toLocaleString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function enforcePaneOrder(chart: IChartApi) {
    // Put volume directly under candles
    if (volumeSeriesRef.current) {
      const vIdx = findPaneIndexForSeries(chart, volumeSeriesRef.current);
      if (vIdx != null && vIdx !== 1) {
        chart.panes()[vIdx]?.moveTo?.(1);
      }
    }

    // Put RSI under volume (or under candles if no volume)
    if (rsiSeriesRef.current) {
      const rIdx = findPaneIndexForSeries(chart, rsiSeriesRef.current);
      const desired = volumeSeriesRef.current ? 2 : 1;
      if (rIdx != null && rIdx !== desired) {
        chart.panes()[rIdx]?.moveTo?.(desired);
      }
    }
  }

  function findPaneIndexForSeries(chart: IChartApi, series: any): number | null {
    const panes = chart.panes();
    for (let i = 0; i < panes.length; i++) {
      const paneSeries = panes[i]?.getSeries?.() ?? [];
      if (paneSeries.includes(series)) return i;
    }
    return null;
  }

  function createArpSeries(chart: IChartApi) {
    // Main price line (replaces candlesticks)
    priceLineSeriesRef.current = chart.addSeries(
      LineSeries,
      {
        color: '#2962ff',
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        priceFormat: { type: 'price', precision, minMove },
      },
      0
    );

    // Confidence indicator (separate pane)
    const confidencePaneIndex = chart.panes().length;
    confidenceSeriesRef.current = chart.addSeries(
      LineSeries,
      {
        color: 'rgba(255, 165, 0, 0.8)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      },
      confidencePaneIndex
    );

    // Set confidence pane height
    chart.panes()[confidencePaneIndex]?.setHeight?.(80);

    // Lock confidence scale to [0, 100] with autoscale and margins
    const confScale = confidenceSeriesRef.current.priceScale();
    confScale.applyOptions({
      autoScale: true,  // Changed to true
      scaleMargins: { top: 0.05, bottom: 0.05 }  // 5% cushion on top and bottom
    });

    // Add invisible anchor series to pin the scale to [0, 100]
    const confAnchorMin = chart.addSeries(
      LineSeries,
      {
        color: 'rgba(0,0,0,0)',
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      },
      confidencePaneIndex
    );

    const confAnchorMax = chart.addSeries(
      LineSeries,
      {
        color: 'rgba(0,0,0,0)',
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      },
      confidencePaneIndex
    );

    // Store references to anchors for cleanup
    confidenceSeriesRef.current._anchors = { min: confAnchorMin, max: confAnchorMax };

    // Patch setData to automatically update anchors
    const _origSetData = confidenceSeriesRef.current.setData.bind(confidenceSeriesRef.current);
    confidenceSeriesRef.current.setData = (data: { time: Time; value: number }[]) => {
      _origSetData(data);
      // Mirror points at 0 and 100 so autoscale resolves to [0, 100]
      confAnchorMin.setData(data.map(p => ({ time: p.time, value: 0 })));
      confAnchorMax.setData(data.map(p => ({ time: p.time, value: 100 })));
      confScale.applyOptions({ autoScale: true });
    };

    // Also patch update for streaming data
    const _origUpdate = confidenceSeriesRef.current.update?.bind(confidenceSeriesRef.current);
    if (_origUpdate) {
      confidenceSeriesRef.current.update = (bar: { time: Time; value: number }) => {
        _origUpdate(bar);
        confAnchorMin.update?.({ time: bar.time, value: 0 });
        confAnchorMax.update?.({ time: bar.time, value: 100 });
        confScale.applyOptions({ autoScale: true });
      };
    }
  }

  function removeArpSeries(chart: IChartApi) {
    // Price line (pane 0)
    if (priceLineSeriesRef.current) {
      // PHASE 1: clear timestamps from time scale
      priceLineSeriesRef.current.setData?.([]);
      // PHASE 2: remove series
      chart.removeSeries(priceLineSeriesRef.current);
      priceLineSeriesRef.current = null;
    }

    // Confidence (own pane)
    if (confidenceSeriesRef.current) {
      const main = confidenceSeriesRef.current as any;
      const anchors = main._anchors as { min?: any; max?: any } | undefined;

      // PHASE 1: clear timestamps from time scale (main + anchors)
      main.setData?.([]);
      anchors?.min?.setData?.([]);
      anchors?.max?.setData?.([]);

      // PHASE 2: remove the pane that owns these series
      const paneIndex = findPaneIndexForSeries(chart, main);
      if (paneIndex != null) chart.removePane(paneIndex);

      confidenceSeriesRef.current = null;
    }
  }

  function removeCandleSeries(chart: IChartApi) {
    if (candleSeriesRef.current) {
      chart.removeSeries(candleSeriesRef.current);
      candleSeriesRef.current = null;
    }
  }

  // If all volume values are 0, bump the *first* bar to ε with transparent color.
  // This gives autoscale a real range [0, ε] while keeping the last bar/label intact.
  function injectEpsilonAtStartIfAllZero(volData: VolPoint[], eps = 1): VolPoint[] {
    if (!volData.length) return volData;
    const maxVol = Math.max(0, ...volData.map(v => v.value || 0));
    if (maxVol > 0) return volData; // nothing to do

    // Replace the *first* point (oldest time) so timestamps stay strictly ascending.
    const first = volData[0];
    return [{ ...first, value: eps, color: 'rgba(0,0,0,0)' }, ...volData.slice(1)];
  }

  function removeVolume(chart: IChartApi) {
    volGuardRef.current?.remove?.();
    volGuardRef.current = null;

    const s = volumeSeriesRef.current;
    if (!s) return;

    const paneIndex = findPaneIndexForSeries(chart, s);

    // 🧹 PHASE 1: clear data (removes timestamps from time scale)
    s.setData?.([]);

    // 🧨 PHASE 2: remove pane (pane still owns the series)
    if (paneIndex != null) {
      chart.removePane(paneIndex);
    } else {
      // fallback safety (should rarely happen)
      chart.removeSeries(s);
    }

    volumeSeriesRef.current = null;
  }

  function createVolume(chart: IChartApi) {
    // always create at the bottom (new pane)
    const paneIndex = chart.panes().length;
    volumeSeriesRef.current = chart.addSeries(
      HistogramSeries,
      {
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: 'volume' },
      },
      paneIndex,
    );
    chart.panes()[paneIndex]?.setHeight?.(52);

    // Remove any existing guard before creating new one
    volGuardRef.current?.remove?.();
    volGuardRef.current = null;
    volGuardRef.current = addGuardForSeries(chart, paneIndex, volumeSeriesRef.current, {
      min: 0, max: 1, margins: { top: 0.15, bottom: 0 },
    });
  }

  const loadHistoricalData = useCallback(async (
    chart: IChartApi,
    symbol: string,
    resolution: Resolution,
    from: number,
    to: number
  ) => {
    try {
      const bars = await feed.history(symbol, resolution, from, to, true, routerContract);
      return bars;
    } catch (error) {
      console.error('Failed to load chart data:', error);
      return [];
    }
  }, [feed, routerContract]);

  // Memoize indicator updates (moved before loadMoreHistoricalData to fix dependency order)
  const updateIndicators = useCallback((
    bars: ExtendedCandle[] | ArpCandle[],
    isArp: boolean
  ) => {
    // EMAs
    for (const cfg of indicators.ema) {
      if (!cfg.enabled) continue;
      const s = emaSeriesRef.current.get(cfg.id);
      if (!s) continue;

      const vals = computeEMA(closesRef.current, cfg.period);
      if (!vals.length) {
        s.setData?.([]);
        emaCommittedRef.current.delete(cfg.id);
        emaEphemeralRef.current.delete(cfg.id);
        continue;
      }

      const startIdx = closesRef.current.length - vals.length;
      const lineData = vals.map((v, i) => ({
        time: bars[startIdx + i].time,
        value: v,
      }));
      s.setData?.(lineData);

      const last = lineData[lineData.length - 1]?.value;
      if (last != null) emaCommittedRef.current.set(cfg.id, last);
      emaEphemeralRef.current.delete(cfg.id);
    }

    // RSI
    if (rsiSeriesRef.current && indicators.rsi.enabled && indicators.rsi.period > 0) {
      const rsiVals = computeRSI(closesRef.current, indicators.rsi.period, lastRSIRef.current);
      if (rsiVals.length) {
        const startIdx = closesRef.current.length - rsiVals.length;
        const rsiLine = rsiVals.map((v, i) => ({
          time: bars[startIdx + i].time,
          value: v,
        }));
        rsiSeriesRef.current.setData(rsiLine);

        rsiAnchorsRef.current.min?.setData(
          rsiLine.map(p => ({ time: p.time, value: 0 }))
        );
        rsiAnchorsRef.current.max?.setData(
          rsiLine.map(p => ({ time: p.time, value: 100 }))
        );

        lastRSIRef.current = rsiVals.at(-1);

        if (rsiSignalSeriesRef.current) {
          const sigVals = emaOf(rsiVals, 9);
          const sigStart = rsiLine.length - sigVals.length;
          const sigLine = sigVals.map((v, i) => ({
            time: rsiLine[sigStart + i].time,
            value: v,
          }));
          rsiSignalSeriesRef.current.setData(sigLine);
        }

        if (rsiBandSeriesRef.current) {
          const bandData = bars.map((b) => ({ time: b.time, value: 70 }));
          rsiBandSeriesRef.current.setData(bandData);
        }
      } else {
        rsiSeriesRef.current?.setData([]);
        rsiSignalSeriesRef.current?.setData([]);
        rsiBandSeriesRef.current?.setData([]);
        lastRSIRef.current = undefined;
      }
    }
  }, [indicators.ema, indicators.rsi.enabled, indicators.rsi.period]);

  // Handle stale data by triggering a partial history refresh
  const handleStaleData = useCallback(() => {
    const now = Date.now();
    
    // Debounce refreshes
    if (now - lastRefreshTimeRef.current < MIN_REFRESH_INTERVAL_MS) {
      console.log('[Chart] Skipping refresh (too soon after last refresh)');
      return;
    }
    
    console.log('[Chart] Data marked as stale, triggering history refresh');
    lastRefreshTimeRef.current = now;
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // Load more historical data when panning backward
  const loadMoreHistoricalData = useCallback(async () => {
    if (isLoadingMoreRef.current || !hasMoreDataRef.current || !earliestLoadedTimeRef.current) {
      return;
    }

    isLoadingMoreRef.current = true;
    const chart = chartRef.current;
    if (!chart) {
      isLoadingMoreRef.current = false;
      return;
    }

    try {
      const currentRange = chart.timeScale().getVisibleRange();
      // Calculate chunk size (same as initial load for this resolution)
      const chunkDuration = rangeFor(resolution);
      const to = earliestLoadedTimeRef.current;
      const from = to - chunkDuration;

      console.log(`[Chart] Loading more data: ${new Date(from * 1000).toISOString()} to ${new Date(to * 1000).toISOString()}`);

      // Fetch previous chunk
      const newBars = await feed.history(symbol, resolution, from, to, false, routerContract);

      if (!newBars.length) {
        console.log('[Chart] No more historical data available');
        hasMoreDataRef.current = false;
        isLoadingMoreRef.current = false;
        return;
      }

      const isArpData = newBars[0]?.isArpData === true;
      let actuallyAddedData = false;

      // Prepend data based on type
      if (isArpData) {
        // ARP data
        const newArpData: ArpCandle[] = newBars.map(bar => ({
          time: bar.time,
          price: bar.close,
          confidence: bar.confidence ?? 0,
          hops: bar.hops ?? 0,
        }));

        // Find overlap point: cut new data before first existing timestamp
        const firstExistingTime = arpDataRef.current.length > 0
          ? Number(arpDataRef.current[0].time)
          : Infinity;

        const uniqueNewData = newArpData.filter(d => Number(d.time) < firstExistingTime);
        actuallyAddedData = uniqueNewData.length > 0;

        if (actuallyAddedData) {
          // Prepend only non-overlapping data
          arpDataRef.current = [...uniqueNewData, ...arpDataRef.current];

          // Update price line
          const priceData = arpDataRef.current.map(d => ({ time: d.time, value: d.price }));
          priceLineSeriesRef.current?.setData(priceData);

          // Update confidence
          const confidenceData = arpDataRef.current.map(d => ({ time: d.time, value: d.confidence * 100 }));
          confidenceSeriesRef.current?.setData(confidenceData);

          // Prepend closes (only unique)
          const newCloses = uniqueNewData.map(d => d.price);
          closesRef.current = [...newCloses, ...closesRef.current];
        }

      } else {
        // OHLC data
        const newCandleData = newBars.map(b => ({
          time: b.time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }));

        // Find overlap point: cut new data before first existing timestamp
        const firstExistingTime = candleDataRef.current.length > 0
          ? Number(candleDataRef.current[0].time)
          : Infinity;

        const uniqueNewData = newCandleData.filter(c => Number(c.time) < firstExistingTime);
        actuallyAddedData = uniqueNewData.length > 0;

        if (actuallyAddedData) {
          // Prepend only non-overlapping data
          candleDataRef.current = [...uniqueNewData, ...candleDataRef.current];
          renderCandlesFromBuffer();

          // Prepend closes (only unique)
          const newCloses = newBars
            .filter(b => Number(b.time) < firstExistingTime)
            .map(b => b.close);
          closesRef.current = [...newCloses, ...closesRef.current];

          // Prepend volume data (only unique)
          if (volumeSeriesRef.current) {
            for (const b of newBars) {
              if (Number(b.time) < firstExistingTime) {
                volumeByTimeRef.current.set(Number(b.time), (b as any).volume ?? 0);
              }
            }

            const volData = candleDataRef.current.map((b) => ({
              time: b.time,
              value: volumeByTimeRef.current.get(Number(b.time)) ?? 0,
              color: (b.close ?? 0) >= (b.open ?? 0) ? '#26a69a' : '#ef5350',
            }));
            volumeSeriesRef.current.setData(injectEpsilonAtStartIfAllZero(volData, 1));
          }
        }
      }

      // Update indicators only if we added data
      if (actuallyAddedData) {
        updateIndicators(
          isArpData ? arpDataRef.current : candleDataRef.current,
          isArpData
        );
      }

      if (currentRange) {
        requestAnimationFrame(() => {
          try {
            // The view should stay on the same time range
            chart.timeScale().setVisibleRange(currentRange);
          } catch (err) {
            // If that fails, at least try to stay centered on same time
            console.warn('[Chart] Could not maintain exact position after load');
          }
        });
      }

      // Update earliest loaded time: use 'from' to ensure we move backwards even if all bars were filtered
      earliestLoadedTimeRef.current = from;

      console.log(`[Chart] Loaded ${actuallyAddedData ? 'new' : 'duplicate'} data. Total: ${isArpData ? arpDataRef.current.length : candleDataRef.current.length}`);

    } catch (error) {
      console.error('[Chart] Failed to load more historical data:', error);
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [symbol, resolution, feed, routerContract, updateIndicators]);

  
  // Memoize ARP data processing
  const processArpData = useCallback((chart: IChartApi, bars: ExtendedCandle[]) => {
    createArpSeries(chart);

    if (!bars.length) {
      feed.time().then(t => {
        const dummyArp = { time: t, price: 0, confidence: 0, hops: 0 };
        arpDataRef.current = [dummyArp];
        priceLineSeriesRef.current?.setData([{ time: t, value: 0 }]);
        confidenceSeriesRef.current?.setData([{ time: t, value: 0 }]);
      }).catch(() => { });
      lastBarRef.current = null;
      return;
    }

    const arpData: ArpCandle[] = bars.map(bar => ({
      time: bar.time,
      price: bar.close,
      confidence: bar.confidence ?? 0,
      hops: bar.hops ?? 0,
    }));

    arpDataRef.current = arpData;

    const priceData = arpData.map(d => ({ time: d.time, value: d.price }));
    priceLineSeriesRef.current?.setData(priceData);

    const confidenceData = arpData.map(d => ({ time: d.time, value: d.confidence * 100 }));
    confidenceSeriesRef.current?.setData(confidenceData);

    closesRef.current = arpData.map(d => d.price);
    lastTimeRef.current = arpData[arpData.length - 1]?.time ?? null;

    const lastArp = arpData[arpData.length - 1];
    if (lastArp) {
      lastBarRef.current = {
        time: lastArp.time,
        open: lastArp.price,
        high: lastArp.price,
        low: lastArp.price,
        close: lastArp.price,
        confidence: lastArp.confidence,
        hops: lastArp.hops,
      } as any;
    }
  }, [feed]);

  // Memoize OHLC data processing
  const processOhlcData = useCallback((chart: IChartApi, bars: ExtendedCandle[]) => {
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceFormat: { type: 'price', precision, minMove },
    }, 0);

    candleSeriesRef.current = candles;

    if (!bars.length) {
      feed.time().then(t => {
        const z = { time: t, open: 0, high: 0, low: 0, close: 0 };
        candleSeriesRef.current?.setData([z]);
        candleDataRef.current = [z];
        renderCandlesFromBuffer();
      }).catch(() => { });
      lastBarRef.current = null;
      return;
    }

    const candleData = bars.map(b => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    candleDataRef.current = candleData;
    renderCandlesFromBuffer();
    lastBarRef.current = bars.at(-1) ?? null;

    closesRef.current = bars.map(b => b.close);
    lastTimeRef.current = bars.at(-1)?.time ?? null;

    volumeByTimeRef.current.clear();
    for (const b of bars) {
      volumeByTimeRef.current.set(Number(b.time), (b as any).volume ?? 0);
    }

    // Volume
    if (volumeSeriesRef.current) {
      let volData = bars.map((b) => ({
        time: b.time,
        value: (b as any).volume ?? 0,
        color: b.close >= b.open ? '#26a69a' : '#ef5350',
      }));

      volData = injectEpsilonAtStartIfAllZero(volData, 1);
      volumeSeriesRef.current.setData(volData);

      volumeByTimeRef.current.clear();
      for (const b of bars) {
        volumeByTimeRef.current.set(Number(b.time), (b as any).volume ?? 0);
      }
    }
  }, [feed, precision, minMove]);

  const handleArpLiveUpdate = useCallback((update: any) => {
    if (!priceLineSeriesRef.current || !confidenceSeriesRef.current) return;

    if (update.price != null) {
      priceLineSeriesRef.current.update({
        time: update.time,
        value: update.price,
      });

      if (update.confidence != null) {
        confidenceSeriesRef.current.update({
          time: update.time,
          value: update.confidence,
        });
      }

      lastBarRef.current = {
        time: update.time,
        open: update.price,
        high: update.price,
        low: update.price,
        close: update.price,
      } as Candle;
    }
  }, []);

  const handleCandleLiveUpdate = useCallback((bar: Candle) => {
    if (!candleSeriesRef.current) return;

    const resSec =
      resolution === '1' ? 60 :
      resolution === '5' ? 300 :
      resolution === '15' ? 900 :
      resolution === '60' ? 3600 :
      resolution === '240' ? 14400 :
      resolution === '1D' ? 86400 :
      null;

    if (resSec != null) {
      const t = Number(bar.time);
      if (t % resSec !== 0) {
        // ❌ this bar belongs to a lower timeframe — ignore it
        return;
      }
    }

    // Log comparison between buffer and incoming WS data
    (function logWsVsLive() {
      const t = Number(bar.time);
      const cur = candleDataRef.current.find(d => Number(d.time) === t);
      if (!cur) return; // nothing to compare yet

      const diff =
        cur.open !== bar.open ||
        cur.high !== bar.high ||
        cur.low !== bar.low ||
        cur.close !== bar.close;

      if (diff) {
        const iso = new Date(t * 1000).toISOString();
        const fmt = (n: number | undefined) => (n ?? NaN).toFixed(6);
        console.log(
          `[LIVE Δ] ${iso} t=${t} ` +
          `buf O:${fmt(cur.open)} H:${fmt(cur.high)} L:${fmt(cur.low)} C:${fmt(cur.close)}  ` +
          `ws  O:${fmt(bar.open)} H:${fmt(bar.high)} L:${fmt(bar.low)} C:${fmt(bar.close)}`
        );
      }
    })();

    const tNum = Number(bar.time);

    // ---- update or insert by timestamp (keeps order) -------------------------
    const arr = candleDataRef.current;
    let idx = arr.findIndex(d => Number(d.time) === tNum);

    if (idx !== -1) {
      // replace existing bar in-place
      arr[idx] = { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
    } else {
      // insert in order (usually append)
      const last = arr[arr.length - 1];
      if (!last || Number(last.time) < tNum) {
        arr.push({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
        idx = arr.length - 1;
      } else {
        const insAt = arr.findIndex(d => Number(d.time) > tNum);
        const pos = insAt === -1 ? arr.length : insAt;
        arr.splice(pos, 0, { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
        idx = pos;
      }
    }

    renderCandlesFromBuffer();

    // ---- closesRef & lastTimeRef maintenance ---------------------------------
    const isLast = idx === candleDataRef.current.length - 1;
    if (!isLast) {
      // Rebuild closesRef from buffer if we changed a non-last bar
      closesRef.current = candleDataRef.current.map(b => b.close);
    } else {
      const hadAny = closesRef.current.length > 0;
      if (!hadAny || Number(lastTimeRef.current ?? 0) < tNum) {
        closesRef.current.push(bar.close);
        lastTimeRef.current = bar.time;
        // commit ephemeral EMA preview -> committed base
        for (const cfg of indicators.ema) {
          if (!cfg.enabled) continue;
          const eph = emaEphemeralRef.current.get(cfg.id);
          if (eph != null) emaCommittedRef.current.set(cfg.id, eph);
        }
      } else {
        closesRef.current[closesRef.current.length - 1] = bar.close;
      }
    }

    // ---- EMA incremental preview (still only needs to touch the last bar) ----
    for (const cfg of indicators.ema) {
      if (!cfg.enabled) continue;
      const s = emaSeriesRef.current.get(cfg.id);
      if (!s) continue;

      const alpha = 2 / (cfg.period + 1);
      let base = emaCommittedRef.current.get(cfg.id);
      if (base == null) base = seedEmaFromCloses(cfg.period);
      if (base == null) continue;

      const eph = base + alpha * (bar.close - base);
      s.update?.({ time: bar.time, value: eph });
      emaEphemeralRef.current.set(cfg.id, eph);

      // If a non-last candle was changed, our preview may be off;
      // safest is to recompute a short tail in that case:
      if (!isLast) {
        const vals = computeEMA(closesRef.current, cfg.period);
        const startIdx = closesRef.current.length - vals.length;
        const lineData = vals.map((v, i) => ({
          time: candleDataRef.current[startIdx + i].time,
          value: v,
        }));
        s.setData?.(lineData);
        const last = lineData.at(-1)?.value;
        if (last != null) emaCommittedRef.current.set(cfg.id, last);
        emaEphemeralRef.current.delete(cfg.id);
      }
    }

    // ---- Volume ---------------------------------------------------------------
    if (volumeSeriesRef.current) {
      // update in map
      volumeByTimeRef.current.set(tNum, (bar as any).volume ?? 0);

      if (isLast) {
        // Fast path: last bar -> update()
        volumeSeriesRef.current.update({
          time: bar.time,
          value: (bar as any).volume ?? 0,
          color: bar.close >= bar.open ? '#26a69a' : '#ef5350',
        });
      } else {
        // Non-last: need to re-set series data (update() only affects last)
        const volData: VolPoint[] = candleDataRef.current.map((b) => ({
          time: b.time,
          value: volumeByTimeRef.current.get(Number(b.time)) ?? 0,
          color: (b.close ?? 0) >= (b.open ?? 0) ? '#26a69a' : '#ef5350',
        }));
        volumeSeriesRef.current.setData(injectEpsilonAtStartIfAllZero(volData, 1));
      }
    }

    // ---- RSI (recompute short tail; safe for prev-bar edits) ------------------
    if (rsiSeriesRef.current && indicators.rsi.enabled && indicators.rsi.period > 0) {
      const period = indicators.rsi.period;
      const tail = Math.max(period + 2, 60);
      const slice = closesRef.current.slice(-tail);

      // pass the carry
      const rsiVals = computeRSI(slice, period, lastRSIRef.current);
      const latest = rsiVals.at(-1);

      if (typeof latest === 'number' && isFinite(latest)) {
        rsiSeriesRef.current.update({ time: bar.time, value: latest });
        lastRSIRef.current = latest; // keep carry fresh

        if (!isLast) {
          const startIdx = closesRef.current.length - rsiVals.length;
          const rsiLine = rsiVals.map((v, i) => ({
            time: candleDataRef.current[startIdx + i].time,
            value: v,
          }));
          rsiSeriesRef.current.setData(rsiLine);

          rsiAnchorsRef.current.min?.setData(
            rsiLine.map(p => ({ time: p.time, value: 0 }))
          );
          rsiAnchorsRef.current.max?.setData(
            rsiLine.map(p => ({ time: p.time, value: 100 }))
          );
        }

        if (rsiSignalSeriesRef.current) {
          const sigVals = emaOf(rsiVals, 9);
          const latestSig = sigVals.at(-1);
          if (typeof latestSig === 'number' && isFinite(latestSig)) {
            rsiSignalSeriesRef.current.update({ time: bar.time, value: latestSig });
          }
          if (!isLast) {
            const startIdx = closesRef.current.length - sigVals.length;
            const sigLine = sigVals.map((v, i) => ({
              time: candleDataRef.current[startIdx + i].time,
              value: v,
            }));
            rsiSignalSeriesRef.current.setData(sigLine);
          }
        }
      }
    }

    // Extend band to latest time (safe even if non-last changed)
    if (rsiBandSeriesRef.current) {
      rsiBandSeriesRef.current.update({ time: bar.time, value: 70 });
    }

    lastBarRef.current = bar;
  }, []);

  function removeRsi(chart: IChartApi) {
    const main = rsiSeriesRef.current;
    if (!main) return;

    const paneIndex = findPaneIndexForSeries(chart, main);
    if (paneIndex == null) return;

    rsiGuardRef.current?.remove?.();
    rsiGuardRef.current = null;

    // 🧹 PHASE 1: clear data (this trims time scale)
    rsiSeriesRef.current?.setData([]);
    rsiSignalSeriesRef.current?.setData([]);
    rsiBandSeriesRef.current?.setData([]);

    if (rsiAnchorsRef.current.min) rsiAnchorsRef.current.min.setData([]);
    if (rsiAnchorsRef.current.max) rsiAnchorsRef.current.max.setData([]);

    // 🧨 PHASE 2: remove pane (pane still owns live series)
    chart.removePane(paneIndex);

    // clear refs
    rsiSeriesRef.current = null;
    rsiSignalSeriesRef.current = null;
    rsiBandSeriesRef.current = null;
    rsiAnchorsRef.current = {};
    rsiLinesRef.current = {};
  }

  function createRsi(chart: IChartApi) {
    // always create at the bottom (new pane)
    const paneIndex = chart.panes().length;
    const UPPER = 70, LOWER = 30;

    rsiBandSeriesRef.current = chart.addSeries(
      BaselineSeries,
      {
        baseValue: { type: 'price', price: LOWER },
        lineWidth: 1,
        lineStyle: 3,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        topLineColor: 'transparent',
        bottomLineColor: 'transparent',
        topFillColor1: 'rgba(128,128,128,0.12)',
        topFillColor2: 'rgba(128,128,128,0.12)',
        bottomFillColor1: 'rgba(0,0,0,0)',
        bottomFillColor2: 'rgba(0,0,0,0)',
      },
      paneIndex,
    );
    chart.panes()[paneIndex]?.setHeight(120);

    // visible RSI + signal
    rsiSeriesRef.current = chart.addSeries(
      LineSeries,
      { color: 'rgb(216, 180, 254)', lineWidth: 1, priceLineVisible: false, crosshairMarkerVisible: false },
      paneIndex,
    );
    rsiSignalSeriesRef.current = chart.addSeries(
      LineSeries,
      { color: 'rgba(216, 144, 212, 0.35)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
      paneIndex,
    );

    // threshold lines
    rsiLinesRef.current.upper = rsiSeriesRef.current.createPriceLine({
      price: UPPER, color: '#80808066', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: String(UPPER),
    });
    rsiLinesRef.current.lower = rsiSeriesRef.current.createPriceLine({
      price: LOWER, color: '#80808066', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: String(LOWER),
    });

    // lock scale via autoscale (prevents vertical pan)…
    const rsiScale = rsiSeriesRef.current.priceScale();
    rsiScale.applyOptions({ autoScale: true, scaleMargins: { top: 0.05, bottom: 0.05 } });

    // …and pin autoscale to [0,100] with invisible anchors
    const rsiAnchorMin = chart.addSeries(
      LineSeries,
      { color: 'rgba(0,0,0,0)', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
      paneIndex,
    );
    const rsiAnchorMax = chart.addSeries(
      LineSeries,
      { color: 'rgba(0,0,0,0)', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
      paneIndex,
    );

    // Store anchor refs for cleanup
    rsiAnchorsRef.current = { min: rsiAnchorMin, max: rsiAnchorMax };
  }

  function seedEmaFromCloses(period: number): number | undefined {
    const N = period;
    const arr = closesRef.current;
    if (arr.length >= N) {
      let sum = 0;
      for (let i = arr.length - N; i < arr.length; i++) sum += arr[i];
      return sum / N; // SMA seed for EMA
    }
    return undefined;
  }

  function computeHeikinAshi(
    src: Array<{ time: Time; open: number; high: number; low: number; close: number }>
  ) {
    if (!src.length) return src;
    const out: typeof src = [];
    let prevOpen = (src[0].open + src[0].close) / 2;
    let prevClose = (src[0].open + src[0].high + src[0].low + src[0].close) / 4;

    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      const haClose = (c.open + c.high + c.low + c.close) / 4;
      const haOpen = i === 0 ? (c.open + c.close) / 2 : (prevOpen + prevClose) / 2;
      const haHigh = Math.max(c.high, haOpen, haClose);
      const haLow = Math.min(c.low, haOpen, haClose);
      out.push({ time: c.time, open: haOpen, high: haHigh, low: haLow, close: haClose });
      prevOpen = haOpen;
      prevClose = haClose;
    }
    return out;
  }

  function renderCandlesFromBuffer() {
    if (!candleSeriesRef.current) return;
    const src = candleDataRef.current;
    const mode = candleModeRef.current;
    const data = mode === 'heikin' ? computeHeikinAshi(src) : src;
    candleSeriesRef.current.setData(data);
  }

  const computeEMA = (closes: number[], period: number) => {
    const out: number[] = [];
    if (!closes.length || period <= 0) return out;

    const k = 2 / (period + 1);
    let ema: number | undefined;

    for (let i = 0; i < closes.length; i++) {
      const c = closes[i];
      if (ema === undefined) {
        if (i + 1 < period) continue; // warmup
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += closes[j];
        ema = sum / period;
      } else {
        ema = ema + k * (c - ema);
      }
      out.push(ema);
    }
    return out;
  };

  const EPSILON = 1e-12;

  // Wilder RSI
  const computeRSI = (closes: number[], period: number, carry?: number) => {
    const n = closes.length;
    if (n < period + 1) return [] as number[];

    // If the ENTIRE slice is flat, carry last RSI (fallback 50)
    let allEqual = true;
    for (let i = 1; i < n; i++) {
      if (Math.abs(closes[i] - closes[0]) > EPSILON) { allEqual = false; break; }
    }
    if (allEqual) {
      const val = (typeof carry === 'number' && isFinite(carry)) ? carry : 50;
      const outLen = n - period; // matches normal RSI output length
      return outLen > 0 ? Array(outLen).fill(val) : [];
    }

    // --- normal Wilder RSI ---
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < n; i++) {
      const diff = closes[i] - closes[i - 1];
      gains.push(Math.max(0, diff));
      losses.push(Math.max(0, -diff));
    }

    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;

    const rsi: number[] = [];
    const firstRS = avgLoss <= EPSILON ? Infinity : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + firstRS));

    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      const rs = avgLoss <= EPSILON ? Infinity : avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }

    return rsi;
  };

  const emaOf = (arr: number[], p: number) => {
    if (!arr.length || p <= 0) return [] as number[];
    const k = 2 / (p + 1);
    let e: number | undefined;
    const out: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (e === undefined) e = v;
      else e = e + k * (v - e);
      out.push(e);
    }
    return out;
  };

  const bumpCandlesToTop = () => {
    const chart = chartRef.current;
    const old = candleSeriesRef.current;
    if (!chart || !old) return;

    const newCandles = chart.addSeries(
      CandlestickSeries,
      {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        priceFormat: { type: 'price', precision, minMove },
      },
      0,
    );

    candleSeriesRef.current = newCandles;
    chart.removeSeries(old);

    if (candleDataRef.current.length) renderCandlesFromBuffer();
  };

  const jumpToRecent = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().fitContent();
  }, []);

  /* ---------------- mount / init ---------------- */

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const onRange = (r: any) => {
      if (!r) return;
      rsiGuardRef.current?.update(r.from, r.to);
      volGuardRef.current?.update(r.from, r.to);

      // Check if we need to load more historical data
      if (earliestLoadedTimeRef.current !== null && hasMoreDataRef.current) {
        const visibleFrom = r.from as number;
        const earliestLoaded = earliestLoadedTimeRef.current;

        // Calculate buffer zone (20% of visible range)
        const visibleRange = (r.to as number) - visibleFrom;
        const bufferZone = visibleRange * 0.2;

        // Trigger load if we're within buffer zone of earliest data
        if (visibleFrom < earliestLoaded + bufferZone) {
          loadMoreHistoricalData();
        }
      }
    };

    onRange(chart.timeScale().getVisibleRange?.());
    chart.timeScale().subscribeVisibleTimeRangeChange(onRange);
    return () => chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
  }, [loadMoreHistoricalData]);

  useEffect(() => {
    if (!containerRef.current) return;

    const bg = theme === 'dark' ? '#000000b0' : '#ffffff';
    const fg = theme === 'dark' ? '#c9d1d9' : '#1f2328';
    const grid = theme === 'dark' ? '#1b223060' : '#e6e8eb';

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: fg,
        panes: {
          separatorColor: 'rgba(133, 190, 236, 0.3)',
          separatorHoverColor: 'rgba(128, 128, 128, 0.15)',
          enableResize: true,
        },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const candles = chart.addSeries(
      CandlestickSeries,
      {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        priceFormat: { type: 'price', precision, minMove },
      },
      0,
    );

    const resize = () => {
      const el = containerRef.current!;
      const w = el.clientWidth || 300;
      const h = el.clientHeight || 200;
      chart.applyOptions({ width: w, height: h });
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    chartRef.current = chart;
    candleSeriesRef.current = candles;

    return () => {
      ro.disconnect();

      for (const s of emaSeriesRef.current.values()) chart.removeSeries?.(s);
      emaSeriesRef.current.clear();
      emaCommittedRef.current.clear();
      emaEphemeralRef.current.clear();

      if (volumeSeriesRef.current) chart.removeSeries(volumeSeriesRef.current);
      if (rsiSignalSeriesRef.current) chart.removeSeries(rsiSignalSeriesRef.current);
      if (rsiSeriesRef.current) chart.removeSeries(rsiSeriesRef.current);
      if (rsiBandSeriesRef.current) chart.removeSeries(rsiBandSeriesRef.current);
      if (rsiAnchorsRef.current.min) chart.removeSeries(rsiAnchorsRef.current.min);
      if (rsiAnchorsRef.current.max) chart.removeSeries(rsiAnchorsRef.current.max);
      volumeSeriesRef.current = null;
      rsiSignalSeriesRef.current = null;
      rsiSeriesRef.current = null;
      rsiBandSeriesRef.current = null;
      rsiAnchorsRef.current = {};
      rsiLinesRef.current = {};

      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // price scale toggle
  useEffect(() => {
    const scale = candleSeriesRef.current?.priceScale?.();
    if (!scale) return;
    scale.applyOptions({
      mode: isLog ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [isLog]);

  // keep candle precision in sync when symbol changes
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({
      priceFormat: { type: 'price', precision, minMove },
    });
    for (const s of emaSeriesRef.current.values()) {
      s.applyOptions?.({ priceFormat: { type: 'price', precision, minMove } });
    }
  }, [precision, minMove]);

  useEffect(() => {
    candleModeRef.current = candleMode;
    renderCandlesFromBuffer();
  }, [candleMode]);

  /* ---------------- EMA overlays ---------------- */

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const cfg of indicators.ema) {
      let s = emaSeriesRef.current.get(cfg.id);

      if (!s) {
        s = chart.addSeries(
          LineSeries,
          {
            color: cfg.color,
            lineWidth: (cfg as any).width ?? 1,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
            priceFormat: { type: 'price', precision, minMove },
          },
          0,
        );
        emaSeriesRef.current.set(cfg.id, s);
      }

      if (cfg.enabled) {
        s.applyOptions?.({ visible: true });
      } else {
        s.setData([]);
        s.applyOptions?.({ visible: false });
      }
    }

    bumpCandlesToTop();
  }, [indicators.ema, minMove, precision]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Volume toggled ON
    if (indicators.showVolume && !volumeSeriesRef.current) {
      createVolume(chart);

      if (candleDataRef.current.length > 0 && volumeSeriesRef.current) {
        const volData = candleDataRef.current.map((b) => ({
          time: b.time,
          value: volumeByTimeRef.current.get(Number(b.time)) ?? 0,
          color: (b.close ?? 0) >= (b.open ?? 0) ? '#26a69a' : '#ef5350',
        }));
        volumeSeriesRef.current.setData(injectEpsilonAtStartIfAllZero(volData, 1));
      }
    }

    // Volume toggled OFF
    if (!indicators.showVolume && volumeSeriesRef.current) {
      removeVolume(chart);
    }

    // RSI toggled ON (always goes to bottom; if volume is on, it naturally becomes pane 2)
    if (indicators.rsi.enabled && !rsiSeriesRef.current) {
      createRsi(chart);
    }

    // RSI toggled OFF
    if (!indicators.rsi.enabled && rsiSeriesRef.current) {
      removeRsi(chart);
    }

    enforcePaneOrder(chart);
  }, [indicators.showVolume, indicators.rsi.enabled]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const onMove = (param: any) => {
      if (!param?.time) { setHover(null); return; }

      const t = timeToSec(param.time);
      const arr = candleDataRef.current;
      const idx = arr.findIndex(d => timeToSec(d.time) === t);
      if (idx === -1) { setHover(null); return; }

      // choose source based on current mode
      const src = candleModeRef.current === 'heikin' && heikinRef.current.length
        ? heikinRef.current
        : arr;

      const b = src[idx];
      const vol = volumeByTimeRef.current.get(t);

      setHover({
        time: b.time,
        open: b.open, high: b.high, low: b.low, close: b.close,
        volume: vol,
        isUp: (b.close ?? 0) >= (b.open ?? 0),
      });
    };

    chart.subscribeCrosshairMove(onMove);
    return () => { chart.unsubscribeCrosshairMove(onMove); };
  }, []);

  useEffect(() => {
    if (hover !== null) return;
    const last = lastBarRef.current;
    if (!last) return;
    const t = Number(last.time);
    const vol = volumeByTimeRef.current.get(t);
    setHover({
      time: last.time,
      open: last.open, high: last.high, low: last.low, close: last.close,
      volume: vol, isUp: last.close >= last.open,
    });
  }, [hover, lastBarRef]);

  /* ---------------- history + live ---------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const chart = chartRef.current;
      if (!chart) return;

      // Capture reset flag before async work
      const needsReset = shouldResetView;
      if (needsReset) clearResetView();

      // Reset all series and data
      removeArpSeries(chart);
      removeCandleSeries(chart);

      // Clear all data references
      candleDataRef.current = [];
      arpDataRef.current = [];
      
      for (const s of emaSeriesRef.current.values()) s.setData?.([]);
      closesRef.current = [];
      lastTimeRef.current = null;
      emaCommittedRef.current.clear();
      emaEphemeralRef.current.clear();

      volumeByTimeRef.current.clear(); 

      // Reset infinite scroll state
      earliestLoadedTimeRef.current = null;
      isLoadingMoreRef.current = false;
      hasMoreDataRef.current = true;
      dataTypeRef.current = null;

      if (volumeSeriesRef.current) volumeSeriesRef.current.setData?.([]);
      if (rsiSeriesRef.current) rsiSeriesRef.current.setData?.([]);
      if (rsiSignalSeriesRef.current) rsiSignalSeriesRef.current.setData?.([]);
      if (rsiBandSeriesRef.current) rsiBandSeriesRef.current.setData?.([]);

      const now = Math.floor(Date.now() / 1000);
      const from = now - rangeFor(resolution);

      const bars = await loadHistoricalData(chart, symbol, resolution, from, now);
      if (cancelled) return;

      // Detect ARP data from response
      const isArpResponse = bars.length > 0 && bars[0].isArpData === true;
      
      console.log('[Chart] Loaded history:', { 
        symbol, 
        barCount: bars.length, 
        isArpResponse,
        firstBar: bars[0] 
      });

      // Initialize infinite scroll state
      if (bars.length > 0) {
        earliestLoadedTimeRef.current = from;
        dataTypeRef.current = isArpResponse ? 'arp' : 'ohlc';
        hasMoreDataRef.current = true;
      } else {
        earliestLoadedTimeRef.current = null;
        dataTypeRef.current = null;
        hasMoreDataRef.current = false;
      }

      if (isArpResponse) {
        processArpData(chart, bars);
      } else {
        processOhlcData(chart, bars);
      }

      // Update indicators after data is loaded
      if (bars.length > 0) {
        updateIndicators(bars, isArpResponse);
      }

      // Reset view for new symbols, or just fit content on initial load
      if (!cancelled && needsReset) {
        requestAnimationFrame(() => {
          chart.timeScale().fitContent();
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    symbol, 
    resolution, 
    loadHistoricalData, 
    processArpData, 
    processOhlcData, 
    shouldResetView,
    clearResetView,
  ]);

  // Effect 2: Update indicators when indicator settings change (but not symbol/resolution)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Only update if we have existing data
    const hasData = candleDataRef.current.length > 0 || arpDataRef.current.length > 0;
    if (!hasData) return;

    const bars = arpDataRef.current.length > 0 ? arpDataRef.current : candleDataRef.current;
    const isArp = arpDataRef.current.length > 0;

    updateIndicators(bars, isArp);
  }, [
    indicators.ema,
    indicators.rsi.enabled,
    indicators.rsi.period,
    updateIndicators
  ]);

  // Effect 3: Handle live subscription
  const { update: liveUpdate, isArpData: isLiveArpData, status } = useChartFeed(
    symbol, 
    resolution, 
    { 
      router: routerContract,
      onStale: handleStaleData
    }
  );

  // Effect 3: Handle live updates from the hook
  useEffect(() => {
    if (!liveUpdate) return;
    
    console.log('[Chart] Live update received:', liveUpdate, 'isArpData:', isLiveArpData);
    
    if (isLiveArpData) {
      handleArpLiveUpdate(liveUpdate);
    } else {
      handleCandleLiveUpdate(liveUpdate);
    }
  }, [liveUpdate, isLiveArpData, handleArpLiveUpdate, handleCandleLiveUpdate]);

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      <ChartControls 
        className="absolute top-2 left-2 z-50" 
        onJumpToRecent={jumpToRecent}
      />
      {status === 'connecting' && (
        <div className="absolute top-2 right-[6.5rem] z-50 text-xs text-yellow-500">
          Connecting...
        </div>
      )}
      {status === 'error' && (
        <div className="absolute top-2 right-[6.5rem] z-50 text-xs text-red-500">
          Connection Error
        </div>
      )}
      {isRefreshing && (
        <div className="absolute top-2 right-[6.5rem] z-50 flex items-center gap-2 text-xs text-yellow-500">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Refreshing...</span>
        </div>
      )}
      
      {/* Hover HUD */}
      <div
        className="absolute left-2 top-[68px] z-40 text-xs flex items-center gap-3 rounded-md border border-white/10 bg-black/35 px-2 py-1 backdrop-blur"
        style={{ pointerEvents: 'none' }}
      >
        <span className="text-neutral-400">{fmtTime(hover?.time)}</span>

        <span className="text-neutral-400">O</span>
        <span className="text-neutral-200">{fmtPrice(hover?.open)}</span>

        <span className="text-neutral-400">H</span>
        <span className="text-neutral-2 00">{fmtPrice(hover?.high)}</span>

        <span className="text-neutral-400">L</span>
        <span className="text-neutral-200">{fmtPrice(hover?.low)}</span>

        <span className="text-neutral-400">C</span>
        <span
          className="font-medium"
          style={{ color: hover?.isUp ? UP_COLOR : DOWN_COLOR }}
        >
          {fmtPrice(hover?.close)}
        </span>

        {/* % change right after C */}
        {(() => {
          const o = hover?.open ?? null;
          const c = hover?.close ?? null;
          const pct =
            o && o !== 0 && typeof c === 'number'
              ? ((c - o) / o) * 100
              : null;
          const txt =
            pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
          return (
            <span
              className="font-medium"
              style={{ color: pct !== null && pct < 0 ? DOWN_COLOR : UP_COLOR }}
            >
              {txt}
            </span>
          );
        })()}

        {indicators.showVolume && (
          <>
            <span className="text-neutral-400">Vol</span>
            <span
              className="font-medium"
              style={{ color: hover?.isUp ? UP_COLOR : DOWN_COLOR }}
            >
              {fmtVol(hover?.volume, base, quote, hover?.close)}
            </span>
          </>
        )}
      </div>
      <div
        className={`price-scale-toggle ${isLog ? 'is-log' : ''}`}
        style={{ width: '55px' }}
        role="button"
        aria-label="Toggle price scale"
        onClick={() => setIsLog(v => !v)}
      >
      <Tooltip content={`Click to Switch to ${isLog ? 'Linear' : 'Logarithmic'} Chart Display`} position='left' delay={1000}>
        {/* Cross-fade label */}
        <span className="label">
          <span className="t t--lin math-italic select-none">lin</span>
          <span className="t t--log math-italic select-none">log</span>
        </span>
      </Tooltip>
      </div>
    </div>
  );
};

export default memo(Chart);