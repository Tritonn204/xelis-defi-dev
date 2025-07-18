import React from 'react'

const TokenStats = ({ 
  symbol, 
  price, 
  priceChange, 
  color = 'bg-orange-500' 
}) => {
  const isPriceUp = parseFloat(priceChange) >= 0
  const priceChangeClass = isPriceUp ? 'text-green-400' : 'text-red-400'

  return (
    <div className="bg-black/70 rounded-md p-3">
      <div className="flex items-center space-x-2 mb-1">
        <div className={`w-4 h-4 ${color} rounded-full`}></div>
        <span className="text-white text-sm font-medium">{symbol}</span>
      </div>
      <div className={priceChangeClass}>${price}</div>
      <div className={priceChangeClass + ' text-xs'}>
        {isPriceUp ? '+' : ''}{priceChange}%
      </div>
    </div>
  )
}

export default TokenStats