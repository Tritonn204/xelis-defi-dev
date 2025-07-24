import React from 'react'
import '../../components/ui/num_nospinner.css'
import { stringToColor } from '../../utils/strings'
import Button from '../ui/Button'
import { useAssets } from '@/contexts/AssetContext'
import TokenIcon from '../ui/TokenIcon'

const LiquidityInput = ({ 
  label = '', 
  amount = '', 
  onChange = (val: any)=>{}, 
  tokenHash = '',
  tickerWidth = 6
}) => {
  const { assets } = useAssets()

  const asset = assets[tokenHash]!
  const tokenName = asset.name
  const tokenSymbol = asset.ticker
  const decimals = asset.decimals
  const balance = asset.balance
  const tokenColor = stringToColor(tokenSymbol + tokenName)
  const firstLetter = tokenSymbol?.charAt(0) || '?'
  
  const handleMaxClick = () => {
    // Use the actual balance, but leave a small amount for fees if it's XEL
    const balanceNum = parseFloat(balance || '0')
    if ((tokenSymbol === 'XEL' || tokenSymbol === 'XET') && balanceNum > 0.0005) {
      onChange((balanceNum - 0.0005).toFixed(decimals))
    } else {
      onChange(balance.toString() || '0')
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
              className="bg-transparent text-white text-2xl font-semibold outline-none w-full pl-1"
              min="0"
              step={`0.${"0".repeat(decimals-1)}1`} // Dynamic step based on decimals
            />
          </div>
          
          {/* Right side - Icon and ticker, vertically centered with input */}
          <div className="flex items-center space-x-2 ml-4">
            <TokenIcon tokenSymbol={tokenSymbol} tokenHash={tokenHash} tokenName={tokenName} size={36} />
            <span 
              className="text-white font-medium text-right"
              style={{ minWidth: `${tickerWidth}ch` }}
            >
              {tokenSymbol}
            </span>
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          {/* Empty div for spacing */}
          <div></div>
        
          {/* Balance with MAX button */}
          <div className="flex items-center text-xs text-gray-500 mt-2 pl-1">
            <span>{balance || '0.0'}</span>
              <Button 
                className="ml-2 px-1 text-xs text-forge-orange transition-all duration-200 rounded-full ring-white/10 hover:text-forge-orange/80 font-medium"
                focusOnClick={false}
                onClick={handleHalfClick}
              >
                HALF
              </Button>
              <Button 
                className="ml-1 px-1 text-xs text-forge-orange transition-all duration-200 rounded-full ring-forge-orange/10 hover:text-forge-orange/80 font-medium"
                onClick={handleMaxClick}
                focusOnClick={false}
              >
                MAX
              </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LiquidityInput