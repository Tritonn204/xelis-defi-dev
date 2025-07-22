import React from 'react'
import TokenIcon from '../ui/TokenIcon'
import { usePrices } from '@/contexts/PriceContext'

interface TokenStatsProps {
  symbol: string
  price: string
  priceChange: string
  color?: string
  tokenName?: string
  tokenHash?: string
}

const TokenStats = ({
  symbol,
  tokenName = '',
  tokenHash = ''
}: TokenStatsProps) => {
  const { assetPrices, priceSources } = usePrices();
  const price = assetPrices.get(tokenHash)
  const priceChangeClass = price ? 
    'text-white flex items-center justify-center w-full h-full'
    : 'text-white/35 flex items-center justify-center w-full h-full'

  return (
  <div className="bg-black/70 rounded-md p-1.5 min-h-[100px] flex flex-col">
    {/* HEADER */}
    <div className="flex bg-black/60 rounded-md p-1 items-center justify-between mb-1 -ml-1.5 -mr-1.5 -mt-1.5">
      <div className="flex flex-col text-left ml-1">
        <span className="text-white text-sm font-medium">{symbol}</span>
        <span className="text-forge-orange text-xs font-regular">{tokenName}</span>
      </div>
      <div className="mr-0.5">
        <TokenIcon
          tokenSymbol={symbol}
          tokenName={tokenName}
          tokenHash={tokenHash}
          size={32}
        />
      </div>
    </div>

    {/* PRICE AREA */}
    <div className="flex-grow flex items-center justify-center">
      <div className={priceChangeClass}>
        {price ? `$${price.toFixed(5)} USD` : 'No price data available'}
      </div>
    </div>
  </div>
  )
}

export default TokenStats
