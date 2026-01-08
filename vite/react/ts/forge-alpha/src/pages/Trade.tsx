import { useAssets } from '@/contexts/AssetContext'
import { useWallet } from '@/contexts/WalletContext'
import { usePools, canonicalPoolKey } from '@/contexts/PoolContext'
import { useTransactionContext } from '@/contexts/TransactionContext'
import { useState, useEffect, useMemo, useRef, lazy, Suspense, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { v1 } from '@/utils/swapCalculations'
import { usePrices } from '@/contexts/PriceContext'
import { useForge } from '@/contexts/ForgeContext'
import { showSubmitToast } from '@/utils/toast'

// Eager load lightweight components
import { SimpleTradingView } from '@/components/trade/views/Simple'
import TrackAssetBeforeSwapModal from '@/components/modal/TrackAssetBeforeSwapModal'

// ✅ LAZY LOAD HEAVY COMPONENTS
const ProTradingView = lazy(() => import('@/components/trade/views/Pro'))
const TokenSelectModal = lazy(() => import('@/components/modal/TokenSelectModal'))

import type { TradingViewProps } from '@/types/trade'

const Trade = () => {
  // ============ ALL EXISTING HOOKS AND LOGIC (unchanged) ============
  const { 
    assets, 
    selectedAssets, 
    swapAmounts, 
    swapAssets, 
    setAmount,
    selectAsset,
    execSlippage,
    slippage,
    setSlippage,
    setExecSlippage,
    priceImpact,
    setPriceImpact,
    loading,
    setLoading,
    refreshAssets,
    setError: setAssetError
  } = useAssets()
  
  const {
    isConnected,
    openConnectModal,
    connecting,
    buildTransaction,
    submitTransaction,
    clearTxCache,
    ownedAssets,
    trackAsset
  } = useWallet()

  const { activePools, routerContract, refreshPools, poolAssets } = usePools()
  const { awaitContractInvocation } = useTransactionContext()
  const { assetPrices } = usePrices()
  const { router, isProMode, setProMode } = useForge()

  // URL sync
  const [searchParams, setSearchParams] = useSearchParams()

  // State declarations
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalPosition, setModalPosition] = useState<'from' | 'to'>('from')
  const [lastEditedField, setLastEditedField] = useState<'from' | 'to'>('from')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

  // Track asset modal state
  const [showTrackAssetModal, setShowTrackAssetModal] = useState(false)
  const [assetToTrack, setAssetToTrack] = useState<{ hash: string; symbol: string; name?: string } | null>(null)
  const pendingSwapRef = useRef(false)

  // Track current screen state for transaction callbacks
  const isSwappingRef = useRef(false)
  const isInitialized = useRef(false)

  const fromToken = poolAssets.get(selectedAssets.from)
  const toToken = poolAssets.get(selectedAssets.to)

  // Handle wallet disconnects - free up buttons
  useEffect(() => {
    if (!isConnected && isSubmitting) {
      setIsSubmitting(false)
      isSwappingRef.current = false
    }
  }, [isConnected, isSubmitting])

  // Initialize from URL params on mount (once pools are loaded)
  useEffect(() => {
    if (isInitialized.current || activePools.size === 0) return

    const mode = searchParams.get('mode')
    const fromHash = searchParams.get('from')
    const toHash = searchParams.get('to')

    // Set mode if specified
    if (mode === 'pro' || mode === 'lite') {
      setProMode(mode === 'pro')
    }

    // Set tokens if specified and valid
    if (fromHash && poolAssets.has(fromHash)) {
      selectAsset('from', fromHash)
    }
    if (toHash && poolAssets.has(toHash)) {
      selectAsset('to', toHash)
    }

    isInitialized.current = true
  }, [searchParams, activePools, poolAssets, selectAsset, setProMode])

  // Sync URL with state (after initialization)
  useEffect(() => {
    if (!isInitialized.current) return

    const params = new URLSearchParams()

    // Add mode
    params.set('mode', isProMode ? 'pro' : 'lite')

    // Add tokens if selected
    if (selectedAssets.from) {
      params.set('from', selectedAssets.from)
    }
    if (selectedAssets.to) {
      params.set('to', selectedAssets.to)
    }

    // Replace URL without adding to history
    setSearchParams(params, { replace: true })
  }, [isProMode, selectedAssets.from, selectedAssets.to, setSearchParams])

  // ============ ALL EXISTING LOGIC (unchanged) ============
  
  // Check if the selected pair has a valid pool
  const hasValidPool = useMemo(() => {
    if (!selectedAssets.from || !selectedAssets.to) return false
    const poolKey = canonicalPoolKey(selectedAssets.from, selectedAssets.to)
    return activePools.has(poolKey)
  }, [selectedAssets, activePools])

  // Get pool reserves for the selected pair
  const poolReserves = useMemo(() => {
    if (!hasValidPool || !selectedAssets.from || !selectedAssets.to) return null

    const poolKey = canonicalPoolKey(selectedAssets.from, selectedAssets.to)
    const pool = activePools.get(poolKey)

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

  useEffect(() => {
    // existing useEffect logic...
  }, [assetPrices])

  // Calculate swap amounts when input changes
  useEffect(() => {
    if (!poolReserves || !hasValidPool) {
      if (lastEditedField === 'from' && swapAmounts.to !== '') {
        setAmount('to', '')
      } else if (lastEditedField === 'to' && swapAmounts.from !== '') {
        setAmount('from', '')
      }
      setPriceImpact(0)
      setExecSlippage(0)
      return
    }

    const fromDecimals = fromToken?.decimals || 8
    const toDecimals = toToken?.decimals || 8

    if (lastEditedField === 'from' && swapAmounts.from) {
      const fromAmount = parseFloat(swapAmounts.from)
      const amountInRaw = fromAmount * Math.pow(10, fromDecimals)
      const reserveInRaw = poolReserves.fromReserve * Math.pow(10, fromDecimals)
      const reserveOutRaw = poolReserves.toReserve * Math.pow(10, toDecimals)
      
      const { amountOut, priceImpact, executionSlippage } = v1.calculateSwapOutput(
        amountInRaw,
        reserveInRaw,
        reserveOutRaw,
        slippage
      )
      
      const amountOutDecimal = amountOut / Math.pow(10, toDecimals)
      setAmount('to', amountOutDecimal > 0 ? amountOutDecimal.toFixed(toDecimals) : '')
      setExecSlippage(executionSlippage)
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
      const { priceImpact, executionSlippage } = v1.calculateSwapOutput(
        amountInRaw,
        reserveInRaw,
        reserveOutRaw,
        slippage,
      )
      setExecSlippage(executionSlippage)
      setPriceImpact(priceImpact)
    }
  }, [swapAmounts.from, swapAmounts.to, poolReserves, slippage, lastEditedField, fromToken, toToken])

  // ============ EVENT HANDLERS ============
  
  const handleTokenSelect = useCallback((position: 'from' | 'to') => {
    setModalPosition(position)
    setIsModalOpen(true)
  }, [])

  const handleTokenSelected = useCallback((tokenHash: string) => {
    selectAsset(modalPosition, tokenHash)
    setIsModalOpen(false)
  }, [modalPosition, selectAsset])

  const handleAmountChange = useCallback((position: 'from' | 'to', value: string) => {
    setAmount(position, value)
    setLastEditedField(position)
  }, [setAmount])

  // Check if an asset is tracked
  const isAssetTracked = (assetHash: string) => {
    return ownedAssets?.has(assetHash) ?? false
  }

  // Perform the actual swap
  const performSwap = async () => {
    if (!isConnected) {
      openConnectModal()
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
    pendingSwapRef.current = false

    try {
      console.log('Swap details:', {
        tokenIn: selectedAssets.from,
        tokenOut: selectedAssets.to,
        amountIn: swapCalculation.amountIn,
        amountOutMin: swapCalculation.amountOutMin,
        slippage: slippage
      })

      const txData = router?.invokeUnsafe('swap', {
        token_in_hash: selectedAssets.from,
        token_out_hash: selectedAssets.to,
        amount_out_min: swapCalculation.amountOutMin,
        deposits: {
          [selectedAssets.from]: swapCalculation.amountIn
        },
        permission: "all",
      })!

      const txBuilder = await buildTransaction(txData)
      console.log("Swap TX", txBuilder)

      awaitContractInvocation(txBuilder.hash, routerContract, {
        successMessage: 'Swap successful!',
        callback: async (status, hash) => {
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
            const errorMsg = status === 'reverted' ? 'Transaction reverted' : `Transaction ${status}`
            setError(errorMsg)
          }

          isSwappingRef.current = false
        }
      })

      await submitTransaction(txBuilder)

      // Free up the button immediately after submission
      setIsSubmitting(false)
      showSubmitToast()
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

  // Handle track asset modal confirmation
  const handleTrackAsset = async () => {
    if (!assetToTrack) return

    setShowTrackAssetModal(false)

    try {
      await trackAsset({ asset: assetToTrack.hash })
    } catch (err) {
      console.error('Failed to track asset:', err)
    }

    // Proceed with swap if it was pending
    if (pendingSwapRef.current) {
      performSwap()
    }
  }

  // Handle skipping track asset
  const handleSkipTrackAsset = () => {
    setShowTrackAssetModal(false)
    setAssetToTrack(null)

    // Proceed with swap if it was pending
    if (pendingSwapRef.current) {
      performSwap()
    }
  }

  // Main swap handler - checks for untracked 'to' asset first
  const handleSwap = async () => {
    if (!isConnected) {
      openConnectModal()
      return
    }

    // Check if 'to' asset is not tracked (from asset must be owned to swap)
    const toTracked = isAssetTracked(selectedAssets.to)

    if (!toTracked) {
      // Ask to track 'to' asset
      setAssetToTrack({
        hash: selectedAssets.to,
        symbol: toToken?.ticker || 'Unknown',
        name: toToken?.name
      })
      setShowTrackAssetModal(true)
      pendingSwapRef.current = true
      return
    }

    // Asset is tracked, proceed with swap
    performSwap()
  }

  const isSwapDisabled = !hasValidPool ||
    !swapAmounts.from ||
    parseFloat(swapAmounts.from) <= 0 ||
    parseFloat(swapAmounts.from) > parseFloat(assets[fromToken?.hash || '']?.balance || '0') ||
    isSubmitting

  // ============ BUNDLE PROPS FOR CHILD COMPONENTS ============
  
  const tradingViewProps: TradingViewProps = {
    // Assets & Pool data
    assets,
    selectedAssets,
    swapAmounts,
    execSlippage,
    slippage,
    priceImpact,
    loading,
    error,
    activePools,
    poolAssets,
    hasValidPool,
    poolReserves,
    
    // Asset actions
    selectAsset,
    swapAssets,
    setAmount,
    setSlippage,
    setExecSlippage,
    setPriceImpact,
    setLoading,
    setError,
    refreshAssets,
    refreshPools,
    
    // Wallet
    isConnected,
    connecting,
    openConnectModal,

    // Swap logic
    swapCalculation,
    isSwapDisabled,
    
    // UI state
    isSubmitting,
    showSuccess,
    txHash,
    isProMode,

    // Modal state & handlers
    isModalOpen,
    setIsModalOpen,
    modalPosition,
    handleTokenSelect,
    handleTokenSelected,
    handleAmountChange,
    handleSwap,
  }

  // ============ RENDER ============
  
  return (
    <>
      {/* Main Content */}
      {isProMode ? (
        <div className="fixed left-0 right-0 bottom-[1rem] top-20">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading Pro Mode...</p>
              </div>
            </div>
          }>
            <ProTradingView {...tradingViewProps} />
          </Suspense>
        </div>
      ) : (
        <SimpleTradingView {...tradingViewProps} />
      )}

      {/* Token Selection Modal - only render when open */}
      {isModalOpen && (
        <Suspense fallback={
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
            </div>
          </div>
        }>
          <TokenSelectModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSelect={handleTokenSelected}
            currentToken={modalPosition === 'from' ? selectedAssets.from : selectedAssets.to}
            otherToken={modalPosition === 'from' ? selectedAssets.to : selectedAssets.from}
            position={modalPosition}
          />
        </Suspense>
      )}

      {/* Track Asset Before Swap Modal */}
      <TrackAssetBeforeSwapModal
        isOpen={showTrackAssetModal}
        onTrack={handleTrackAsset}
        onSkip={handleSkipTrackAsset}
        assetSymbol={assetToTrack?.symbol || ''}
        assetName={assetToTrack?.name}
      />
    </>
  )
}

export default Trade