import React, {
  useEffect,
  memo,
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { useChart } from '@/contexts/ChartContext';
import Chart from '@/components/ui/Chart';
import { SwapPanel } from '../SwapPanel';
import Portfolio from '../portfolio/Portfolio';
import MarketBrowser from '../MarketBrowser';
import type { TradingViewProps } from '@/types/trade';
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { NATIVE_ASSET_HASH } from '@/contexts/NodeContext';

const LS_KEY_BROWSER = 'proTradingView.browserCollapsed';
const LS_KEY_MARKET = 'proTradingView.marketCollapsed';

// simple portal to <body>
const Portal = memo<{ children: React.ReactNode }>(({ children }) => {
  const [mounted, setMounted] = useState(false);
  const bodyRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    bodyRef.current = typeof document !== 'undefined' ? document.body : null;
    setMounted(true);
  }, []);

  if (!mounted || !bodyRef.current) return null;
  return createPortal(children, bodyRef.current);
});
Portal.displayName = 'Portal';

const PlaceholderPanel: React.FC<{ title: string; subtitle?: string }> = memo(
  ({ title, subtitle }) => (
    <div className="p-6 h-full flex items-center justify-center">
      <div className="text-white/50 text-center">
        <div className="text-lg font-medium mb-2">{title}</div>
        {subtitle && <div className="text-sm">{subtitle}</div>}
        <div className="text-xs mt-3 opacity-75">Coming Soon</div>
      </div>
    </div>
  )
);
PlaceholderPanel.displayName = 'PlaceholderPanel';

export const ProTradingView: React.FC<TradingViewProps> = memo((props) => {
  const { selectedAssets, poolAssets, selectAsset, setAmount } = props;
  const { setSymbol, setTokenPair, displayMode } = useChart();

  // Market browser click handlers
  const handleSelectPair = useCallback((aHash: string, bHash: string) => {
    selectAsset('from', aHash);
    selectAsset('to', bHash);
  }, [selectAsset]);

  const handleSelectAsset = useCallback((hash: string) => {
    selectAsset('from', NATIVE_ASSET_HASH);
    selectAsset('to', hash); // Clear the "to" selection
    setAmount('to', ''); // Clear the "to" amount
  }, [selectAsset, setAmount]);

  // collapsed states — load directly from localStorage to avoid flicker
  const [isBrowserCollapsed, setIsBrowserCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const v = window.localStorage.getItem(LS_KEY_BROWSER);
      return v === '1';
    } catch {
      return false;
    }
  });

  const [isMarketDataCollapsed, setIsMarketDataCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const v = window.localStorage.getItem(LS_KEY_MARKET);
      return v === '1';
    } catch {
      return false;
    }
  });

  // save to localStorage on change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LS_KEY_BROWSER, isBrowserCollapsed ? '1' : '0');
    } catch {}
  }, [isBrowserCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LS_KEY_MARKET, isMarketDataCollapsed ? '1' : '0');
    } catch {}
  }, [isMarketDataCollapsed]);

  // refs to measure
  const browserPanelRef = useRef<HTMLDivElement | null>(null);
  const marketDataRef = useRef<HTMLDivElement | null>(null);

  // portal positions
  const [browserBtnPos, setBrowserBtnPos] = useState({ top: 0, left: 0 });
  const [marketBtnPos, setMarketBtnPos] = useState({ top: 0, left: 0 });

  // single rAF
  const rafRef = useRef<number | null>(null);

  // token resolution
  const fromToken = poolAssets.get(selectedAssets.from);
  const toToken = poolAssets.get(selectedAssets.to);

  const { hashSymbol, tickerSymbol, baseToken, quoteToken } = React.useMemo(() => {
    if (fromToken?.hash && toToken?.hash && fromToken?.ticker && toToken?.ticker) {
      const tokens = [
        { hash: fromToken.hash, ticker: fromToken.ticker, name: fromToken.name },
        { hash: toToken.hash, ticker: toToken.ticker, name: toToken.name },
      ].sort((a, b) => a.hash.localeCompare(b.hash));

      const [quoteToken, baseToken] = tokens;

      return {
        hashSymbol: `${baseToken.hash}_${quoteToken.hash}`,
        tickerSymbol: `${baseToken.ticker}/${quoteToken.ticker}`,
        baseToken,
        quoteToken,
      };
    }

    return {
      hashSymbol: 'XEL_USD',
      tickerSymbol: 'XEL/USD',
      baseToken: null,
      quoteToken: null,
    };
  }, [fromToken?.hash, toToken?.hash, fromToken?.ticker, toToken?.ticker]);

  // push to chart ctx
  useEffect(() => {
    if (baseToken && quoteToken) {
      setTokenPair({ base: baseToken, quote: quoteToken });

      let finalHashSymbol = hashSymbol;
      let finalTickerSymbol = tickerSymbol;

      switch (displayMode) {
        case 'inverted':
          finalHashSymbol = `${quoteToken.hash}_${baseToken.hash}`;
          finalTickerSymbol = `${quoteToken.ticker}/${baseToken.ticker}`;
          break;
        case 'base-usd':
          finalHashSymbol = `${baseToken.hash}_USD`;
          finalTickerSymbol = `${baseToken.ticker}/USD`;
          break;
        case 'quote-usd':
          finalHashSymbol = `${quoteToken.hash}_USD`;
          finalTickerSymbol = `${quoteToken.ticker}/USD`;
          break;
      }

      setSymbol(finalHashSymbol, finalTickerSymbol);
    } else {
      setTokenPair(null);
      setSymbol(hashSymbol, tickerSymbol);
    }
  }, [hashSymbol, tickerSymbol, baseToken, quoteToken, displayMode, setSymbol, setTokenPair]);

  // measuring helpers
  const measureBrowser = useCallback(() => {
    if (!browserPanelRef.current) return;
    const rect = browserPanelRef.current.getBoundingClientRect();
    setBrowserBtnPos({
      top: rect.top + rect.height / 2,
      left: rect.right - 10,
    });
  }, []);

  const measureMarket = useCallback(() => {
    if (!marketDataRef.current) return;
    const rect = marketDataRef.current.getBoundingClientRect();
    setMarketBtnPos({
      top: rect.top - 14,
      left: rect.left + rect.width / 2,
    });
  }, []);

  // rAF tracker for both
  const startTracking = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const start = performance.now();
    const duration = 360;

    const tick = (now: number) => {
      const elapsed = now - start;
      measureBrowser();
      measureMarket();
      if (elapsed < duration) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [measureBrowser, measureMarket]);

  // initial measure + resize
  useLayoutEffect(() => {
    measureBrowser();
    measureMarket();
    const onResize = () => {
      measureBrowser();
      measureMarket();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [measureBrowser, measureMarket]);

  // track when either panel changes
  useLayoutEffect(() => {
    startTracking();
  }, [isBrowserCollapsed, startTracking]);

  useLayoutEffect(() => {
    startTracking();
  }, [isMarketDataCollapsed, startTracking]);

  return (
    <div className="flex h-full min-w-0 rounded-xl bg-black/35 m-3 mt-0 border border-forge-orange/10 shadow-[0_0_15px_1px_var(--color-forge-orange)]/20">
      {/* LEFT MAIN SECTION */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* TOP ROW: browser + chart */}
        <div className="flex flex-1 m-2 gap-4 min-h-0 min-w-0">
          {/* Market Browser (collapsible) */}
          <div
            ref={browserPanelRef}
            className={`relative bg-black/50 rounded-md overflow-hidden -mr-2 transition-all duration-300 ease-out border border-forge-orange/10 ${
              isBrowserCollapsed ? 'w-0 opacity-0' : 'w-90 opacity-100'
            }`}
          >
            {!isBrowserCollapsed && (
              <div className="animate-fadeIn h-full">
                <MarketBrowser
                  onSelectPair={handleSelectPair}
                  onSelectAsset={handleSelectAsset}
                />
              </div>
            )}
          </div>

          {/* CHART */}
          <div className="flex-1 min-w-0 rounded-lg border border-forge-orange/10 overflow-hidden">
            <Chart className="w-full h-full" theme="dark" />
          </div>
        </div>

        {/* BOTTOM: Market Data (collapsible) */}
        <div
          ref={marketDataRef}
          className={`transition-all duration-300 ease-out ${
            isMarketDataCollapsed ? 'h-2' : 'h-56'
          }`}
        >
          <div className="relative h-full">
            <div className="h-full p-2 pt-0">
              {isMarketDataCollapsed ? (
                <div className="h-full bg-black/50 rounded-md border border-forge-orange/10" />
              ) : (
                <div className="h-full bg-black/50 rounded-md border border-forge-orange/10">
                  <PlaceholderPanel
                    title="Market Data"
                    subtitle="Order book, recent trades, etc."
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: fixed column */}
      <div className="w-110 shrink-0 border-l border-forge-orange/10 flex flex-col overflow-y-auto mb-[0.5rem]">
        <SwapPanel {...props} />
        <div className="flex-1 border-t border-forge-orange/10 p-2 min-h-0">
          <Portfolio onSelect={() => {}} />
        </div>
      </div>

      {/* TOGGLES */}
      <Button
        onClick={() => setIsBrowserCollapsed((v) => !v)}
        className="!fixed !p-0 !bg-transparent !border-none !shadow-none
                    w-7 h-7 rounded-full flex items-center justify-center
                    hover:bg-forge-orange/20 transition
                    z-[5]"
        style={{
          top: browserBtnPos.top,
          left: browserBtnPos.left,
          transform: 'translateY(-50%)',
        }}
        focusOnClick={false}
      >
        {isBrowserCollapsed ? (
          <ChevronRight className="w-8 h-8 text-forge-orange drop-shadow-[0_0_10px_var(--color-forge-orange)]/50" />
        ) : (
          <ChevronLeft className="w-8 h-8 text-forge-orange drop-shadow-[0_0_10px_var(--color-forge-orange)]/50" />
        )}
      </Button>

      <Button
        onClick={() => setIsMarketDataCollapsed((v) => !v)}
        className="!fixed !p-0 !bg-transparent !border-none !shadow-none
                    w-7 h-7 rounded-full flex items-center justify-center
                    hover:bg-forge-orange/20 transition
                    z-[5]"
        style={{
          top: marketBtnPos.top,
          left: marketBtnPos.left,
          transform: 'translateX(-50%)',
        }}
        focusOnClick={false}
      >
        {isMarketDataCollapsed ? (
          <ChevronUp className="w-8 h-8 text-forge-orange drop-shadow-[0_0_10px_var(--color-forge-orange)]/50" />
        ) : (
          <ChevronDown className="w-8 h-8 text-forge-orange drop-shadow-[0_0_10px_var(--color-forge-orange)]/90" />
        )}
      </Button>
    </div>
  );
});

ProTradingView.displayName = 'ProTradingView';

export default memo(ProTradingView);
