import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import { TokenIcon } from '../ui/TokenIcon';
import { formatCompactNumber } from '@/utils/number';
import { PoolData, usePools } from '@/contexts/PoolContext';
import { useWallet } from '@/contexts/WalletContext';
import { useMultiArpFeed } from '@/hooks/useFeed';
import { NATIVE_ASSET_HASH } from '@/contexts/NodeContext';
import Button from '../ui/Button';
import Tooltip from '../ui/Tooltip';
import { useViewState } from '@/contexts/ViewStateContext';
import DisclaimerModal, { disclaimerKeys } from '@/components/modal/DisclaimerModal';
import { useAssets } from '@/contexts/AssetContext';

const API_HTTP = import.meta.env.VITE_API_HTTP ?? window.location.origin;

interface PoolListProps {
  pools?: Map<string, PoolData>;
  onPoolClick?: (poolKey: string, pool: PoolData) => void;
  filterMode?: 'all' | 'only-xel' | 'user' | 'lt-1k';
  tvlRange?: { min?: number; max?: number };
  scrollClass?: string;
}

export const PoolList = ({
  pools = new Map<string, PoolData>(),
  onPoolClick,
  filterMode,
  tvlRange,
  scrollClass = 'h-[55vh]'
}: PoolListProps) => {
  const { isConnected, address, trackAsset, ownedAssets } = useWallet();
  const { refreshPools } = usePools();
  const { refreshAssets, assets } = useAssets();
  const poolEntries = Array.from(pools.entries());

  const { getState, setState } = useViewState();
  const sortKey = 'poolList';
  const state = getState(sortKey);

  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set());
  const [showDisclaimerFor, setShowDisclaimerFor] = useState<string | null>(null);
  const [marketDataMap, setMarketDataMap] = useState<Map<string, { volume: number; priceChange: number }>>(new Map());

  // Initialize state defaults
  const searchTerm = state.searchTerm ?? '';
  const showNonXel = state.showNonXel ?? false;
  const sortBy = state.sortBy ?? 'TVL';
  const sortAsc = state.sortAsc ?? false;

  const formatPoolAmount = (amountStr: string): string => {
    const amount = parseFloat(amountStr);
    
    if (amount === 0) return '0';
    
    // For very small numbers, use scientific notation
    if (amount < 0.000001) {
      return amount.toExponential(2);
    }
    
    if (amount < 0.01) {
      // Show up to 8 decimal places, removing trailing zeros
      return amount.toFixed(8).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
    }
    
    if (amount < 1) {
      return amount.toFixed(4).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
    }
    
    if (amount < 1000) {
      return amount.toFixed(2).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
    }
    
    // For large numbers, use compact notation
    return formatCompactNumber(amount);
  };
  
  const formatPoolValue = (value: number): string => {
    if (value === 0) return '$0';
    
    // For very small USD values
    if (value < 0.01) {
      if (value < 0.000001) {
        return '$' + value.toExponential(2);
      }
      return '$' + value.toFixed(6).replace(/\.?0+$/, '');
    }
    
    if (value < 1) {
      return '$' + value.toFixed(4).replace(/\.?0+$/, '');
    }
    
    if (value < 1000) {
      return '$' + value.toFixed(2);
    }
    
    // For large values, use compact notation
    return '$' + formatCompactNumber(value);
  };

  // Collect all unique asset hashes from pools
  const allAssetHashes = useMemo(() => {
    const hashes = new Set<string>();
    poolEntries.forEach(([_, pool]) => {
      pool.hashes.forEach(hash => hashes.add(hash));
    });
    return Array.from(hashes);
  }, [poolEntries]);

  // Subscribe to all asset prices at once
  const priceData = useMultiArpFeed(allAssetHashes, 'usd');

  // Fetch market data (volume and price change) for all pools
  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        const resp = await fetch(`${API_HTTP}/api/markets/overview`);
        if (resp.ok) {
          const data = await resp.json();
          const newMarketDataMap = new Map<string, { volume: number; priceChange: number }>();

          data.forEach((item: any) => {
            const key1 = `${item.a_hash}_${item.b_hash}`;
            const key2 = `${item.b_hash}_${item.a_hash}`;
            const marketData = {
              volume: item.volume_24h || 0,
              priceChange: item.price_change_24h_pct || 0,
            };
            newMarketDataMap.set(key1, marketData);
            newMarketDataMap.set(key2, marketData);
          });

          setMarketDataMap(newMarketDataMap);
        }
      } catch (err) {
        console.error('[PoolList] Failed to fetch market data:', err);
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Calculate TVL for each pool using live prices
  const poolTVLs = useMemo(() => {
    const tvlMap = new Map<string, number>();

    poolEntries.forEach(([key, pool]) => {
      let totalTVL = 0;

      // Sum up the USD value of each asset in the pool
      pool.hashes.forEach((hash, index) => {
        const amount = parseFloat(pool.locked[index]); // Now has full precision
        const assetPrice = priceData[hash];

        if (assetPrice?.price && amount) {
          const value = amount * assetPrice.price;
          totalTVL += value;
        }
      });

      tvlMap.set(key, totalTVL);
    });

    return tvlMap;
  }, [poolEntries, priceData]);

  const togglePool = (key: string) => {
    setExpandedPools(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleTrackNow = async (key: string, pool: PoolData) => {
    await trackAsset({ asset: pool.lpAsset });
  };

  const handleSearchChange = (val: string) => {
    setState(sortKey, { searchTerm: val });
  };

  const handleShowNonXelChange = (val: boolean) => {
    setState(sortKey, { showNonXel: val });
  };

  const handleSortByChange = (val: 'TVL' | 'Share' | 'Change' | 'Volume') => {
    setState(sortKey, { sortBy: val });
  };

  const handleSortAscChange = (val: boolean) => {
    setState(sortKey, { sortAsc: val });
  };

  const matchesFilterMode = (key: string, pool: PoolData): boolean => {
    switch (filterMode) {
      case 'only-xel':
        return pool.hashes.includes(NATIVE_ASSET_HASH);
      case 'user':
        return pool.userPool && ((!!pool.userShare && parseFloat(pool.userShare) > 0) || !pool.userTracked);
      default:
        break;
    }
    const tvl = poolTVLs.get(key) ?? 0;
    if (tvlRange) {
      if (typeof tvlRange.min === 'number' && tvl < tvlRange.min!) return false;
      if (typeof tvlRange.max === 'number' && tvl > tvlRange.max!) return false;
    }
    return true;
  };

  const filteredAndSortedPools = useMemo(() => {
    return poolEntries
      .filter(([key, pool]) => matchesFilterMode(key, pool))
      .filter(([_, pool]) => {
        const q = searchTerm.toLowerCase();
        return (
          pool.name.toLowerCase().includes(q) ||
          pool.names.some(name => name.toLowerCase().includes(q)) ||
          pool.hashes.some(hash => hash.toLowerCase().includes(q))
        );
      })
      .filter(([_, pool]) => {
        return showNonXel || pool.hashes.includes(NATIVE_ASSET_HASH);
      })
      .sort((a, b) => {
        let aVal = 0;
        let bVal = 0;

        if (sortBy === 'TVL') {
          aVal = poolTVLs.get(a[0]) ?? 0;
          bVal = poolTVLs.get(b[0]) ?? 0;
        } else if (sortBy === 'Share') {
          aVal = parseFloat(a[1].userShare ?? '0');
          bVal = parseFloat(b[1].userShare ?? '0');
        } else if (sortBy === 'Change') {
          aVal = marketDataMap.get(a[0])?.priceChange ?? 0;
          bVal = marketDataMap.get(b[0])?.priceChange ?? 0;
        } else if (sortBy === 'Volume') {
          aVal = marketDataMap.get(a[0])?.volume ?? 0;
          bVal = marketDataMap.get(b[0])?.volume ?? 0;
        }

        return sortAsc ? aVal - bVal : bVal - aVal;
      });
  }, [poolEntries, poolTVLs, searchTerm, showNonXel, sortBy, sortAsc, filterMode, tvlRange, marketDataMap]);

  // Check if a pool has incomplete price data
  const hasIncompletePriceData = (pool: PoolData): boolean => {
    return pool.hashes.some(hash => {
      const price = priceData[hash];
      return !price || price.price === null || price.price === 0;
    });
  };

  if (poolEntries.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400">
        No active pools found
      </div>
    );
  }

  return (
    <div className="space-y-1 w-full max-w-5xl mx-auto">
      {/* Search Bar */}
      <div className="bg-black/60 rounded-xl p-3 border border-forge-orange/30">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search LP/Token Name or Asset ID"
          className="w-full bg-black/80 text-white p-2 rounded-lg border border-forge-orange/30 focus:outline-none focus:border-forge-orange"
        />
      </div>

      {/* Filter & Sort Controls */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 bg-black/60 rounded-xl p-1 border border-forge-orange/30">
        {/* Checkbox */}
        <label className="flex items-center space-x-2 ml-2 mb-1.5 text-white">
          <input
            type="checkbox"
            checked={showNonXel}
            onChange={() => handleShowNonXelChange(!showNonXel)}
            className="form-checkbox rounded text-forge-orange border-white/20"
          />
          <span className="text-left text-forge-orange text-sm">Show Non-XEL Pairs</span>
        </label>

        {/* Sort Options */}
        <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
          <div className="flex items-center space-x-2">
            <label className="text-white text-sm">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => handleSortByChange(e.target.value as 'TVL' | 'Share' | 'Change' | 'Volume')}
              className="bg-black/80 text-white p-1 rounded-lg border border-forge-orange/30 focus:outline-none"
            >
              <option value="TVL">TVL</option>
              <option value="Volume">Vol</option>
              <option value="Share">My Share</option>
              <option value="Change">% 24h</option>
            </select>
          </div>

          <Tooltip content={`Click to Sort in ${!sortAsc ? 'Ascending' : 'Descending'} Order`}>
            <Button
              onClick={() => handleSortAscChange(!sortAsc)}
              focusOnClick={false}
              className="bg-black/70 border border-forge-orange/30 rounded-lg p-2 hover:bg-white/10 transition"
            >
              {sortAsc
                ? <ArrowDown className="w-4 h-4 text-white transition-transform duration-200" />
                : <ArrowUp className="w-4 h-4 text-white transition-transform duration-200" />}
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Scrollable Pool List */}
      <div className={`relative ${scrollClass}`}>
        <div className="overflow-y-auto h-full space-y-1 mask-fade-out pb-2">
          {filteredAndSortedPools.length === 0 ? (
            <div className="text-center py-6 text-gray-400">
              No matching pools found
            </div>
          ) : (
            filteredAndSortedPools.map(([key, pool]) => {
              const isExpanded = expandedPools.has(key);
              const TVL = poolTVLs.get(key) ?? 0;
              const incompletePricing = hasIncompletePriceData(pool);

              const isUntrackedUserPool = pool.userPool && !pool.userTracked;

              // Get market data for this pool
              const marketData = marketDataMap.get(key);
              const volume = marketData?.volume || 0;
              const priceChange = marketData?.priceChange || 0;
              const isPositive = priceChange >= 0;

              return (
                <div
                  key={key}
                  onClick={() => {
                    if (onPoolClick) {
                      onPoolClick(key, pool);
                    } else {
                      togglePool(key);
                    }
                  }}
                  className="bg-black/70 relative rounded-xl px-2 py-2 border border-forge-orange/30 hover:border-white/30 transition-all cursor-pointer overflow-visible"
                >
                  <div className="relative min-h-14 flex items-center select-none">
                    <div className="ml-2 z-10 text-left">
                      <div className="text-white text-[13pt] font-normal flex items-center space-x-1">
                        <span>{pool.name}</span>
                        {incompletePricing && (
                          <Tooltip position='top' content="Incomplete price data — TVL may be underestimated">
                            <AlertTriangle className="w-4 h-4 text-yellow-400 ml-1" />
                          </Tooltip>
                        )}
                      </div>
                      <div className="text-forge-orange/80 text-sm -mt-0.5">
                        TVL: <span className="text-forge-orange font-bold">${formatCompactNumber(TVL)}</span>
                      </div>
                    </div>

                    <div className="absolute left-1/2 -translate-x-1/2 z-0">
                      <div className="relative w-fit h-fit">
                        <div className="-ml-4">
                          <TokenIcon tokenSymbol={pool.tickers[0]} tokenHash={pool.hashes[0]} tokenName={pool.names[0]} size={39} />
                        </div>
                        <div className="-mt-2.5 -mr-4">
                          <TokenIcon tokenSymbol={pool.tickers[1]} tokenHash={pool.hashes[1]} tokenName={pool.names[1]} size={39} />
                        </div>
                      </div>
                    </div>

                    <div className="ml-auto mr-1.5 text-right">
                      {isUntrackedUserPool ? (
                        <Tooltip
                          position='left' delay={1000} content="An untracked LP balance was detected"
                        >
                          <Button
                            onClick={(e: any) => {
                              e.stopPropagation(); // prevent card toggle
                              setShowDisclaimerFor(key);
                            }}
                            className="bg-transparent transition-all duration-200 hover:bg-black/50 text-forge-orange text-regular px-2 py-1 rounded-lg"
                          >
                            Track LP Balance
                          </Button>
                        </Tooltip>
                      ) : (
                        <>
                          <div className="text-forge-orange/80 text-md">
                            LP Share:{' '}
                            <span className={`${isConnected ? 'text-forge-orange' : 'text-white/20'} font-bold text-md`}>
                              {pool.userShare ?? '--'}%
                            </span>
                          </div>
                          <div className="flex items-center justify-end gap-3 text-sm -mt-0.5">
                            <span className={`font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                              {isPositive ? '+' : ''}
                              {priceChange.toFixed(2)}%
                            </span>
                            <span className="text-white">
                              V: ${volume >= 1_000_000
                                ? `${(volume / 1_000_000).toFixed(1)}M`
                                : volume >= 1_000
                                ? `${(volume / 1_000).toFixed(1)}K`
                                : volume.toFixed(0)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? 'max-h-40 mt-3 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="bg-black/50 rounded-md p-2 text-sm text-gray-300 space-y-1">
                      {pool.locked.map((amount, index) => {
                        const price = priceData[pool.hashes[index]];
                        const value = price?.price ? amount * price.price : null;
                        
                        return (
                          <div key={index} className="flex justify-between items-center">
                            <span>
                              {pool.tickers[index]} – {formatPoolAmount(amount)}
                            </span>
                            {value !== null && (
                              <span className="text-forge-orange/60 text-xs">
                                ≈ {formatPoolValue(value)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      {showDisclaimerFor && pools.has(showDisclaimerFor) && (
        <DisclaimerModal
          isOpen={!!showDisclaimerFor}
          onClose={() => setShowDisclaimerFor(null)}
          onConfirm={() => {
            const pool = pools.get(showDisclaimerFor)!;
            handleTrackNow(showDisclaimerFor, pool);
            setShowDisclaimerFor(null);
          }}
          storageKey={address ? `${address}_${disclaimerKeys.trackAsset}` : undefined}
          title="Track LP Balance"
          message="Tracking this pool will allow it to appear in your user-specific views. You can remove tracking later. Proceed?"
        />
      )}
    </div>
  );
};

export default PoolList;