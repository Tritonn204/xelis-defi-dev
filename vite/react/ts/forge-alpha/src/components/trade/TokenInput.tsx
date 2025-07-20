import React from 'react'

import '../ui/num_nospinner.css'
import { TokenIcon } from '../ui/TokenIcon';

const TokenInput = ({ 
  label, 
  balance, 
  amount, 
  onChange, 
  tokenSymbol,
  tokenName = '',
  price,
  tickerWidth = 6
}) => {
  const fiatValue = parseFloat(amount || 0) * (price || 0)
  const showFiatValue = amount && !isNaN(fiatValue) && fiatValue > 0
  
  return (
    <div className="bg-black/70 rounded-2xl p-3 border border-white/12 backdrop-blur-l">
      <div className="flex flex-col">
        {/* Label aligned with input */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-white mb-1 pl-1">{label}</div>
        </div>
        
        {/* Main input row */}
        <div className="flex items-center justify-between">
          {/* Left side - Input */}
          <div className="flex-1">
            <input
              type="number"
              value={amount}
              onChange={(e) => onChange(e.target.value)}
              placeholder="0.0"
              className="bg-transparent text-white text-2xl font-semibold outline-none w-full pl-1"
            />
          </div>
          
          {/* Right side - Icon and ticker, vertically centered with input */}
          <div className="flex items-center space-x-2 ml-4">
            <TokenIcon tokenSymbol={tokenSymbol} tokenName={tokenName} size={36}/>
            <span 
              className="text-white font-medium text-right"
              style={{ minWidth: `${tickerWidth}ch` }}
            >
              {tokenSymbol}
            </span>
          </div>
        </div>
        
        <div className="flex items-center justify-between">
        {/* Fiat value - only show when input is present */}
          {showFiatValue ? (
            <div className="text-sm text-forge-orange mt-1 pl-1">
              ${fiatValue.toFixed(2)}
            </div>
          ) : <div></div>}
        
          {/* Balance at the bottom, aligned with input */}
          <div className="text-xs text-gray-500 mt-2 pl-1">
            Balance: {balance || '0.0'}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TokenInput