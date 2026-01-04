import { useMemo, useEffect, useState } from 'react';
import { useArpFeed, useBarFeed } from '@/hooks/useFeed';
import type { ExtendedCandle } from '@/lib/datafeed';
import type { Resolution } from '@/types/chart';
import type { Time } from 'lightweight-charts';

interface UseChartFeedOptions {
  router?: string;
  enabled?: boolean;
  onStale?: () => void;
}

interface UseChartFeedResult {
  update: ExtendedCandle | null;
  isArpData: boolean;
  isLoading: boolean;
  status: 'connecting' | 'active' | 'error' | 'inactive';
}

export function useChartFeed(
  symbol: string,
  resolution: Resolution,
  options: UseChartFeedOptions = {}
): UseChartFeedResult {
  const { router, enabled = true, onStale } = options;
  
  // Detect if this is an ARP subscription (USD quote)
  const isUsdPair = useMemo(() => 
    symbol.toUpperCase().endsWith('_USD'), 
    [symbol]
  );
  
  // Extract base asset for ARP
  const baseAsset = useMemo(() => 
    isUsdPair ? symbol.split('_')[0] : '', 
    [symbol, isUsdPair]
  );

  // ARP subscription (for USD pairs)
  const arpResult = useArpFeed(baseAsset, 'usd', { 
    enabled: enabled && isUsdPair,
    onStale
  });

  // OHLC subscription (for trading pairs)
  const barResult = useBarFeed(symbol, resolution, { 
    enabled: enabled && !isUsdPair,
    router,
    onStale
  });

  // Track last timestamp to detect updates
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);

  // Normalize ARP data to ExtendedCandle format
  const arpUpdate = useMemo((): ExtendedCandle | null => {
    if (arpResult.price !== null && arpResult.timestamp !== null) {
      // Convert timestamp to Time (seconds if > 1e10, otherwise already seconds)
      const time = (arpResult.timestamp > 1e10 
        ? Math.floor(arpResult.timestamp / 1000) 
        : arpResult.timestamp) as Time;
      
      return {
        time,
        open: arpResult.price,
        high: arpResult.price,
        low: arpResult.price,
        close: arpResult.price,
        volume: 0,
        confidence: arpResult.confidence ?? 1,
        hops: arpResult.hops ?? 0,
        isArpData: true,
      };
    }
    return null;
  }, [arpResult.price, arpResult.timestamp, arpResult.confidence, arpResult.hops]);

  // Track when updates change to trigger re-renders
  useEffect(() => {
    if (isUsdPair && arpResult.timestamp) {
      setLastUpdateTime(arpResult.timestamp);
    } else if (!isUsdPair && barResult.bar?.time) {
      setLastUpdateTime(Number(barResult.bar.time));
    }
  }, [isUsdPair, arpResult.timestamp, barResult.bar]);

  // Return the appropriate update based on symbol type
  const update = useMemo((): ExtendedCandle | null => {
    if (isUsdPair) {
      return arpUpdate;
    }
    return barResult.bar;
  }, [isUsdPair, arpUpdate, barResult.bar, lastUpdateTime]);

  return {
    update,
    isArpData: isUsdPair,
    isLoading: isUsdPair ? arpResult.isLoading : barResult.isLoading,
    status: isUsdPair ? arpResult.status : barResult.status,
  };
}