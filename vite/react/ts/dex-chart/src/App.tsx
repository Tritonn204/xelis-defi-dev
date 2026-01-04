import './App.css'

import { Chart } from './components/Chart';
import { useChart } from './contexts/ChartContext';
import { UI_RES_OPTIONS, type Resolution } from './constants';
import { Sparkline } from './components/Sparkline';
import React from 'react';

const normalizePair = (s: string) =>
  s.toUpperCase().replace(/\s+/g, '').replace('/', '_');

const splitPair = (s: string): { base: string; quote: string } => {
  const parts = normalizePair(s).split('_').filter(Boolean);
  if (parts.length >= 2) return { base: parts[0], quote: parts[1] };
  if (parts.length === 1) return { base: parts[0], quote: 'XEL' }; // sensible default
  return { base: 'XEL', quote: 'USD' };
};

const toUsdSymbol = (ticker: string) =>
  ticker === 'USD' ? 'XEL_USD' : `${ticker}_USD`;

function App() {
  const { symbol } = useChart();

  const { base, quote } = React.useMemo(() => splitPair(symbol), [symbol]);
  const baseUsdSymbol = React.useMemo(() => toUsdSymbol(base), [base]);
  const quoteUsdSymbol = React.useMemo(() => toUsdSymbol(quote), [quote]);

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0f1115]">
      <Topbar />

      <div className="flex w-[66vw] h-[75vh] rounded-lg border-white/10 p-5 border-1 bg-[#0f1115]">
        <Chart className="flex w-full h-full" />
      </div>

      <div className="p-2 grid grid-cols-2 gap-4 bg-[#0f1115] w-[50vw]">
        <div className="rounded-xl p-3 bg-black/30">
          <div className="mb-2 text-sm text-neutral-300">{base}</div>
          <Sparkline
            symbol={baseUsdSymbol}
            height={96}
            strokeFrom="#462013"
            strokeTo="#ffffff"
            smooth="ema"
            emaPeriod={15}
            showArea
            areaFrom="#462013"
            areaTo="#462013"
            areaOpacityTop={1.0}
            areaOpacityBottom={0.0}
          />
        </div>

        {quote != 'USD' && (<div className="rounded-xl p-3 bg-black/30">
          <div className="mb-2 text-sm text-neutral-300">{quote}</div>
          <Sparkline
            symbol={quoteUsdSymbol}
            height={96}
            strokeFrom="#462013"
            strokeTo="#ffffff"
            smooth="ema"
            emaPeriod={15}
            showArea
            areaFrom="#462013"
            areaTo="#462013"
            areaOpacityTop={1.0}
            areaOpacityBottom={0.0}
          />
        </div>)}
      </div>
    </div>
  );
}

function Topbar() {
  const { symbol, setSymbol, resolution, setResolution } = useChart();

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1b2230] bg-[#151922] text-[#c9d1d9]">
      <label className="text-sm">Symbol</label>
      <input
        value={symbol}
        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        className="bg-[#0e121a] text-[#c9d1d9] border border-[#2a3140] rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#4c8bf5]/40"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />

      <label className="text-sm ml-2">Resolution</label>
      <select
        value={resolution}
        onChange={(e) => setResolution(e.target.value as Resolution)}
        className="bg-[#0e121a] text-[#c9d1d9] border border-[#2a3140] rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#4c8bf5]/40"
      >
        {UI_RES_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <span className="ml-2 text-[#8b949e] text-sm">WS live, EMA(20) overlay</span>
    </div>
  );
}

const inputStyle: React.CSSProperties = { background:'#0e121a', color:'#c9d1d9', border:'1px solid #2a3140', borderRadius:8, padding:'6px 8px' };

export default App
