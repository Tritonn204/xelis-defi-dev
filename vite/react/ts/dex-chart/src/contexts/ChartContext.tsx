import React from 'react';
import type { Resolution, Candle } from '../lib/types';
import { DataFeed } from '../lib/datafeed';

/* ---------------------- Indicator types ---------------------- */
export type EMAConfig = {
  id: string;          // stable key for UI
  period: number;
  color: string;
  enabled: boolean;
};

export type CandleMode = 'standard' | 'heikin';

export type IndicatorsState = {
  ema: EMAConfig[];                 // multi-EMA support
  rsi: { enabled: boolean; period: number };
  showVolume: boolean;
};

/* ---------------------- Chart state shape ---------------------- */
export type ChartState = {
  symbol: string;
  resolution: Resolution;
  setSymbol: (s: string) => void;
  setResolution: (r: Resolution) => void;

  indicators: IndicatorsState;
  setIndicators: React.Dispatch<React.SetStateAction<IndicatorsState>>;

  candleMode: CandleMode;
  setCandleMode: (m: CandleMode) => void;

  addEma: (cfg: Omit<EMAConfig, 'id'> & { id?: string }) => void;
  updateEma: (id: string, patch: Partial<EMAConfig>) => void;
  removeEma: (id: string) => void;
  toggleEma: (id: string, enabled?: boolean) => void;
  toggleRsi: (enabled?: boolean) => void;
  resetIndicators: () => void;

  feed: DataFeed;
  lastBarRef: React.RefObject<Candle | null>;
};

/* ---------------------- Defaults ---------------------- */
const normalizeSymbol = (s: string) =>
  s.trim().toUpperCase().replace(/\s+/g, '').replace('/', '_');

const DEFAULT_SYMBOL = 'XEL_USD';
const DEFAULT_RESOLUTION: Resolution = '5';
const DEFAULT_CANDLE_MODE: CandleMode = 'standard';

const DEFAULT_INDICATORS: IndicatorsState = {
  ema: [
    { id: 'ema-20', period: 20, color: '#0baff5', enabled: true },
    { id: 'ema-50', period: 50, color: '#f7a82a', enabled: false },
  ],
  rsi: { enabled: false, period: 14 },
  showVolume: true,
};

/* ---------------------- persistence hook ---------------------- */
function usePersistedState<T>(key: string, initial: T) {
  const [state, setState] = React.useState<T>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  React.useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);

  return [state, setState] as const;
}

/* Keep a single DataFeed instance (avoids StrictMode double-construct) */
function useStableDataFeed() {
  const ref = React.useRef<DataFeed | null>(null);
  if (!ref.current) ref.current = new DataFeed();
  return ref.current;
}

/* ---------------------- Context ---------------------- */
const ChartCtx = React.createContext<ChartState | null>(null);

type ProviderProps = {
  children: React.ReactNode;
  defaultSymbol?: string;
  defaultResolution?: Resolution;
  defaultIndicators?: Partial<IndicatorsState>; // override defaults
};

export const ChartProvider: React.FC<ProviderProps> = ({
  children,
  defaultSymbol = DEFAULT_SYMBOL,
  defaultResolution = DEFAULT_RESOLUTION,
  defaultIndicators,
}) => {
  // symbol / resolution (persisted)
  const [symbol, _setSymbol] = usePersistedState<string>(
    'chart:symbol',
    normalizeSymbol(defaultSymbol)
  );
  const [resolution, _setResolution] = usePersistedState<Resolution>(
    'chart:resolution',
    defaultResolution
  );
  const [candleMode, setCandleMode] = usePersistedState<CandleMode>(
    'chart:candleMode',
    DEFAULT_CANDLE_MODE
  );

  // indicators (persisted)
  const mergedDefaults: IndicatorsState = React.useMemo(() => ({
    ...DEFAULT_INDICATORS,
    ...defaultIndicators,
    ema: defaultIndicators?.ema ?? DEFAULT_INDICATORS.ema,
  }), [defaultIndicators]);

  const [indicators, setIndicators] = usePersistedState<IndicatorsState>(
    'chart:indicators',
    mergedDefaults
  );

  // data feed + last bar ref
  const feed = useStableDataFeed();
  const lastBarRef = React.useRef<Candle | null>(null);

  // setters
  const setSymbol = React.useCallback((s: string) => {
    const next = normalizeSymbol(s);
    if (next && next !== symbol) _setSymbol(next);
  }, [symbol, _setSymbol]);

  const setResolution = React.useCallback((r: Resolution) => {
    if (r !== resolution) _setResolution(r);
  }, [resolution, _setResolution]);

  // indicator helpers
  const addEma = React.useCallback((cfg: Omit<EMAConfig, 'id'> & { id?: string }) => {
    const id = cfg.id ?? `ema-${cfg.period}-${Math.random().toString(36).slice(2,7)}`;
    setIndicators(s => ({ ...s, ema: [...s.ema, { id, ...cfg }] }));
  }, [setIndicators]);

  const updateEma = React.useCallback((id: string, patch: Partial<EMAConfig>) => {
    setIndicators(s => ({
      ...s,
      ema: s.ema.map(e => e.id === id ? { ...e, ...patch } : e),
    }));
  }, [setIndicators]);

  const removeEma = React.useCallback((id: string) => {
    setIndicators(s => ({ ...s, ema: s.ema.filter(e => e.id !== id) }));
  }, [setIndicators]);

  const toggleEma = React.useCallback((id: string, enabled?: boolean) => {
    setIndicators(s => ({
      ...s,
      ema: s.ema.map(e => e.id === id ? { ...e, enabled: enabled ?? !e.enabled } : e),
    }));
  }, [setIndicators]);

  const toggleRsi = React.useCallback((enabled?: boolean) => {
    setIndicators(s => ({ ...s, rsi: { ...s.rsi, enabled: enabled ?? !s.rsi.enabled } }));
  }, [setIndicators]);

  const resetIndicators = React.useCallback(() => {
    setIndicators(mergedDefaults);
  }, [setIndicators, mergedDefaults]);

  const value = React.useMemo<ChartState>(() => ({
    symbol,
    resolution,
    setSymbol,
    setResolution,
    indicators,
    setIndicators,
    addEma,
    updateEma,
    removeEma,
    toggleEma,
    toggleRsi,
    resetIndicators,
    candleMode,
    setCandleMode,
    feed,
    lastBarRef,
  }), [
    symbol, resolution, setSymbol, setResolution,
    indicators, setIndicators,
    addEma, updateEma, removeEma, toggleEma, toggleRsi, resetIndicators,
    candleMode, setCandleMode,
    feed,
  ]);

  return <ChartCtx.Provider value={value}>{children}</ChartCtx.Provider>;
};

export const useChart = () => {
  const v = React.useContext(ChartCtx);
  if (!v) throw new Error('useChart must be used inside ChartProvider');
  return v;
};