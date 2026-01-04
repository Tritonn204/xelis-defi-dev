import { useEffect, useState, useMemo, useCallback } from 'react';
import { buildSubscriptionKey } from '@/lib/datafeed';
import type { ExtendedCandle, ArpUpdate, SparklinePoint } from '@/lib/datafeed';
import type { Resolution } from '@/types/chart';
import { getSharedDataFeed } from '@/lib/datafeed-singleton';

// ─────────────────────────────────────────────────────────────
// useArpFeed - Subscribe to Asset Reference Price updates
// ─────────────────────────────────────────────────────────────

export interface UseArpFeedOptions {
 enabled?: boolean;
 onStale?: () => void;
}

export interface UseArpFeedResult {
 price: number | null;
 confidence: number | null;
 hops: number | null;
 timestamp: number | null;
 isLoading: boolean;
 error: Error | null;
 status: 'connecting' | 'active' | 'error' | 'inactive';
}

export function useArpFeed(
 asset: string,
 anchor: string = 'usd',
 options: UseArpFeedOptions = {}
): UseArpFeedResult {
 const { enabled = true, onStale } = options;
 
 const [state, setState] = useState<UseArpFeedResult>({
   price: null,
   confidence: null,
   hops: null,
   timestamp: null,
   isLoading: true,
   error: null,
   status: 'connecting',
 });

 const key = useMemo(
   () => buildSubscriptionKey('arp', `${asset}_${anchor}`),
   [asset, anchor]
 );

 useEffect(() => {
   if (!enabled || !asset) {
     setState(s => ({ ...s, isLoading: false, status: 'inactive' }));
     return;
   }

   const feed = getSharedDataFeed();
   
   // Check for existing data
   const existing = feed.getSnapshot(key);
   if (existing) {
     setState({
       price: existing.price,
       confidence: existing.confidence,
       hops: existing.hops,
       timestamp: existing.timestamp,
       isLoading: false,
       error: null,
       status: 'active',
     });
   }

   const unsubscribe = feed.subscribeArp(asset, anchor, (update: ArpUpdate) => {
     setState({
       price: update.price,
       confidence: update.confidence,
       hops: update.hops,
       timestamp: update.timestamp,
       isLoading: false,
       error: null,
       status: 'active',
     });
   });

   // Poll for status changes (until DataFeed supports error callbacks)
   const statusTimer = setInterval(() => {
     const status = feed.getStatus(key);
     setState(prev => {
       if (prev.status !== status) {
         return {
           ...prev,
           status,
           error: status === 'error' ? new Error('Subscription error') : null,
         };
       }
       return prev;
     });
   }, 1000);

   return () => {
     unsubscribe();
     clearInterval(statusTimer);
   };
 }, [key, asset, anchor, enabled]);

 // Handle dropped messages
 useEffect(() => {
   if (!enabled || !onStale) return;
   
   const handleDropped = () => {
     onStale();
   };
   
   window.addEventListener('datafeed:dropped_messages', handleDropped);
   return () => window.removeEventListener('datafeed:dropped_messages', handleDropped);
 }, [enabled, onStale]);

 return state;
}

// ─────────────────────────────────────────────────────────────
// useBarFeed - Subscribe to OHLCV bar updates
// ─────────────────────────────────────────────────────────────

interface UseBarFeedOptions {
 enabled?: boolean;
 router?: string;
 onStale?: () => void;
}

interface UseBarFeedResult {
 bar: ExtendedCandle | null;
 isLoading: boolean;
 error: Error | null;
 status: 'connecting' | 'active' | 'error' | 'inactive';
}

export function useBarFeed(
 symbol: string,
 resolution: Resolution = '1',
 options: UseBarFeedOptions = {}
): UseBarFeedResult {
 const { enabled = true, router, onStale } = options;
 
 const [state, setState] = useState<UseBarFeedResult>({
   bar: null,
   isLoading: true,
   error: null,
   status: 'connecting',
 });

 const key = useMemo(
   () => buildSubscriptionKey('bar', symbol, resolution, router),
   [symbol, resolution, router]
 );

 useEffect(() => {
   if (!enabled || !symbol) {
     setState(s => ({ ...s, isLoading: false, status: 'inactive' }));
     return;
   }

   const feed = getSharedDataFeed();
   
   // Check for existing data
   const existing = feed.getSnapshot(key);
   if (existing) {
     setState({
       bar: existing,
       isLoading: false,
       error: null,
       status: 'active',
     });
   }

   const unsubscribe = feed.subscribeBar(symbol, resolution, (bar: ExtendedCandle) => {
     setState({
       bar,
       isLoading: false,
       error: null,
       status: 'active',
     });
   }, router);

   // Poll for status changes
   const statusTimer = setInterval(() => {
     const status = feed.getStatus(key);
     setState(prev => {
       if (prev.status !== status) {
         return {
           ...prev,
           status,
           error: status === 'error' ? new Error('Subscription error') : null,
         };
       }
       return prev;
     });
   }, 1000);

   return () => {
     unsubscribe();
     clearInterval(statusTimer);
   };
 }, [key, symbol, resolution, router, enabled]);

 // Handle dropped messages
 useEffect(() => {
   if (!enabled || !onStale) return;
   
   const handleDropped = () => {
     onStale();
   };
   
   window.addEventListener('datafeed:dropped_messages', handleDropped);
   return () => window.removeEventListener('datafeed:dropped_messages', handleDropped);
 }, [enabled, onStale]);

 return state;
}

// ─────────────────────────────────────────────────────────────
// useSparklineFeed - Subscribe to lightweight price points
// ─────────────────────────────────────────────────────────────

interface UseSparklineFeedOptions {
 enabled?: boolean;
 maxPoints?: number;
 onStale?: () => void;
}

interface UseSparklineFeedResult {
 points: SparklinePoint[];
 latestPrice: number | null;
 isLoading: boolean;
 status: 'connecting' | 'active' | 'error' | 'inactive';
}

export function useSparklineFeed(
 symbol: string,
 resolution: Resolution = '1',
 options: UseSparklineFeedOptions = {}
): UseSparklineFeedResult {
 const { enabled = true, maxPoints = 50, onStale } = options;
 
 const [points, setPoints] = useState<SparklinePoint[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [status, setStatus] = useState<'connecting' | 'active' | 'error' | 'inactive'>('connecting');

 const key = useMemo(
   () => buildSubscriptionKey('sparkline', symbol, resolution),
   [symbol, resolution]
 );

 useEffect(() => {
   if (!enabled || !symbol) {
     setIsLoading(false);
     setStatus('inactive');
     return;
   }

   const feed = getSharedDataFeed();

   // Check for last known point (won't have full history, but better than nothing)
   const existing = feed.getSnapshot(key);
   if (existing) {
     setPoints([existing]);
     setIsLoading(false);
     setStatus('active');
   }

   const unsubscribe = feed.subscribeSparklineRefCounted(
     symbol, 
     resolution, 
     (point: SparklinePoint) => {
       setPoints(prev => {
         const updated = [...prev, point];
         // Keep only last N points
         return updated.length > maxPoints ? updated.slice(-maxPoints) : updated;
       });
       setIsLoading(false);
       setStatus('active');
     }
   );

   // Poll for status changes
   const statusTimer = setInterval(() => {
     const feedStatus = feed.getStatus(key);
     setStatus(feedStatus as any);
   }, 1000);

   return () => {
     unsubscribe();
     clearInterval(statusTimer);
   };
 }, [key, symbol, resolution, enabled, maxPoints]);

 // Handle dropped messages
 useEffect(() => {
   if (!enabled || !onStale) return;
   
   const handleDropped = () => {
     onStale();
   };
   
   window.addEventListener('datafeed:dropped_messages', handleDropped);
   return () => window.removeEventListener('datafeed:dropped_messages', handleDropped);
 }, [enabled, onStale]);

 const latestPrice = points.length > 0 ? points[points.length - 1].price : null;

 return { points, latestPrice, isLoading, status };
}

// ─────────────────────────────────────────────────────────────
// useMultiArpFeed - Subscribe to multiple ARP feeds at once
// ─────────────────────────────────────────────────────────────

type MultiArpResult = Record<string, UseArpFeedResult>;

interface UseMultiArpFeedOptions {
 onStale?: () => void;
}

export function useMultiArpFeed(
 assets: string[],
 anchor: string = 'usd',
 options: UseMultiArpFeedOptions = {}
): MultiArpResult {
 const { onStale } = options;
 const [results, setResults] = useState<MultiArpResult>({});

 // Stable key for the asset list (fixed mutation bug)
 const assetsKey = useMemo(() => [...assets].sort().join(','), [assets]);

 useEffect(() => {
   if (assets.length === 0) {
     setResults({}); // Clear when empty
     return;
   }

   const feed = getSharedDataFeed();
   const unsubscribes: (() => void)[] = [];
   const statusTimers: number[] = [];

   // Clean up removed assets, initialize new ones
   setResults(prev => {
     const next: MultiArpResult = {};
     for (const asset of assets) {
       next[asset] = prev[asset] ?? {
         price: null,
         confidence: null,
         hops: null,
         timestamp: null,
         isLoading: true,
         error: null,
         status: 'connecting',
       };
     }
     return next;
   });

   // Subscribe to each asset
   for (const asset of assets) {
     const key = buildSubscriptionKey('arp', `${asset}_${anchor}`);
     
     // Check for existing data
     const existing = feed.getSnapshot(key);
     if (existing) {
       setResults(prev => ({
         ...prev,
         [asset]: {
           price: existing.price,
           confidence: existing.confidence,
           hops: existing.hops,
           timestamp: existing.timestamp,
           isLoading: false,
           error: null,
           status: 'active',
         },
       }));
     }

     const unsub = feed.subscribeArp(asset, anchor, (update: ArpUpdate) => {
       setResults(prev => ({
         ...prev,
         [asset]: {
           price: update.price,
           confidence: update.confidence,
           hops: update.hops,
           timestamp: update.timestamp,
           isLoading: false,
           error: null,
           status: 'active',
         },
       }));
     });
     unsubscribes.push(unsub);

     // Poll for status changes for this asset
     const timer = window.setInterval(() => {
       const status = feed.getStatus(key);
       setResults(prev => {
         if (prev[asset] && prev[asset].status !== status) {
           return {
             ...prev,
             [asset]: {
               ...prev[asset],
               status: status as any,
               error: status === 'error' ? new Error('Subscription error') : null,
             },
           };
         }
         return prev;
       });
     }, 1000);
     statusTimers.push(timer);
   }

   return () => {
     unsubscribes.forEach(unsub => unsub());
     statusTimers.forEach(timer => clearInterval(timer));
   };
 }, [assetsKey, anchor]);

 // Handle dropped messages
 useEffect(() => {
   if (!onStale) return;
   
   const handleDropped = () => {
     onStale();
   };
   
   window.addEventListener('datafeed:dropped_messages', handleDropped);
   return () => window.removeEventListener('datafeed:dropped_messages', handleDropped);
 }, [onStale]);

 return results;
}

// ─────────────────────────────────────────────────────────────
// useLivePrice - Simple price-only hook for display components
// ─────────────────────────────────────────────────────────────

interface UseLivePriceOptions {
 enabled?: boolean;
 fallbackToBar?: boolean; // If ARP fails, try bar data
}

export function useLivePrice(
 symbol: string,
 options: UseLivePriceOptions = {}
): number | null {
 const { enabled = true, fallbackToBar = false } = options;
 
 // Try ARP first if it looks like a USD pair
 const isUsdPair = symbol.toUpperCase().endsWith('_USD');
 const [base] = symbol.split('_');
 
 const arpResult = useArpFeed(
   isUsdPair ? base : '',
   'usd',
   { enabled: enabled && isUsdPair }
 );
 
 const barResult = useBarFeed(
   symbol,
   '1',
   { 
     enabled: enabled && (!isUsdPair || (fallbackToBar && !arpResult.price))
   }
 );
 
 if (isUsdPair && arpResult.price !== null) {
   return arpResult.price;
 }
 
 return barResult.bar?.close ?? null;
}

// ─────────────────────────────────────────────────────────────
// useDataFeedStatus - Monitor overall DataFeed health
// ─────────────────────────────────────────────────────────────

interface DataFeedStatus {
 isConnected: boolean;
 hasDroppedMessages: boolean;
 activeSubscriptions: number;
}

export function useDataFeedStatus(): DataFeedStatus {
 const [droppedCount, setDroppedCount] = useState(0);
 
 useEffect(() => {
   const handleDropped = () => {
     setDroppedCount(prev => prev + 1);
   };
   
   window.addEventListener('datafeed:dropped_messages', handleDropped);
   return () => window.removeEventListener('datafeed:dropped_messages', handleDropped);
 }, []);
 
 // Note: Would need DataFeed to expose connection state and subscription count
 // For now, just track dropped messages
 return {
   isConnected: true, // Would need DataFeed.isConnected()
   hasDroppedMessages: droppedCount > 0,
   activeSubscriptions: 0, // Would need DataFeed.getSubscriptionCount()
 };
}