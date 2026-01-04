import React, { useState, useEffect } from 'react'
import TokenIcon from '../ui/TokenIcon'
import { Sparkline } from '../ui/Sparkline'
import { createUsdSymbol } from '@/utils/symbolMapping'
import { useForge } from '@/contexts/ForgeContext'

interface TokenStatsProps {
  symbol: string
  tokenName?: string
  tokenHash?: string
  className?: string
  sparkHeight?: number
  isProMode?: boolean
}

const TokenStats = ({
  symbol,
  tokenName = '',
  tokenHash = '',
  className = '',
  sparkHeight = 60,
  isProMode = false
}: TokenStatsProps) => {
  const { router } = useForge();
  const [priceChange, setPriceChange] = useState<number>(0)
  const [hasData, setHasData] = useState<boolean>(false)
  const [currentPrice, setCurrentPrice] = useState<number>(0)

  // Reset state when token changes (e.g., after swap)
  useEffect(() => {
    setPriceChange(0)
    setHasData(false)
    setCurrentPrice(0)
  }, [tokenHash, symbol])

  // Use hash-based sparkline symbol (hash_USD for oracle pricing)
  const sparklineSymbol = tokenHash ? createUsdSymbol(tokenHash) : null
  
  const handleSparklineLoad = (pct: number, price?: number) => {
    setPriceChange(pct)
    if (price) setCurrentPrice(price)
    setHasData(true)
  }

  const handleSparklineError = () => {
    setHasData(false)
  }

  return (
    <div className={`bg-black/70 rounded-md p-1.5 min-h-inherit flex flex-col animated-border ${className}`}>
      {/* Header with conditional price change */}
      <div className="flex bg-black/60 rounded-md p-1 items-center justify-between mb-1 -ml-1.5 -mr-1.5 -mt-1.5">
        <div className="flex flex-col text-left ml-1 min-w-0 flex-shrink">
          <span className="text-white text-sm font-medium">{symbol}</span>
          <span className="text-forge-orange text-xs -mt-0.75 font-regular truncate">{tokenName}</span>
        </div>

        {/* Price and % change section - right aligned to icon */}
        <div className="flex flex-col text-right mr-1.5 flex-grow">
          {hasData && (
            <>
              <span className="text-white text-sm font-medium">
                ${currentPrice?.toFixed(3) || '0.000'}
              </span>
              <span className={`text-xs font-regular -mt-0.75 ${
                priceChange >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
              </span>
            </>
          )}
        </div>

        <div className="mr-0.5 flex-shrink-0">
          <TokenIcon
            tokenSymbol={symbol}
            tokenName={tokenName}
            tokenHash={tokenHash}
            size={32}
          />
        </div>
      </div>

      {/* Chart area with fallback */}
      <div className="flex-grow flex items-center justify-center">
        {sparklineSymbol && symbol !== "—" ? (
          <Sparkline
            symbol={sparklineSymbol}
            width="100%"
            height={sparkHeight}
            strokeFrom="#462013"
            strokeTo="#ffffff"
            smooth="ema"
            emaPeriod={12}
            showArea={true}
            areaFrom="#462013"
            areaTo="#462013"
            areaOpacityTop={0.3}
            areaOpacityBottom={0.0}
            refreshMs={30000}
            routerAddress={router?.address}
            onPriceChange={handleSparklineLoad}
            // onError={handleSparklineError}
          />
        ) : (
          <div className="text-white/35 flex items-center justify-center w-full h-full text-sm">
            {symbol === "—" ? 'Select token' : 'No chart data'}
          </div>
        )}
      </div>
    </div>
  )
}

export default TokenStats