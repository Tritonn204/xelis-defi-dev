import React from 'react'
import TokenIcon from '../ui/TokenIcon'

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
  price,
  priceChange,
  tokenName = '',
  tokenHash
}: TokenStatsProps) => {
  const isPriceUp = parseFloat(priceChange) >= 0
  const priceChangeClass = isPriceUp ? 'text-green-400' : 'text-red-400'

  return (
    <div className="bg-black/70 rounded-md p-1.5">
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

      <div className={priceChangeClass}>${price}</div>
      <div className={priceChangeClass + ' text-xs'}>
        {isPriceUp ? '+' : ''}
        {priceChange}%
      </div>
    </div>
  )
}

export default TokenStats
