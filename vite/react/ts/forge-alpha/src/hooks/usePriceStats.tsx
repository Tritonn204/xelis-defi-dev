import { useEffect, useState, useMemo } from 'react';
import { useMultiArpFeed } from '@/hooks/useFeed';
import { getSharedDataFeed } from '@/lib/datafeed-singleton';
import { createUsdSymbol } from '@/utils/symbolMapping';

interface PriceStats {
  currentPrice: number | null;
  priceChange24h: number | null;
  isLoading: boolean;
}

interface UsePriceStatsResult {
  [assetHash: string]: PriceStats;
}

export function usePriceStats(assetHashes: string[]): UsePriceStatsResult {
  const [stats, setStats] = useState<UsePriceStatsResult>({});
  
  // Get current prices via batch ARP subscription
  const arpResults = useMultiArpFeed(assetHashes, 'usd');
  
  // Fetch 24h historical prices for comparison
  useEffect(() => {
    const fetchHistoricalPrices = async () => {
      const feed = getSharedDataFeed();
      const now = Date.now();
      const dayAgo = now - (24 * 60 * 60 * 1000);
      
      const updates: UsePriceStatsResult = {};
      
      for (const hash of assetHashes) {
        try {
          const symbol = createUsdSymbol(hash);
          const history = await feed.history(
            symbol,
            '5', // 5 minute resolution for 24h window
            Math.floor(dayAgo / 1000),
            Math.floor(now / 1000),
            false // Don't need live data for historical
          );
          
          if (history.length > 0) {
            const firstPrice = history[0].close;
            const currentArp = arpResults[hash];
            
            if (currentArp?.price && firstPrice > 0) {
              const change = ((currentArp.price - firstPrice) / firstPrice) * 100;
              
              updates[hash] = {
                currentPrice: currentArp.price,
                priceChange24h: change,
                isLoading: false
              };
            }
          }
        } catch (err) {
          console.warn(`Failed to fetch history for ${hash}:`, err);
        }
      }
      
      setStats(prev => ({ ...prev, ...updates }));
    };
    
    if (assetHashes.length > 0) {
      fetchHistoricalPrices();
    }
  }, [assetHashes, arpResults]);
  
  // Merge current prices with stats
  return useMemo(() => {
    const merged: UsePriceStatsResult = {};
    
    for (const hash of assetHashes) {
      const arp = arpResults[hash];
      const stat = stats[hash];
      
      merged[hash] = {
        currentPrice: arp?.price ?? stat?.currentPrice ?? null,
        priceChange24h: stat?.priceChange24h ?? null,
        isLoading: arp?.isLoading ?? true
      };
    }
    
    return merged;
  }, [assetHashes, arpResults, stats]);
}