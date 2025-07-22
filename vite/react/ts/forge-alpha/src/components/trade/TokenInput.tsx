import React from 'react'
import { ChevronDown } from 'lucide-react'

import '../ui/num_nospinner.css'
import { TokenIcon } from '../ui/TokenIcon'
import Button from '../ui/Button'
import { useAssets } from '@/contexts/AssetContext'
import { usePrices } from '@/contexts/PriceContext'

interface TokenInputProps {
  label: string
  amount: string
  onChange: (value: string) => void
  tokenSymbol: string
  tokenHash?: string,
  tokenName?: string
  price?: number
  tickerWidth?: number
  onTokenSelect?: () => void
  disabled?: boolean
  showMaxHalf?: boolean
  decimals?: number
}

const TokenInput = ({ 
  label, 
  amount, 
  onChange, 
  tokenSymbol,
  tokenName = '',
  tokenHash ='',
  tickerWidth = 6,
  onTokenSelect,
  disabled = false,
  showMaxHalf = false,
  decimals = 8
}: TokenInputProps) => {
  const { assets } = useAssets()
  const { assetPrices, priceSources } = usePrices();

  const price = assetPrices.get(tokenHash)
  const fiatValue = price ? (parseFloat(amount || '0') * price) : 0
  const showFiatValue = amount && !isNaN(fiatValue) && fiatValue > 0
  const balance = assets[tokenHash || '']?.balance || '0'
  
  const handleMaxClick = () => {
    const balanceNum = parseFloat(balance || '0')
    // Leave a small amount for fees if it's XEL
    if ((tokenSymbol === 'XEL' || tokenSymbol === 'XET') && balanceNum > 0.0005) {
      onChange((balanceNum - 0.0005).toFixed(decimals))
    } else {
      onChange(balanceNum.toString())
    }
  }
  
  const handleHalfClick = () => {
    const balanceNum = parseFloat(balance || '0')
    onChange((balanceNum / 2).toFixed(decimals))
  }
  
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
              disabled={disabled}
              className="bg-transparent text-white text-2xl font-semibold outline-none w-full pl-1 disabled:cursor-not-allowed disabled:text-gray-400"
              min="0"
              step={`0.${"0".repeat(Math.max(0, decimals-1))}1`}
            />
          </div>
          
          {/* Right side - Token selector - same height as before */}
          <div className="flex items-center ml-4">
            {onTokenSelect ? (
              <Button
                onClick={onTokenSelect}
                className="flex items-center space-x-2 hover:bg-white/10 rounded-lg px-1 py-0.5 transition-all duration-200 hover:scale-[1.02] -mr-1"
              >
                <TokenIcon tokenSymbol={tokenSymbol} tokenHash={tokenHash} tokenName={tokenName} size={36} />
                <span
                  className="text-white font-medium text-right"
                  style={{ width: `${tickerWidth}ch`, display: 'inline-block', textAlign: 'right' }}
                >
                  {tokenSymbol}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-400 ml-1" />
              </Button>
            ) : (
              <div className="flex items-center space-x-2">
                <TokenIcon tokenSymbol={tokenSymbol} tokenHash={tokenHash} tokenName={tokenName} size={36} />
                <span
                  className="text-white font-medium text-right"
                  style={{ width: `${tickerWidth}ch`, display: 'inline-block', textAlign: 'right' }}
                >
                  {tokenSymbol}
                </span>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          {/* Fiat value - only show when input is present */}
          {showFiatValue ? (
            <div className="text-sm text-forge-orange mt-1 pl-1">
              ${fiatValue.toFixed(2)}
            </div>
          ) : <div></div>}
        
          {/* Balance with action Buttons */}
          <div className="flex items-center text-xs text-gray-500 mt-2 pl-1">
            <span>{balance || '0.0'}</span>
            {showMaxHalf && !disabled && parseFloat(balance || '0') > 0 && (
              <>
                <Button 
                  className="ml-2 px-0.5 text-xs text-forge-orange hover:text-forge-orange/80 font-medium transition-colors"
                  onClick={handleHalfClick}
                >
                  HALF
                </Button>
                <Button 
                  className="ml-1 px-0.5 text-xs text-forge-orange hover:text-forge-orange/80 font-medium transition-colors"
                  onClick={handleMaxClick}
                >
                  MAX
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TokenInput