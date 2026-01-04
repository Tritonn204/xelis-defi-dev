import { useState, useEffect, memo } from 'react'
import { TokenIcon } from '@/components/ui/TokenIcon'
import Button from '@/components/ui/Button'
import { getSharedDataFeed } from '@/lib/datafeed-singleton'
import type { UseArpFeedResult } from '@/hooks/useFeed'

interface PortfolioItemProps {
  asset: {
    hash: string
    ticker: string
    name: string
    balance?: string
    tracked: boolean
  }
  priceData: UseArpFeedResult | null
  isConnected: boolean
  onSelect: (hash: string) => void
  onTrack: (hash: string) => void
}

const PortfolioItem = memo(({ asset, priceData, isConnected, onSelect, onTrack }: PortfolioItemProps) => {
  const [priceChange24h, setPriceChange24h] = useState<number | null>(null)

  // Fetch 24h ago price for change calculation
  useEffect(() => {
    if (!asset.tracked || !priceData?.price) return

    let cancelled = false

    const fetch24hChange = async () => {
      try {
        const feed = getSharedDataFeed()
        const now = Date.now()
        const exactlyOneDayAgo = Math.floor((now - 24 * 60 * 60 * 1000) / 1000)
        
        // Fetch a small window around 24h ago
        const candles = await feed.history(
          `${asset.hash}_USD`,
          '5', // 5-minute resolution
          exactlyOneDayAgo - 300, // 5 mins before 24h ago
          exactlyOneDayAgo + 300, // 5 mins after 24h ago
          false // don't include live
        )
        
        if (!cancelled && candles.length > 0) {
          // Get the closest candle to 24h ago
          const oldPrice = candles[Math.floor(candles.length / 2)].close
          const currentPrice = priceData.price
          
          if (oldPrice > 0) {
            const change = ((currentPrice - oldPrice) / oldPrice) * 100
            setPriceChange24h(change)
          }
        }
      } catch (err) {
        console.warn('[PortfolioItem] Failed to fetch 24h change:', err)
        // Fallback: just use current data
        setPriceChange24h(null)
      }
    }

    fetch24hChange()

    return () => {
      cancelled = true
    }
  }, [asset.hash, asset.tracked, priceData?.price])

  const formatHash = (hash: string) => {
    if (hash.length <= 12) return hash
    return `${hash.slice(0, 4)}...${hash.slice(-8)}`
  }

  const formatBalance = (balance?: string) => {
    if (!balance || balance === '0') return '0'
    const num = parseFloat(balance)
    if (num === 0) return '0'
    if (num < 0.0001) return num.toExponential(2)
    if (num < 1) return num.toFixed(4)
    if (num < 1000) return num.toFixed(2)
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }

  const formatValue = (balance?: string, price?: number | null) => {
    if (!balance || !price) return '—'
    const value = parseFloat(balance) * price
    if (value < 0.01) return `$${value.toFixed(4)}`
    if (value < 1) return `$${value.toFixed(2)}`
    return `${value.toLocaleString(undefined, { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2 
    })}`
  }

  return (
    <Button
      onClick={() => onSelect(asset.hash)}
      className="w-full flex items-center space-x-1 p-1 pt-0 pb-0 rounded-xl transition-all duration-200"
    >
      <TokenIcon
        tokenSymbol={asset.ticker}
        tokenName={asset.name}
        tokenHash={asset.hash}
        size={36}
      />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="font-medium text-white truncate">
            {asset.ticker}
          </div>
        </div>
        <div className="text-sm text-gray-400 text-left truncate">
          {asset.name}
          <span className="text-xs text-forge-orange/50 font-mono ml-2 flex-shrink-0">
            {formatHash(asset.hash)}
          </span>
        </div>
      </div>

      <div className="text-right flex-shrink-0 ml-2 min-w-[100px]">
        {asset.tracked ? (
          <>
            {/* 24h change */}
            <div className={`text-xs font-medium ${
              priceChange24h === null ? 'text-gray-500' :
              priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {priceChange24h === null ? 
                'Loading...' :
                `${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%`
              }
            </div>
            
            {/* USD Value */}
            <div className="text-xs text-gray-400">
              {formatValue(asset.balance, priceData?.price)}
            </div>
            
            {/* Balance */}
            <div className="text-xs font-medium text-white">
              {isConnected ? formatBalance(asset.balance) : '—'}
            </div>
          </>
        ) : (
          <Button
            onClick={(e: any) => {
              e.stopPropagation()
              onTrack(asset.hash)
            }}
            className="bg-transparent transition-all duration-200 hover:bg-black/100 text-forge-orange text-sm px-2 py-1 rounded-lg"
          >
            Track Balance
          </Button>
        )}
      </div>
    </Button>
  )
}, (prevProps, nextProps) => {
  if (prevProps.asset.hash !== nextProps.asset.hash) return false
  if (prevProps.asset.tracked !== nextProps.asset.tracked) return false
  if (prevProps.asset.balance !== nextProps.asset.balance) return false
  if (prevProps.isConnected !== nextProps.isConnected) return false
  
  const prevPrice = prevProps.priceData?.price
  const nextPrice = nextProps.priceData?.price
  if (prevPrice !== nextPrice) return false
  
  return true
})

export default PortfolioItem