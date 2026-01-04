import type { Candle, Resolution } from '../lib/types';
import type { IndicatorInstance } from './base';

export function createEMA(period = 20, color = '#4c8bf5'): IndicatorInstance {
  const alpha = 2 / (period + 1);
  const self: IndicatorInstance = {
    id: `ema${period}`,
    name: `EMA(${period})`,
    overlay: true,
    color,
    data: [],
    onHistory(bars: Candle[], _res: Resolution) {
      self.data = [];
      let ema: number | undefined;
      for (const b of bars) {
        ema = ema == null ? b.close : (b.close - ema) * alpha + ema;
        self.data.push({ time: b.time, value: ema });
      }
    },
    onBar(bar: Candle, _res: Resolution) {
      if (!self.data.length) {
        self.data.push({ time: bar.time, value: bar.close });
        return;
      }
      const prev = self.data[self.data.length - 1];
      const ema = (bar.close - prev.value) * alpha + prev.value;
      if (prev.time === bar.time) self.data[self.data.length - 1] = { time: bar.time, value: ema };
      else self.data.push({ time: bar.time, value: ema });
    },
  };
  return self;
}