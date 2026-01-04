import type { PriceHub } from './priceHub';
import type { DiskCandleStore } from '../candles/diskStore';

export function wireHubToCandles(hub: PriceHub, store: DiskCandleStore, filter?: (symbol: string)=>boolean) {
  const ok = (s: string) => filter ? filter(s) : true;
  const onQuote = async ({ symbol, price, ts }: { symbol: string; price: number; ts: number }) => {
    if (!ok(symbol)) return;
    await store.ingestTick({ symbol }, price, ts, 0);
  };
  hub.on('quote', onQuote);
  return () => hub.off('quote', onQuote); // unsubscribe
}