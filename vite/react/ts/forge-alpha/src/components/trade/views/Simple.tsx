import React from 'react'
import TokenInput from '@/components/trade/TokenInput'
import TokenStats from '@/components/trade/TokenStats'
import SwapButton from '@/components/trade/SwapButton'
import SlippageSettings from '@/components/trade/SlippageSettings'
import Button from '@/components/ui/Button'
import GeometricAccents from '@/components/ui/GeometricAccents'
import type { TradingViewProps } from '@/types/trade'
import ProModeToggle from '../ProModeToggle'
import ScrollTicker from '@/components/ui/ScrollTicker'
import TokenIcon from '@/components/ui/TokenIcon'
import { useMarketData } from '@/hooks/useMarketData'
import { usePools } from '@/contexts/PoolContext'

export const SimpleTradingView: React.FC<TradingViewProps> = ({
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
  const { sections } = useMarketData()
  const { poolAssets: poolAssetsMeta } = usePools()

  return (
    <div className="flex justify-center items-center min-h-[75vh]">
      <div className="background-transparent rounded-2xl p-5 w-full max-w-[475px]">
        <GeometricAccents
          accentWidth={19}
          tipExtension={60}
          tipAngle={50}
          variant="white"
          gap={7}
          alpha={0.7}
          glassEffect={true}
          gradient={true}
          blendMode='soft-light'
          isLoading={isSubmitting}
        >
          {/* Header with slippage settings */}
          <div className="flex items-center justify-between mb-1.5">
            <h2 className="text-xl font-semibold text-white">Swap</h2>
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
            <div className="bg-green-500/20 border border-green-500/50 text-green-400 px-3 py-2 rounded-lg mb-2 text-sm">
              ✓ Swap successful!
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-500/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-lg mb-2 text-sm">
              {error}
            </div>
          )}

          {/* Token inputs with swap button */}
          <div className="relative">
            {/* From Token */}
            <div className="mb-1.5">
              <TokenInput
                label="You Send"
                amount={swapAmounts.from}
                onChange={(value: string) => handleAmountChange('from', value)}
                tokenSymbol={fromToken?.ticker || 'Select'}
                tokenHash={fromToken?.hash}
                tokenName={fromToken?.name || ''}
                price={fromToken?.price}
                tickerWidth={5}
                onTokenSelect={() => handleTokenSelect('from')}
                showMaxHalf={true}
                decimals={fromToken?.decimals || 8}
                disabled={isSubmitting}
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
                price={toToken?.price}
                tickerWidth={5}
                onTokenSelect={() => handleTokenSelect('to')}
                disabled={isSubmitting}
                decimals={toToken?.decimals || 8}
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

          {/* Price impact warning */}
          {hasValidPool && (
            <div className={`text-xs px-2 py-1 rounded-md mt-2 ${execSlippage > 5 ? 'bg-red-500/20 text-red-400' :
              execSlippage > Math.min(1, slippage) ? 'bg-yellow-500/20 text-yellow-400' :
                execSlippage > 0 ? 'bg-green-500/20 text-green-400' : 'bg-black/60 text-white/50'
              }`}>
              Expected Slippage {execSlippage.toFixed(2)}% {execSlippage >= slippage ? `is too high! Increase Slippage % or lower ${fromToken?.ticker}` : ''}
            </div>
          )}

          {/* No pool warning */}
          {!hasValidPool && selectedAssets.from && selectedAssets.to && (
            <div className="text-xs px-3 py-1 rounded-md mt-2 bg-red-500/20 text-red-400">
              No liquidity pool available for this pair
            </div>
          )}

          {/* Swap details */}
          {hasValidPool && (
            <div className="text-xs text-gray-400 mt-2 px-1">
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

          {/* Spacing after inputs */}
          <div className="mt-2"></div>

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
              "
              isLoading={connecting}
              staticSize={true}
            >
              Connect Wallet
            </Button>
          )}

          <div className="mt-2"></div>

          {/* Token Stats */}
          <div className="grid grid-cols-2 gap-2">
            <TokenStats
              symbol={fromToken?.ticker || "—"}
              tokenHash={fromToken?.hash}
              tokenName={fromToken?.name}
            />
            <TokenStats
              symbol={toToken?.ticker || "—"}
              tokenHash={toToken?.hash}
              tokenName={toToken?.name}
            />
          </div>
        </GeometricAccents>
      </div>
      <div className="fixed bottom-0 left-0 right-0 h-[3.5rem] bg-black/40 backdrop-blur-lg border-t-1 border-forge-orange/30 shadow-[0_-2px_15px_var(--color-forge-orange)]/35">
        <ScrollTicker
          speed={40}
          mode="loop"
          height="3rem"
          loopGap={0}
          persistId="trending-ticker"
        >
          {(index) => {
            // Use fallback array if sections not loaded
            const displaySections = sections.length > 0 ? sections : [
              { type: 'header' as const, label: 'LOADING' },
              {
                type: 'item' as const,
                data: {
                  symbol: 'LOADING_XEL',
                  a_hash: '',
                  b_hash: '',
                  price_change_24h_pct: 0,
                  volume_24h: 0,
                  isAsset: false
                }
              }
            ]

            const section = displaySections[index % displaySections.length]

            if (section.type === 'header') {
              return (
                <div className="inline-flex items-center h-full px-6">
                  <span className="text-forge-orange font-semibold text-base tracking-wider">
                    {section.label}
                  </span>
                </div>
              )
            }

            if (section.type === 'divider') {
              return (
                <div className="inline-flex items-center h-full px-2">
                  <div className="w-px h-8 bg-forge-orange/30"></div>
                </div>
              )
            }

            const item = section.data
            const [base, quote] = item.symbol?.split('_') || ['?', '?']
            const priceChange = item.price_change_24h_pct || 0
            const isPositive = priceChange >= 0
            const volume = item.volume_24h || item.total_volume || 0
            const isAsset = item.isAsset

            // Look up asset metadata from PoolContext for proper icon color generation
            const baseAsset = poolAssetsMeta.get(item.a_hash)
            const quoteAsset = item.b_hash ? poolAssetsMeta.get(item.b_hash) : null
            const baseTicker = baseAsset?.ticker || base
            const quoteTicker = quoteAsset?.ticker || quote
            const baseName = baseAsset?.name || base
            const quoteName = quoteAsset?.name || quote

            return (
              <div
                className="
                  inline-flex items-center h-full
                  pl-6 pr-4 gap-4
                  rounded-md
                  hover:bg-forge-orange/6 transition-colors cursor-pointer
                  relative
                  before:content-['']
                  before:absolute
                  before:left-0
                  before:top-1/2
                  before:-translate-y-1/2
                  before:h-4
                  before:w-px
                  before:bg-forge-orange/30
                "
              >
                {/* Icon(s) */}
                {isAsset ? (
                  <div
                    className="relative flex items-center flex-shrink-0"
                    style={{ width: 36, height: 36 }}
                  >
                    <TokenIcon
                      tokenSymbol={baseTicker}
                      tokenHash={item.a_hash}
                      tokenName={baseName}
                      size={36}
                    />
                  </div>
                ) : (
                  <div
                    className="relative flex items-center flex-shrink-0"
                    style={{ width: 60, height: 36 }}
                  >
                    <div className="absolute left-[24px] z-0">
                      <TokenIcon
                        tokenSymbol={quoteTicker}
                        tokenHash={item.b_hash}
                        tokenName={quoteName}
                        size={36}
                      />
                    </div>
                    <div className="absolute left-0 z-10">
                      <TokenIcon
                        tokenSymbol={baseTicker}
                        tokenHash={item.a_hash}
                        tokenName={baseName}
                        size={36}
                      />
                    </div>
                  </div>
                )}

                {/* Symbol */}
                <div className="flex items-center flex-shrink-0">
                  <span className="text-white font-medium text-base whitespace-nowrap">
                    {isAsset ? baseTicker : `${baseTicker} - ${quoteTicker}`}
                  </span>
                </div>

                {/* Price Change */}
                <div
                  className={`flex items-center min-w-[70px] flex-shrink-0 justify-end ${isPositive ? 'text-green-400' : 'text-red-400'
                    }`}
                >
                  <span className="font-semibold text-sm whitespace-nowrap">
                    {isPositive ? '+' : ''}
                    {priceChange.toFixed(2)}%
                  </span>
                </div>

                {/* Current Price (assets only) */}
                {isAsset && item.current_price !== undefined && (
                  <div className="flex items-center min-w-[80px] flex-shrink-0 justify-end text-white text-sm">
                    <span className="font-medium whitespace-nowrap">
                      ${item.current_price >= 1000
                        ? item.current_price.toFixed(0)
                        : item.current_price >= 1
                          ? item.current_price.toFixed(2)
                          : item.current_price >= 0.01
                            ? item.current_price.toFixed(4)
                            : item.current_price.toFixed(6)}
                    </span>
                  </div>
                )}

                {/* Volume */}
                <div className="flex items-center min-w-[100px] flex-shrink-0 justify-end text-gray-300 text-[13px]">
                  <span className="whitespace-nowrap">
                    <span className="opacity-60">24h Vol:</span>{' '}
                    <span className="font-medium">
                      {volume >= 1_000_000
                        ? `$${(volume / 1_000_000).toFixed(2)}M`
                        : volume >= 1_000
                          ? `$${(volume / 1_000).toFixed(1)}K`
                          : `$${volume.toFixed(4)}`}
                    </span>
                  </span>
                </div>
              </div>
            )
          }}
        </ScrollTicker>
      </div>
    </div>
  )
}

export default SimpleTradingView