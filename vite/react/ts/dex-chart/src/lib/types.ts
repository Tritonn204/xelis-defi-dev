import type { Time } from "lightweight-charts";

export type Resolution = '1'|'5'|'15'|'60'|'240'|'1D'|'1W'|'1M';

export type Candle = {
  time: Time;   // seconds
  open: number;
  high: number;
  low:  number;
  close:number;
  volume?: number;
};

export const RES_TO_MIN: Record<Resolution, number> = {
  '1':1, '5':5, '15':15, '60':60, '240':240, '1D':1440, '1W':10080, '1M':43200,
};

export interface VolPoint { time: Time; value: number; color: string };