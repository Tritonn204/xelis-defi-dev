import React, { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'

import '../ui/num_nospinner.css'
import { TokenIcon } from '../ui/TokenIcon'
import Button from '../ui/Button'
import { useAssets } from '@/contexts/AssetContext'
import { useLivePrice } from '@/hooks/useFeed'

interface TokenInputProps {
  label: string
  amount: string
  onChange: (value: string) => void
  tokenSymbol: string
  tokenHash?: string
  tokenName?: string
  tickerWidth?: number
  onTokenSelect?: () => void
  disabled?: boolean
  showMaxHalf?: boolean
  decimals?: number
  balance?: string  // Allow override from parent if needed
  isProMode?: boolean
}

const TokenInput = ({
  label,
  amount,
  onChange,
  tokenSymbol,
  tokenName = '',
  tokenHash = '',
  tickerWidth = 6,
  onTokenSelect,
  disabled = false,
  showMaxHalf = false,
  decimals = 8,
  balance: overrideBalance,
  isProMode = false
}: TokenInputProps) => {
  const { assets } = useAssets()
  
  // Get live price for this token
  const usdSymbol = tokenHash ? `${tokenHash}_USD` : null
  const price = useLivePrice(usdSymbol || '', { 
    enabled: !!tokenHash,
    fallbackToBar: true 
  })
  
  // Use override balance if provided, otherwise get from assets
  const balance = overrideBalance ?? assets[tokenHash || '']?.balance ?? '0'
  
  // Calculate fiat value
  const fiatValue = useMemo(() => {
    if (!price || !amount) return 0
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum)) return 0
    return amountNum * price
  }, [amount, price])
  
  const showFiatValue = amount && !isNaN(fiatValue) && fiatValue > 0
  
  const handleMaxClick = () => {
    const balanceNum = parseFloat(balance || '0')
    // Leave a small amount for fees if it's native token
    const isNative = tokenSymbol === 'XEL' || tokenSymbol === 'XET'
    if (isNative && balanceNum > 0.0005) {
      onChange((balanceNum - 0.0005).toFixed(decimals))
    } else {
      onChange(balanceNum.toFixed(decimals))
    }
  }
  
  const handleHalfClick = () => {
    const balanceNum = parseFloat(balance || '0')
    onChange((balanceNum / 2).toFixed(decimals))
  }

  // Format balance for display
  const formatBalance = (bal: string): string => {
    const num = parseFloat(bal)
    if (num === 0) return '0'
    if (num < 0.0001) return num.toExponential(2)
    if (num < 1) return num.toFixed(4)
    if (num < 1000) return num.toFixed(2)
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }

  // Format fiat value for display
  const formatFiatValue = (value: number): string => {
    if (value < 0.01) return `$${value.toFixed(4)}`
    if (value < 1) return `$${value.toFixed(3)}`
    return `$${value.toFixed(2)}`
  }
  
  return (
    <div className={`bg-black/70 rounded-2xl p-3 backdrop-blur-l animated-border`}>
      <div className="flex flex-col">
        {/* Label aligned with input */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-white mb-1 pl-1">{label}</div>
          
          {/* Price indicator (optional) */}
          {price && (
            <div className="text-xs text-gray-500 mb-1 pr-1">
              @ ${price < 1 ? price.toFixed(4) : price.toFixed(2)}
            </div>
          )}
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
          
          {/* Right side - Token selector */}
          <div className="flex items-center ml-4">
            {onTokenSelect ? (
              <Button
                onClick={onTokenSelect}
                disabled={disabled}
                className="flex items-center space-x-2 hover:bg-white/10 rounded-lg px-1 py-0.5 transition-all duration-200 hover:scale-[1.02] -mr-1 disabled:hover:scale-100 disabled:hover:bg-transparent disabled:opacity-50"
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
        
        <div className="flex items-center justify-between mt-2">
          {/* Fiat value - only show when input is present */}
          <div className="text-sm text-forge-orange pl-1 min-h-[1.25rem]">
            {showFiatValue ? formatFiatValue(fiatValue) : ''}
          </div>
        
          {/* Balance with action Buttons */}
          <div className="flex items-center text-xs text-gray-500">
            <span className="mr-1">Balance: {formatBalance(balance)}</span>
            {showMaxHalf && !disabled && parseFloat(balance || '0') > 0 && (
              <div className="flex items-center">
                <Button 
                  className="ml-1 px-1.5 py-0.5 text-xs text-forge-orange/80 hover:text-forge-orange hover:bg-white/5 transition-all duration-200 rounded font-medium"
                  focusOnClick={false}
                  onClick={handleHalfClick}
                >
                  HALF
                </Button>
                <Button 
                  className="ml-1 px-1.5 py-0.5 text-xs text-forge-orange/80 hover:text-forge-orange hover:bg-white/5 transition-all duration-200 rounded font-medium"
                  onClick={handleMaxClick}
                  focusOnClick={false}
                >
                  MAX
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TokenInput