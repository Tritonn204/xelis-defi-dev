import React from 'react';
import { useChart } from '../contexts/ChartContext';
import Button from './Button';
import { useClickOutside } from '../hooks/useClickOutside';

type Props = {
  className?: string;
};

export const ChartControls: React.FC<Props> = ({ className }) => {
  const {
    indicators,
    addEma,
    updateEma,
    removeEma,
    toggleEma,
    toggleRsi,
    setIndicators,
    resetIndicators,
    candleMode, 
    setCandleMode,
  } = useChart();

  const [open, setOpen] = React.useState(false);
  const [candleOpen, setCandleOpen] = React.useState(false);

  const indRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const candleRef = useClickOutside<HTMLDivElement>(candleOpen, () => setCandleOpen(false));
  // local helpers
  const onAddQuick = (p: number) => addEma({ period: p, color: pickColorFor(p), enabled: true });
  const onToggleVolume = () =>
    setIndicators(s => ({ ...s, showVolume: !s.showVolume }));


return (
  <div className={className}>
    {/* Toolbar row */}
    <div className="flex items-center gap-1">
      {/* Indicators trigger + floating panel */}
      <div ref={indRef} className="relative">
        <Button
          onClick={() => setOpen(o => !o)}
          className="
            transition-all duration-175
            rounded-md bg-black/40 hover:bg-black/60 border border-white/10 px-2 py-1 text-xs text-neutral-200
          "
          title="Indicators"
          focusOnClick={false}
        >
          Indicators
        </Button>

        {open && (
          <div
            className="absolute left-0 top-full mt-1 w-72 rounded-lg bg-[#0e121a]/95 border border-white/10 p-3 shadow-xl z-50"
            role="dialog"
            aria-modal="false"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-neutral-200">Overlays</div>
              <Button
                className="text-xs text-neutral-400 hover:text-neutral-200"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </Button>
            </div>

            {/* Quick add */}
            <div className="mb-3">
              <div className="text-xs text-neutral-400 mb-1">Quick add</div>
              <div className="flex gap-2">
                {[9, 20, 50].map(p => (
                  <Button
                    key={p}
                    onClick={() => onAddQuick(p)}
                    className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-neutral-200 border border-white/10"
                  >
                    EMA {p}
                  </Button>
                ))}
              </div>
            </div>

            {/* EMA list */}
            <div className="text-xs text-neutral-400 mt-1 mb-1">EMAs</div>
            <div className="space-y-2 max-h-56 overflow-auto pr-1">
              {indicators.ema.map(e => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 rounded backdrop-blur-sm bg-white/5 border border-white/10 px-2 py-1"
                >
                  <input
                    type="checkbox"
                    checked={e.enabled}
                    onChange={() => toggleEma(e.id)}
                    title="Enable"
                  />
                  <span className="text-xs text-neutral-300 w-10">EMA</span>

                  <input
                    type="number"
                    className="w-16 bg-[#0e121a] text-neutral-200 border border-white/10 rounded px-2 py-1 text-xs"
                    min={1}
                    value={e.period}
                    onChange={(ev) => {
                      const v = Math.max(1, Math.floor(Number(ev.target.value) || 1));
                      updateEma(e.id, { period: v });
                    }}
                    title="Period"
                  />

                  <input
                    type="color"
                    className="h-6 w-6 rounded border border-white/10 bg-[#0e121a] p-0"
                    value={safeColor(e.color)}
                    onChange={(ev) => updateEma(e.id, { color: ev.target.value })}
                    title="Color"
                  />

                  <Button
                    onClick={() => removeEma(e.id)}
                    className="ml-auto text-xs text-neutral-400 hover:text-red-300"
                    title="Remove"
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {indicators.ema.length === 0 && (
                <div className="text-xs text-neutral-400">No EMA overlays yet.</div>
              )}
            </div>

            {/* RSI & Volume */}
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  id="rsi-toggle"
                  type="checkbox"
                  checked={indicators.rsi.enabled}
                  onChange={() => toggleRsi()}
                />
                <label htmlFor="rsi-toggle" className="text-xs text-neutral-300">RSI</label>

                <input
                  type="number"
                  className="ml-2 w-20 bg-[#0e121a] text-neutral-200 border border-white/10 rounded px-2 py-1 text-xs disabled:opacity-50"
                  min={2}
                  value={indicators.rsi.period}
                  onChange={(ev) => {
                    const p = Math.max(2, Math.floor(Number(ev.target.value) || 9));
                    setIndicators(s => ({ ...s, rsi: { ...s.rsi, period: p } }));
                  }}
                  disabled={!indicators.rsi.enabled}
                  title="RSI period"
                />
                <span className="ml-auto text-[10px] text-neutral-500">subpane</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="vol-toggle"
                  type="checkbox"
                  checked={indicators.showVolume}
                  onChange={onToggleVolume}
                />
                <label htmlFor="vol-toggle" className="text-xs text-neutral-300">Volume</label>
                <span className="ml-auto text-[10px] text-neutral-500">subpane</span>
              </div>
            </div>

            <div className="mt-3 flex justify-between">
              <Button
                onClick={resetIndicators}
                className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10"
                title="Reset all indicator settings"
              >
                Reset
              </Button>
              <Button
                onClick={() => setOpen(false)}
                className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-neutral-200 border border-white/10"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Candle trigger + floating menu */}
      <div ref={candleRef} className="relative mr-1">
        <Button
          onClick={() => setCandleOpen(v => !v)}
          className="rounded-md bg-black/40 hover:bg-black/60 border border-white/10 px-1 py-1 text-xs
                     text-neutral-500 hover:text-neutral-200 transition-colors flex items-center gap-1"
          title="Candle type"
          focusOnClick={false}
        >
          {/* two tiny candle icons */}
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <g fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {/* Left candle */}
              <line x1="8" y1="3" x2="8" y2="8" />
              <rect x="6" y="8" width="4" height="8" rx="0.75" />
              <line x1="8" y1="16" x2="8" y2="21" />
              {/* Right candle */}
              <line x1="16" y1="3" x2="16" y2="7" />
              <rect x="14" y="6" width="4" height="12" rx="0.75" />
              <line x1="16" y1="18" x2="16" y2="21" />
            </g>
          </svg>
        </Button>

        {candleOpen && (
          <div
            role="menu"
            className="absolute left-0 top-full mt-1 w-44 rounded-md border border-white/10 bg-[#0e121a]/95 shadow-lg p-1 text-sm z-50"
          >
            {[
              { key: 'standard' as const, label: 'Standard (OHLC)' },
              { key: 'heikin'   as const, label: 'Heikin Ashi'    },
            ].map(item => {
              const selected = candleMode === item.key;
              return (
                <Button
                  key={item.key}
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => { setCandleMode(item.key); setCandleOpen(false); }}
                  className={`
                    w-full flex items-center text-left gap-2 px-2 py-1 rounded hover:bg-white/5 ${selected ? 'text-white' : 'text-gray-300'}
                    transition-all duration-200
                  `}
                >
                  <span className="absolute inline-block w-4 left-2 text-[12px]">
                    {selected ? '✓' : '\u00A0'}
                  </span>
                  <span>{item.label}</span>
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {/* status chips */}
      <div className="flex flex-wrap items-center gap-1">
        {indicators.ema
          .filter(e => e.enabled)
          .map(e => (
            <span
              key={e.id}
              className="px-2 py-[3px] text-[10px] backdrop-blur-sm rounded border border-white/10"
              style={{ color: e.color, background: 'rgba(255,255,255,0.04)' }}
              title={`EMA ${e.period}`}
            >
              EMA {e.period}
            </span>
          ))}
        {indicators.rsi.enabled && (
          <span
            className="px-2 py-[3px] text-[10px] backdrop-blur-sm rounded border border-white/10 text-purple-300 bg-white/5"
            title={`RSI ${indicators.rsi.period}`}
          >
            RSI {indicators.rsi.period}
          </span>
        )}
        {indicators.showVolume && (
          <span
            className="px-2 py-[3px] text-[10px] backdrop-blur-sm rounded border border-white/10 text-emerald-300 bg-white/5"
            title="Volume"
          >
            VOL
          </span>
        )}
      </div>
    </div>
  </div>
);
};

function pickColorFor(period: number) {
  if (period <= 10) return '#0b66a3';
  if (period <= 21) return '#0baff5';
  if (period <= 55) return '#f7a82a';
  return '#d3349bff';
}

function safeColor(c: string) {
  // ensure a 7-char hex; fallback if something odd sneaks in
  return /^#([0-9a-f]{6})$/i.test(c) ? c : '#22d3ee';
}

export default ChartControls;
