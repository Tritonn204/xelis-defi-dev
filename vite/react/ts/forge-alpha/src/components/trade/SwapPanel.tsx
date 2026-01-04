import React, { memo } from 'react'
import TokenInput from '@/components/trade/TokenInput'
import TokenStats from '@/components/trade/TokenStats'
import SwapButton from '@/components/trade/SwapButton'
import SlippageSettings from '@/components/trade/SlippageSettings'
import Button from '@/components/ui/Button'
import type { TradingViewProps } from '@/types/trade'
import ProModeToggle from './ProModeToggle'

export const SwapPanel: React.FC<TradingViewProps> = ({
  // Assets & Pool data
  assets,
  selectedAssets,
  swapAmounts,
  poolAssets,
  slippage,
  execSlippage,
  priceImpact,
  hasValidPool,
  swapCalculation,

  // UI state
  error,
  showSuccess,
  isSubmitting,
  isSwapDisabled,
  isProMode,

  // Wallet
  isConnected,
  connecting,
  openConnectModal,

  // Handlers
  handleTokenSelect,
  handleAmountChange,
  swapAssets,
  handleSwap,
  setSlippage,
}) => {
  const fromToken = poolAssets.get(selectedAssets.from)
  const toToken = poolAssets.get(selectedAssets.to)

  return (
    <div className="p-2 flex flex-col">
      {/* Header - no GeometricAccents */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl ml-2 font-semibold text-white">Swap</h2>
        <div className="flex items-center space-x-1">
          <span className="text-forge-orange text-sm">Slippage: {slippage}%</span>
          <SlippageSettings 
            slippage={slippage} 
            onSlippageChange={setSlippage} 
          />
          <ProModeToggle
            variant="ghost"
            className="ml-0"
          />
        </div>
      </div>

      {/* Success message */}
      {showSuccess && (
        <div className="bg-green-500/20 border border-green-500/50 text-green-400 px-3 py-2 rounded-lg mb-3 text-sm">
          ✓ Swap successful!
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-lg mb-3 text-sm">
          {error}
        </div>
      )}

      {/* Token inputs with swap button */}
      <div className="relative mb-4">
        {/* From Token */}
        <div className="mb-1.5">
          <TokenInput
            label="You Send"
            amount={swapAmounts.from}
            onChange={(value: string) => handleAmountChange('from', value)}
            tokenSymbol={fromToken?.ticker || 'Select'}
            tokenHash={fromToken?.hash}
            tokenName={fromToken?.name || ''}
            // @ts-ignore
            price={fromToken?.price}
            tickerWidth={5}
            onTokenSelect={() => handleTokenSelect('from')}
            showMaxHalf={true}
            decimals={fromToken?.decimals || 8}
            disabled={isSubmitting}
            isProMode={isProMode}
          />
        </div>

        {/* To Token */}
        <div className="mt-1.5">
          <TokenInput
            label="You Receive"
            amount={swapAmounts.to}
            onChange={(value: string) => handleAmountChange('to', value)}
            tokenSymbol={toToken?.ticker || 'Select'}
            tokenName={toToken?.name || ''}
            tokenHash={toToken?.hash}
            // @ts-ignore
            price={toToken?.price}
            tickerWidth={5}
            onTokenSelect={() => handleTokenSelect('to')}
            disabled={isSubmitting}
            decimals={toToken?.decimals || 8}
            isProMode={isProMode}
          />
        </div>

        {/* Circular Swap Button */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <SwapButton
            onClick={() => {
              const newFrom = swapAmounts.to
              swapAssets()
              handleAmountChange('from', newFrom)
            }}
            loading={false}
            disabled={!hasValidPool || isSubmitting}
          />
        </div>
      </div>

      {/* Price impact */}
      {/* {hasValidPool && (
        <div className={`text-xs px-2 py-1 rounded-md mb-1 -mt-3 ${
          priceImpact > 5 ? 'bg-red-500/20 text-red-400' : 
            priceImpact > Math.min(1, slippage) ? 'bg-yellow-500/20 text-yellow-400' : 
              priceImpact > 0 ? 'bg-green-500/20 text-green-400' : 'bg-black/60 text-white/50'
          }`}>
          Price Impact {priceImpact.toFixed(2)}%
        </div>
      )} */}

      {/* Slippage warning */}
      {hasValidPool && (
        <div className={`text-xs px-2 py-1 rounded-md mb-3 -mt-2 ${
          execSlippage > 5 ? 'bg-red-500/20 text-red-400' : 
            execSlippage > Math.min(1, slippage) ? 'bg-yellow-500/20 text-yellow-400' : 
              execSlippage > 0 ? 'bg-green-500/20 text-green-400' : 'bg-black/60 text-white/50'
          }`}>
          Expected Slippage {execSlippage.toFixed(2)}% {execSlippage >= slippage ? `is too high! Increase Slippage % or lower ${fromToken?.ticker}` : ''}
        </div>
      )}

      {/* No pool warning */}
      {!hasValidPool && selectedAssets.from && selectedAssets.to && (
        <div className="text-xs px-3 py-1 rounded-md mb-3 bg-red-500/20 text-red-400">
          No liquidity pool available for this pair
        </div>
      )}

      {/* Swap details */}
      {hasValidPool && (
        <div className="text-xs text-gray-400 mb-4 px-1">
          <div className="flex justify-between">
            <span>Minimum received:</span>
            <span>
              {swapCalculation
                ? `${(swapCalculation.amountOutMin / Math.pow(10, toToken?.decimals || 8)).toFixed(4)} ${toToken?.ticker}`
                : `0.00 ${toToken?.ticker}`}
            </span>
          </div>
        </div>
      )}

      {/* Action Button */}
      {isConnected ? (
        <Button
          onClick={handleSwap}
          disabled={isSwapDisabled || parseFloat(swapAmounts.from) > parseFloat(assets[fromToken?.hash || '']?.balance || '0')}
          focusOnClick={false}
          className="
            w-full 
            bg-forge-orange 
            hover:bg-forge-orange/90 
            disabled:bg-gray-600 
            text-white 
            font-light
            text-[1.5rem]
            py-1 px-4 
            rounded-xl 
            transition-all duration-200
            hover:shadow-lg
            hover:ring-2 ring-white
            hover:scale-[1.015]
            active:scale-[0.98]
            disabled:hover:scale-100
            disabled:hover:ring-0
            mb-4
          "
          isLoading={isSubmitting}
          staticSize={true}
        >
          {isSubmitting ? 'Swapping...' : 
           !hasValidPool ? 'No Pool Available' :
           !swapAmounts.from ? 'Enter Amount' :
           parseFloat(swapAmounts.from) > parseFloat(assets[fromToken?.hash || '']?.balance || '0') ? 'Insufficient Balance' :
           'Swap'}
        </Button>
      ) : (
        <Button
          onClick={openConnectModal}
          focusOnClick={false}
          className="
            w-full 
            bg-white 
            text-black 
            font-light
            text-[1.5rem]
            py-1 px-4 
            rounded-xl 
            transition-all duration-200
            hover:shadow-lg
            hover:ring-2 ring-forge-orange
            hover:scale-[1.015]
            active:scale-[0.98]
            mb-4
          "
          isLoading={connecting}
          staticSize={true}
        >
          Connect Wallet
        </Button>
      )}
      
      {/* Token Stats - smaller in pro mode */}
      <div className="grid grid-cols-1 gap-2">
        <TokenStats
          symbol={fromToken?.ticker || "—"}
          tokenHash={fromToken?.hash}
          tokenName={fromToken?.name}
          sparkHeight={25}
          isProMode={isProMode}
        />
        <TokenStats
          symbol={toToken?.ticker || "—"}
          tokenHash={toToken?.hash}
          tokenName={toToken?.name}
          sparkHeight={25}
          isProMode={isProMode}
        />
      </div>
    </div>
  )
}

export default memo(SwapPanel);