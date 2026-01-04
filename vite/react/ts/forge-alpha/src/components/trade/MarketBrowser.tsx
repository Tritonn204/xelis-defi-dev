import React, { useState, useMemo, useEffect } from 'react'
import { useMarketData } from '@/hooks/useMarketData'
import { usePools } from '@/contexts/PoolContext'
import { NATIVE_ASSET_HASH } from '@/contexts/NodeContext'
import TokenIcon from '@/components/ui/TokenIcon'
import { useClickOutside } from '@/hooks/useClickOutside'
import { ArrowUp, ArrowDown } from 'lucide-react'
import Button from '@/components/ui/Button'
import type { TickerSection } from '@/hooks/useMarketData'
import { createUsdSymbol } from '@/utils/symbolMapping'
import { useMultiArpFeed } from '@/hooks/useFeed'
import { formatCompactNumber } from '@/utils/number'

const API_HTTP = import.meta.env.VITE_API_HTTP ?? window.location.origin

interface MarketBrowserProps {
  onSelectPair?: (aHash: string, bHash: string) => void
  onSelectAsset?: (hash: string) => void
}

type CategoryType = 'all-markets' | 'all-assets' | 'trending' | 'new' | 'gainers' | 'losers'
type SortBy = 'tvl' | 'volume' | 'change'

const CATEGORY_LABELS: Record<CategoryType, string> = {
  'all-markets': 'All Markets',
  'all-assets': 'All Assets',
  trending: 'Trending',
  new: 'New Pairs',
  gainers: 'Gainers',
  losers: 'Losers',
}

const LS_KEY_CATEGORY = 'marketBrowser.category'
const LS_KEY_SORT_BY = 'marketBrowser.sortBy'
const LS_KEY_SORT_ASC = 'marketBrowser.sortAsc'

export const MarketBrowser: React.FC<MarketBrowserProps> = ({
  onSelectPair,
  onSelectAsset,
}) => {
  const { sections, isLoading, error } = useMarketData()
  const { poolAssets: poolAssetsMeta, activePools } = usePools()

  // Load from localStorage on mount
  const [activeCategory, setActiveCategory] = useState<CategoryType>(() => {
    if (typeof window === 'undefined') return 'trending'
    try {
      const stored = window.localStorage.getItem(LS_KEY_CATEGORY)
      return (stored as CategoryType) || 'trending'
    } catch {
      return 'trending'
    }
  })

  const [searchTerm, setSearchTerm] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const [sortBy, setSortBy] = useState<SortBy>(() => {
    if (typeof window === 'undefined') return 'volume'
    try {
      const stored = window.localStorage.getItem(LS_KEY_SORT_BY)
      return (stored as SortBy) || 'volume'
    } catch {
      return 'volume'
    }
  })

  const [sortAsc, setSortAsc] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      const stored = window.localStorage.getItem(LS_KEY_SORT_ASC)
      return stored === '1'
    } catch {
      return false
    }
  })
  const [marketDataMap, setMarketDataMap] = useState<Map<string, { volume: number; priceChange: number }>>(new Map())
  const [assetDataMap, setAssetDataMap] = useState<
    Map<string, { volume: number; priceChange: number; currentPrice?: number; confidence?: number }>
  >(new Map())

  const dropdownRef = useClickOutside<HTMLDivElement>(dropdownOpen, () => setDropdownOpen(false))

  // Save to localStorage when settings change
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LS_KEY_CATEGORY, activeCategory)
    } catch {}
  }, [activeCategory])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LS_KEY_SORT_BY, sortBy)
    } catch {}
  }, [sortBy])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LS_KEY_SORT_ASC, sortAsc ? '1' : '0')
    } catch {}
  }, [sortAsc])

  // Collect all unique asset hashes for price subscription
  const allAssetHashes = useMemo(() => {
    const hashes = new Set<string>();
    activePools.forEach((pool) => {
      pool.hashes.forEach(hash => hashes.add(hash));
    });
    poolAssetsMeta.forEach((_, hash) => hashes.add(hash));
    return Array.from(hashes);
  }, [activePools, poolAssetsMeta]);

  // Subscribe to all asset prices at once
  const priceData = useMultiArpFeed(allAssetHashes, 'usd');

  // Calculate TVL for each pool using live prices
  const poolTVLs = useMemo(() => {
    const tvlMap = new Map<string, number>();

    activePools.forEach((pool, key) => {
      let totalTVL = 0;

      pool.hashes.forEach((hash, index) => {
        const amount = parseFloat(pool.locked[index]);
        const assetPrice = priceData[hash];

        if (assetPrice?.price && amount) {
          const value = amount * assetPrice.price;
          totalTVL += value;
        }
      });

      tvlMap.set(key, totalTVL);
    });

    return tvlMap;
  }, [activePools, priceData]);

  // Fetch volume and price change data from overview endpoint
  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        // -------- PAIRS (LP overview) --------
        const respPairs = await fetch(`${API_HTTP}/api/markets/overview`)
        if (respPairs.ok) {
          const data = await respPairs.json()
          const newMarketDataMap = new Map<string, { volume: number; priceChange: number }>()

          data.forEach((item: any) => {
            const key1 = `${item.a_hash}_${item.b_hash}`
            const key2 = `${item.b_hash}_${item.a_hash}`
            const marketData = {
              volume: item.volume_24h || 0,
              priceChange: item.price_change_24h_pct || 0,
            }
            newMarketDataMap.set(key1, marketData)
            newMarketDataMap.set(key2, marketData)
          })

          setMarketDataMap(newMarketDataMap)
          console.log('[MarketBrowser] Fetched pair market data for', newMarketDataMap.size, 'keys')
        }

        // -------- ASSETS (asset overview) --------
        const respAssets = await fetch(`${API_HTTP}/api/assets/overview`)
        if (respAssets.ok) {
          const assets = await respAssets.json()
          const newAssetDataMap = new Map<
            string,
            { volume: number; priceChange: number; currentPrice?: number; confidence?: number }
          >()

          assets.forEach((a: any) => {
            // expect: { hash, symbol, volume_24h, price_change_24h_pct, current_price, confidence_score }
            const hash = String(a.hash || '').toLowerCase()
            if (!hash) return

            newAssetDataMap.set(hash, {
              volume: a.volume_24h || 0,
              priceChange: a.price_change_24h_pct || 0,
              currentPrice: a.current_price,
              confidence: a.confidence_score,
            })
          })

          // -------- NATIVE ASSET (XEL) via sparkline --------
          // Fetch XEL price and change from sparkline endpoint (like TokenStats does)
          const nativeSymbol = createUsdSymbol(NATIVE_ASSET_HASH)
          if (nativeSymbol) {
            try {
              const sparkRes = await fetch(`${API_HTTP}/v1/sparkline?symbol=${nativeSymbol}&window=24h`)
              if (sparkRes.ok) {
                const sparkData = await sparkRes.json()
                if (sparkData.s === 'ok' && sparkData.p && sparkData.p.length > 0) {
                  const prices = sparkData.p
                  const firstPrice = prices[0]
                  const lastPrice = prices[prices.length - 1]
                  const priceChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0

                  newAssetDataMap.set(NATIVE_ASSET_HASH.toLowerCase(), {
                    volume: 0, // XEL doesn't have direct volume
                    priceChange,
                    currentPrice: lastPrice,
                    confidence: 1,
                  })
                  console.log('[MarketBrowser] Fetched XEL sparkline:', { lastPrice, priceChange })
                }
              }
            } catch (err) {
              console.warn('[MarketBrowser] Failed to fetch XEL sparkline:', err)
            }
          }

          setAssetDataMap(newAssetDataMap)
          console.log('[MarketBrowser] Fetched asset data for', newAssetDataMap.size, 'assets')
        }
      } catch (err) {
        console.error('[MarketBrowser] Failed to fetch market data:', err)
      }
    }

    fetchMarketData()
    const interval = setInterval(fetchMarketData, 60_000)
    return () => clearInterval(interval)
  }, [])

  // Helper to get items for the active category (must be before early returns)
  const getActiveItems = useMemo(() => {
    // If "all-markets", create items from ALL pools from contract data
    if (activeCategory === 'all-markets') {
      const allMarketItems: TickerSection[] = []

      console.log(marketDataMap);

      activePools.forEach((pool, poolKey) => {
        const [aHash, bHash] = pool.hashes
        const [aTicker, bTicker] = pool.tickers

        // Get volume and price change from marketDataMap
        const marketKey = `${aHash}_${bHash}`
        const marketKeyFlip = `${bHash}_${aHash}`
        const marketData = marketDataMap.get(marketKey) ?? marketDataMap.get(marketKeyFlip)

        allMarketItems.push({
          type: 'item',
          data: {
            symbol: `${aTicker}_${bTicker}`,
            a_hash: aHash,
            b_hash: bHash,
            price_change_24h_pct: marketData?.priceChange || 0,
            volume_24h: marketData?.volume || 0,
            isAsset: false,
          }
        })
      })

      return allMarketItems
    }

    // If "all-assets", create items from ALL assets from contract data
    if (activeCategory === 'all-assets') {
      const allAssetItems: TickerSection[] = []
      let nativeItem: TickerSection | null = null

      console.log(assetDataMap)

      poolAssetsMeta.forEach((asset, hash) => {
        const hLower = String(hash).toLowerCase()
        const api = assetDataMap.get(hLower)

        const item: TickerSection = {
          type: 'item',
          data: {
            symbol: asset.ticker || 'Unknown',
            a_hash: hash,
            b_hash: '',
            // Enrichment from API (fallback to 0)
            price_change_24h_pct: api?.priceChange ?? 0,
            volume_24h: api?.volume ?? 0,
            // Prefer API price if available, else contract/meta price
            current_price: api?.currentPrice ?? asset.price,
            // confidence_score: api?.confidence ?? 0,
            isAsset: true,
          },
        }

        // Pin native asset to the top
        if (hash === NATIVE_ASSET_HASH) {
          nativeItem = item
        } else {
          allAssetItems.push(item)
        }
      })

      // Add native asset at the beginning if found
      if (nativeItem) {
        return [nativeItem, ...allAssetItems]
      }
      return allAssetItems
    }

    // Otherwise, find the specific category
    const headerLabel =
      activeCategory === 'trending' ? 'TRENDING' :
      activeCategory === 'new' ? 'NEW PAIRS' :
      activeCategory === 'gainers' ? 'GAINERS' :
      'LOSERS'

    const startIdx = sections.findIndex(
      (s) => s.type === 'header' && s.label === headerLabel
    )

    if (startIdx === -1) return []

    const items: typeof sections = []
    for (let i = startIdx + 1; i < sections.length; i++) {
      if (sections[i].type === 'header' || sections[i].type === 'divider') break
      if (sections[i].type === 'item') items.push(sections[i])
    }

    return items
  }, [sections, activeCategory, activePools, poolAssetsMeta, marketDataMap, assetDataMap])

  // Apply search filter and sorting to active items
  const filteredItems = useMemo(() => {
    let items = getActiveItems

    // Apply search filter
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase()
      items = items.filter((section) => {
        if (section.type !== 'item') return false

        const item = section.data
        const baseAsset = poolAssetsMeta.get(item.a_hash)
        const quoteAsset = item.b_hash ? poolAssetsMeta.get(item.b_hash) : null

        // Search by symbol, ticker, name, or hash
        return (
          item.symbol?.toLowerCase().includes(query) ||
          baseAsset?.ticker?.toLowerCase().includes(query) ||
          baseAsset?.name?.toLowerCase().includes(query) ||
          quoteAsset?.ticker?.toLowerCase().includes(query) ||
          quoteAsset?.name?.toLowerCase().includes(query) ||
          item.a_hash?.toLowerCase().includes(query) ||
          item.b_hash?.toLowerCase().includes(query)
        )
      })
    }

    // Apply sorting
    const sorted = [...items].sort((a, b) => {
      if (a.type !== 'item' || b.type !== 'item') return 0

      const aData = a.data
      const bData = b.data

      let aVal = 0
      let bVal = 0

      if (sortBy === 'volume') {
        aVal = aData.volume_24h || aData.total_volume || 0
        bVal = bData.volume_24h || bData.total_volume || 0
      } else if (sortBy === 'change') {
        aVal = aData.price_change_24h_pct || 0
        bVal = bData.price_change_24h_pct || 0
      } else if (sortBy === 'tvl') {
        // Use pre-calculated TVL map for LP pairs
        if (!aData.isAsset && aData.b_hash) {
          const poolKey1 = `${aData.a_hash}_${aData.b_hash}`
          const poolKey2 = `${aData.b_hash}_${aData.a_hash}`
          aVal = poolTVLs.get(poolKey1) ?? poolTVLs.get(poolKey2) ?? 0
        }
        if (!bData.isAsset && bData.b_hash) {
          const poolKey1 = `${bData.a_hash}_${bData.b_hash}`
          const poolKey2 = `${bData.b_hash}_${bData.a_hash}`
          bVal = poolTVLs.get(poolKey1) ?? poolTVLs.get(poolKey2) ?? 0
        }
      }

      return sortAsc ? aVal - bVal : bVal - aVal
    })

    // Pin native asset to the top if it's in the results (only for "all-assets" category)
    if (activeCategory === 'all-assets') {
      const nativeIndex = sorted.findIndex(
        section => section.type === 'item' && section.data.a_hash === NATIVE_ASSET_HASH
      )
      if (nativeIndex > 0) {
        const nativeItem = sorted[nativeIndex]
        return [nativeItem, ...sorted.slice(0, nativeIndex), ...sorted.slice(nativeIndex + 1)]
      }
    }

    return sorted
  }, [getActiveItems, searchTerm, poolAssetsMeta, sortBy, sortAsc, activePools, activeCategory])

  // Early returns AFTER all hooks
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-white/50">Loading market data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-400/70 text-sm">Failed to load market data</div>
      </div>
    )
  }

  const handleItemClick = (item: any) => {
    if (item.isAsset) {
      // Individual asset - populate from, clear to
      onSelectAsset?.(item.a_hash)
    } else {
      // LP pair - populate both
      onSelectPair?.(item.a_hash, item.b_hash)
    }
  }

  const renderItem = (section: typeof sections[number], index: number) => {
    if (section.type !== 'item') return null

    const item = section.data
    const [base, quote] = item.symbol?.split('_') || ['?', '?']
    const priceChange = item.price_change_24h_pct || 0
    const isPositive = priceChange >= 0
    const volume = item.volume_24h || item.total_volume || 0
    const isAsset = item.isAsset

    const baseAsset = poolAssetsMeta.get(item.a_hash)
    const quoteAsset = item.b_hash ? poolAssetsMeta.get(item.b_hash) : null
    const baseTicker = baseAsset?.ticker || base
    const quoteTicker = quoteAsset?.ticker || quote
    const baseName = baseAsset?.name || base
    const quoteName = quoteAsset?.name || quote

    // Calculate TVL for LP pairs
    let tvl = 0
    if (!isAsset && item.b_hash) {
      const poolKey1 = `${item.a_hash}_${item.b_hash}`
      const poolKey2 = `${item.b_hash}_${item.a_hash}`
      tvl = poolTVLs.get(poolKey1) ?? poolTVLs.get(poolKey2) ?? 0
    }

    return (
      <div
        key={`${item.a_hash}_${item.b_hash}_${index}`}
        onClick={() => handleItemClick(item)}
        className="flex items-center gap-2 px-3 py-2 hover:bg-forge-orange/10 cursor-pointer transition-colors border-b border-white/5 last:border-b-0"
      >
        {/* Icon(s) */}
        {isAsset ? (
          <div className="relative flex items-center flex-shrink-0" style={{ width: 40, height: 40 }}>
            <TokenIcon
              tokenSymbol={baseTicker}
              tokenHash={item.a_hash}
              tokenName={baseName}
              size={40}
            />
          </div>
        ) : (
          <div className="relative flex items-center flex-shrink-0" style={{ width: 64, height: 40 }}>
            <div className="absolute left-[30px] z-0">
              <TokenIcon
                tokenSymbol={quoteTicker}
                tokenHash={item.b_hash}
                tokenName={quoteName}
                size={40}
              />
            </div>
            <div className="absolute left-0 z-10">
              <TokenIcon
                tokenSymbol={baseTicker}
                tokenHash={item.a_hash}
                tokenName={baseName}
                size={40}
              />
            </div>
          </div>
        )}

        {/* Symbol & TVL/Price */}
        <div className="flex-1 min-w-0">
          <div className="text-white text-[13pt] font-normal truncate">
            {isAsset ? baseTicker : `${baseTicker} - ${quoteTicker}`}
          </div>
          {!isAsset && tvl > 0 && (
            <div className="text-sm text-forge-orange/80 -mt-0.5">
              TVL: <span className="text-forge-orange font-bold">${formatCompactNumber(tvl)}</span>
            </div>
          )}
          {isAsset && item.current_price !== undefined && (
            <div className="text-sm text-forge-orange font-semibold -mt-0.5">
              $
              {item.current_price >= 1000
                ? item.current_price.toFixed(0)
                : item.current_price >= 1
                ? item.current_price.toFixed(2)
                : item.current_price >= 0.01
                ? item.current_price.toFixed(4)
                : item.current_price.toFixed(6)}
            </div>
          )}
        </div>

        {/* Price Change & Volume */}
        <div className="text-right min-w-[80px] flex-shrink-0">
          <div className={`text-sm font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}
            {priceChange.toFixed(2)}%
          </div>
          <div className="text-white text-sm">
            V:{' '}
            {volume >= 1_000_000
              ? `$${(volume / 1_000_000).toFixed(1)}M`
              : volume >= 1_000
              ? `$${(volume / 1_000).toFixed(1)}K`
              : `$${volume.toFixed(0)}`}
          </div>
        </div>
      </div>
    )
  }

  // Determine available sort options based on category
  const isLpCategory = activeCategory === 'all-markets' || activeCategory === 'trending' || activeCategory === 'new'
  const isAssetCategory = activeCategory === 'all-assets' || activeCategory === 'gainers' || activeCategory === 'losers'

  return (
    <div className="flex flex-col h-full">
      {/* Header with Search and Category Dropdown */}
      <div className="p-3 space-y-2 border-b border-forge-orange/10 bg-black/30">
        {/* Search Bar */}
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search markets..."
          className="w-full bg-black/80 text-white text-sm px-3 py-1.5 rounded-md border border-forge-orange/30 focus:outline-none focus:border-forge-orange transition-colors"
        />

        {/* Category Dropdown and Sort Controls */}
        <div className="flex items-center gap-2">
          {/* Category Dropdown */}
          <div ref={dropdownRef} className="relative flex-1">
            <div
              onClick={() => setDropdownOpen(o => !o)}
              className="
                text-white/80 font-medium text-sm cursor-pointer
                flex items-center justify-between
                px-3 py-1.5 rounded-md
                bg-black/60 border border-forge-orange/20
                hover:border-forge-orange/40 transition-colors
              "
            >
              <span>{CATEGORY_LABELS[activeCategory]}</span>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="opacity-70"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            {dropdownOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1 w-full rounded-md border border-white/10 bg-[#0e121a]/95 shadow-lg p-1 text-sm z-50"
              >
                {(['all-markets', 'all-assets', 'trending', 'new', 'gainers', 'losers'] as CategoryType[]).map(category => {
                  const selected = activeCategory === category
                  return (
                    <div
                      key={category}
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        setActiveCategory(category)
                        setDropdownOpen(false)
                      }}
                      className={`
                        w-full flex items-center text-left gap-2 px-2 py-1.5 rounded
                        cursor-pointer hover:bg-white/5
                        ${selected ? 'text-white bg-white/5' : 'text-gray-300'}
                        transition-colors
                      `}
                    >
                      <span className="w-4 text-[12px]">
                        {selected ? '✓' : '\u00A0'}
                      </span>
                      <span>{CATEGORY_LABELS[category]}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Sort By Dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="bg-black/80 text-white text-xs px-2 py-1.5 rounded-md border border-forge-orange/30 focus:outline-none focus:border-forge-orange"
          >
            {isLpCategory && <option value="tvl">TVL</option>}
            <option value="volume">Vol</option>
            <option value="change">% 24h</option>
          </select>

          {/* Sort Direction Button */}
          <Button
            onClick={() => setSortAsc(!sortAsc)}
            focusOnClick={false}
            className="!p-1.5 bg-black/70 border border-forge-orange/30 rounded-md hover:bg-white/10 transition"
          >
            {sortAsc ? (
              <ArrowUp className="w-4 h-4 text-white" />
            ) : (
              <ArrowDown className="w-4 h-4 text-white" />
            )}
          </Button>
        </div>
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        {filteredItems.length > 0 ? (
          <div className="animate-fadeIn">
            {filteredItems.map((section, idx) => renderItem(section, idx))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full animate-fadeIn">
            <div className="text-white/30 text-sm">
              {searchTerm ? 'No matching markets' : 'No data available'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default MarketBrowser
