import type { Candle, Resolution } from '../lib/types';

export type IndicatorInstance = {
  id: string;
  name: string;
  overlay: boolean; // true => plot on price chart; false => own pane (not implemented in demo)
  color?: string;
  data: { time: number; value: number }[];
  onHistory: (bars: Candle[], res: Resolution) => void;
  onBar:     (bar: Candle, res: Resolution) => void;
};