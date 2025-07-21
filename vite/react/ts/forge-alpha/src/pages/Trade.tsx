import { useAssets } from '@/contexts/AssetContext'
import { useWallet } from '@/contexts/WalletContext'
import { usePools } from '@/contexts/PoolContext'
import { useTransactionContext } from '@/contexts/TransactionContext'
import { useState, useEffect, useMemo, useRef } from 'react'
import TokenInput from '@/components/trade/TokenInput'
import TokenStats from '@/components/trade/TokenStats'
import SwapButton from '@/components/trade/SwapButton'
import SlippageSettings from '@/components/trade/SlippageSettings'
import Button from '@/components/ui/Button'
import GeometricAccents from '@/components/ui/GeometricAccents'
import TokenSelectModal from '@/components/modal/TokenSelectModal'
import { v1 } from '@/utils/swapCalculations'
import * as router from '@/contracts/router/contract'

const Trade = () => {
  const { 
    assets, 
    selectedAssets, 
    swapAmounts, 
    swapAssets, 
    setAmount,
    selectAsset,
    slippage,
    setSlippage,
    priceImpact,
    setPriceImpact,
    loading,
    setLoading,
    refreshAssets,
    setError: setAssetError
  } = useAssets()
  const { 
    isConnected, 
    connectWallet, 
    connecting,
    buildTransaction,
    submitTransaction,
    clearTxCache
  } = useWallet()
  const { activePools, routerContract, refreshPools, poolAssets } = usePools()
  const { awaitContractInvocation } = useTransactionContext()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalPosition, setModalPosition] = useState<'from' | 'to'>('from')
  const [lastEditedField, setLastEditedField] = useState<'from' | 'to'>('from')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

  const fromToken = poolAssets.get(selectedAssets.from)
  const toToken = poolAssets.get(selectedAssets.to)

  // Track current screen state for transaction callbacks
  const isSwappingRef = useRef(false)

  // Check if the selected pair has a valid pool
  const hasValidPool = useMemo(() => {
    if (!selectedAssets.from || !selectedAssets.to) return false
    const poolKey1 = `${selectedAssets.from}_${selectedAssets.to}`
    const poolKey2 = `${selectedAssets.to}_${selectedAssets.from}`

    return activePools.get(poolKey1) || activePools.get(poolKey2)
  }, [selectedAssets, activePools])

  // Get pool reserves for the selected pair
  const poolReserves = useMemo(() => {
    if (!hasValidPool) return null
    
    const pool = Array.from(activePools.values()).find(pool => 
      pool.hashes.includes(selectedAssets.from) && 
      pool.hashes.includes(selectedAssets.to)
    )
    
    if (!pool) return null
    
    const fromIndex = pool.hashes.indexOf(selectedAssets.from)
    const toIndex = pool.hashes.indexOf(selectedAssets.to)
    
    return {
      fromReserve: parseFloat(pool.locked[fromIndex]),
      toReserve: parseFloat(pool.locked[toIndex])
    }
  }, [hasValidPool, selectedAssets, activePools])

  // Calculate swap output details
  const swapCalculation = useMemo(() => {
    if (!poolReserves || !swapAmounts.from || parseFloat(swapAmounts.from) <= 0) {
      return null
    }

    const fromAmount = parseFloat(swapAmounts.from)
    const fromDecimals = fromToken?.decimals || 8
    const toDecimals = toToken?.decimals || 8
    
    // Convert to raw amounts (with decimals)
    const amountInRaw = Math.floor(fromAmount * Math.pow(10, fromDecimals))
    const reserveInRaw = Math.floor(poolReserves.fromReserve * Math.pow(10, fromDecimals))
    const reserveOutRaw = Math.floor(poolReserves.toReserve * Math.pow(10, toDecimals))
    
    const { amountOut, amountOutMin, priceImpact } = v1.calculateSwapOutput(
      amountInRaw,
      reserveInRaw,
      reserveOutRaw,
      slippage
    )

    return {
      amountIn: amountInRaw,
      amountOut: Math.floor(amountOut),
      amountOutMin: Math.floor(amountOutMin),
      priceImpact
    }
  }, [swapAmounts.from, poolReserves, slippage, fromToken, toToken])

  // Calculate swap amounts when input changes
  useEffect(() => {
    if (!poolReserves || !hasValidPool) {
      if (lastEditedField === 'from' && swapAmounts.to !== '') {
        setAmount('to', '')
      } else if (lastEditedField === 'to' && swapAmounts.from !== '') {
        setAmount('from', '')
      }
      setPriceImpact(0)
      return
    }

    const fromDecimals = fromToken?.decimals || 8
    const toDecimals = toToken?.decimals || 8

    if (lastEditedField === 'from' && swapAmounts.from) {
      const fromAmount = parseFloat(swapAmounts.from)
      const amountInRaw = fromAmount * Math.pow(10, fromDecimals)
      const reserveInRaw = poolReserves.fromReserve * Math.pow(10, fromDecimals)
      const reserveOutRaw = poolReserves.toReserve * Math.pow(10, toDecimals)
      
      const { amountOut, priceImpact } = v1.calculateSwapOutput(
        amountInRaw,
        reserveInRaw,
        reserveOutRaw,
        slippage
      )
      
      const amountOutDecimal = amountOut / Math.pow(10, toDecimals)
      setAmount('to', amountOutDecimal > 0 ? amountOutDecimal.toFixed(toDecimals) : '')
      setPriceImpact(priceImpact)
    } else if (lastEditedField === 'to' && swapAmounts.to) {
      const toAmount = parseFloat(swapAmounts.to)
      const amountOutRaw = toAmount * Math.pow(10, toDecimals)
      const reserveInRaw = poolReserves.fromReserve * Math.pow(10, fromDecimals)
      const reserveOutRaw = poolReserves.toReserve * Math.pow(10, toDecimals)
      
      const amountInRaw = v1.calculateSwapInput(
        amountOutRaw,
        reserveInRaw,
        reserveOutRaw
      )
      
      const amountInDecimal = amountInRaw / Math.pow(10, fromDecimals)
      setAmount('from', amountInDecimal > 0 ? amountInDecimal.toFixed(fromDecimals) : '')
      
      // Calculate price impact for this direction
      const { priceImpact } = v1.calculateSwapOutput(
        amountInRaw,
        reserveInRaw,
        reserveOutRaw,
        slippage
      )
      setPriceImpact(priceImpact)
    }
  }, [swapAmounts.from, swapAmounts.to, poolReserves, slippage, lastEditedField, fromToken, toToken])

  const handleTokenSelect = (position: 'from' | 'to') => {
    setModalPosition(position)
    setIsModalOpen(true)
  }

  const handleTokenSelected = (tokenHash: string) => {
    selectAsset(modalPosition, tokenHash)
    setIsModalOpen(false)
  }

  const handleAmountChange = (position: 'from' | 'to', value: string) => {
    setAmount(position, value)
    setLastEditedField(position)
  }

  const handleSwap = async () => {
    if (!isConnected) {
      connectWallet()
      return
    }

    if (!routerContract || !swapCalculation) {
      setError('Missing router contract or swap details')
      return
    }

    setIsSubmitting(true)
    setError('')
    setShowSuccess(false)
    isSwappingRef.current = true

    try {
      console.log('Swap details:', {
        tokenIn: selectedAssets.from,
        tokenOut: selectedAssets.to,
        amountIn: swapCalculation.amountIn,
        amountOutMin: swapCalculation.amountOutMin,
        slippage: slippage
      })

      const txData = router.entries.createSwapTransaction({
        contract: routerContract,
        tokenInHash: selectedAssets.from,
        tokenOutHash: selectedAssets.to,
        amountIn: swapCalculation.amountIn,
        amountOutMin: swapCalculation.amountOutMin
      })

      const txBuilder = await buildTransaction(txData)
      console.log("Swap TX", txBuilder)

      awaitContractInvocation(txBuilder.hash, routerContract, async (status, hash) => {
        console.log(`Swap tx ${hash} completed with status: ${status}`)
        setTxHash(hash)

        if (status === 'executed') {
          if (isSwappingRef.current) {
            setShowSuccess(true)
            setAmount('to', '')
            setAmount('from', '')
            refreshPools()
            setTimeout(() => {
              refreshAssets()
            }, 500)
          }
        } else {
          setError(`Transaction ${status}`)
        }

        setIsSubmitting(false)
        isSwappingRef.current = false
      })

      await submitTransaction(txBuilder)
    } catch (err: any) {
      let cacheErrorMessage = ''

      try {
        await clearTxCache()
      } catch (cacheErr: any) {
        cacheErrorMessage = `, (also failed to clear tx cache: ${cacheErr.message || 'unknown error'})`
        console.error('Failed to clear TX cache:', cacheErr)
      }

      setError(`Failed to swap: ${err.message || err}` + cacheErrorMessage)
      setIsSubmitting(false)
      isSwappingRef.current = false
    }
  }

  const isSwapDisabled = !hasValidPool || 
    !swapAmounts.from || 
    parseFloat(swapAmounts.from) <= 0 ||
    parseFloat(swapAmounts.from) > parseFloat(assets[fromToken?.hash || '']?.balance || '0') ||
    isSubmitting

  return (
    <>
      <div className="flex justify-center items-center min-h-[75vh]">
        <div className="background-transparent rounded-2xl p-5 w-full max-w-md">
          <GeometricAccents
            accentWidth={19}
            tipExtension={60}
            tipAngle={50}
            variant="white"
            gap={7}
            className="w-full max-w-md"
            alpha={0.7}
            glassEffect={true}
            gradient={true}
            gradientBurn={0.1}
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
                  balance={fromToken?.balance}
                  amount={swapAmounts.from}
                  onChange={(value: string) => handleAmountChange('from', value)}
                  tokenSymbol={fromToken?.symbol || 'Select'}
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
                  balance={toToken?.balance}
                  amount={swapAmounts.to}
                  onChange={(value: string) => handleAmountChange('to', value)}
                  tokenSymbol={toToken?.symbol || 'Select'}
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
                    swapAssets(); 
                    handleAmountChange('from', newFrom)
                  }}
                  loading={loading}
                  disabled={!hasValidPool || isSubmitting}
                />
              </div>
            </div>

            {/* Price impact warning */}
            {
              hasValidPool && (<div className={`text-xs px-3 py-1 rounded-md mt-2 ${
                priceImpact > 5 ? 'bg-red-500/20 text-red-400' : 
                  priceImpact > 0.005 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-black/60 text-white/50'
                }`}>
                Price Impact: {priceImpact.toFixed(2)}%
              </div>)
            }

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
                      ? `${(swapCalculation.amountOutMin / Math.pow(10, toToken?.decimals || 8)).toFixed(4)} ${toToken?.symbol}`
                      : `0.00 ${toToken?.symbol}`}
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
                disabled={isSwapDisabled}
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
                 parseFloat(swapAmounts.from) > parseFloat(fromToken?.balance || '0') ? 'Insufficient Balance' :
                 'Swap'}
              </Button>
            ) : (
              <Button
                onClick={connectWallet}
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
                symbol={fromToken?.symbol || "—"}
                tokenHash={fromToken?.hash}
                tokenName={fromToken?.name}
                price="1.790"
                priceChange="10.13"
                color="bg-orange-500"
              />
              <TokenStats 
                symbol={toToken?.symbol || "—"}
                tokenHash={toToken?.hash}
                tokenName={toToken?.name}
                price="1.790"
                priceChange="0.1"
                color="bg-green-500"
              />
            </div>
          </GeometricAccents>
        </div>
      </div>

      {/* Token Selection Modal */}
      <TokenSelectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelect={handleTokenSelected}
        currentToken={modalPosition === 'from' ? selectedAssets.from : selectedAssets.to}
        otherToken={modalPosition === 'from' ? selectedAssets.to : selectedAssets.from}
        position={modalPosition}
      />
    </>
  )
}

export default Trade