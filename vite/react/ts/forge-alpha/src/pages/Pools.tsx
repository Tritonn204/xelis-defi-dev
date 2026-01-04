import { useState, useEffect, createContext, useRef } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { NATIVE_ASSET_HASH, useNode } from '@/contexts/NodeContext'
import { usePools } from '@/contexts/PoolContext';
import { useTransactionContext, type TransactionStatus } from '@/contexts/TransactionContext'
import { showErrorToast, showSubmitToast } from '@/utils/toast'

import PoolListScreen from '@/components/pools/PoolListScreen';
import SelectTokensScreen from '@/components/pools/SelectTokensScreen'
import AddLiquidityScreen from '@/components/pools/AddLiquidityScreen'
import ConfirmScreen from '@/components/pools/ConfirmLiquidityScreen'
import ResultScreen from '@/components/pools/Result'

import { Settings } from 'lucide-react'
import Button from '@/components/ui/Button'
import GeometricAccents from '@/components/ui/GeometricAccents'
import LiquidityInput from '@/components/pools/LiquidityInput'
import { PoolList } from '@/components/pools/PoolList'
import PoolStats from '@/components/pools/PoolStats'
import { ArrowLeft } from 'lucide-react'

// Contract interfaces
// import * as router from '@/contracts/router/contract';
import { useForge } from '@/contexts/ForgeContext'; 

import { useAssets } from '@/contexts/AssetContext';
import { usePrices } from '@/contexts/PriceContext';
import RemoveLiquidityScreen from '@/components/pools/RemoveLiquidityScreen';

// Screen state management
const SCREENS = {
  LIST: 'list',
  SELECT_TOKENS_ADD: 'select_tokens_add',
  SELECT_TOKENS_REMOVE: 'select_tokens_remove',
  ADD_LIQUIDITY: 'add_liquidity',
  CONFIRM: 'confirm',
  SUCCESS: 'success',
  ERROR: 'error'
}

const Pools = () => {
  const {
    isConnected,
    openConnectModal,
    connecting,
    address,
    xelBalance,
    buildTransaction,
    submitTransaction,
    clearTxCache,
    getBalance,
    getRawBalance,
    getAssets,
  } = useWallet()
  const { 
    currentNetwork, 
    currentNode, 
    customNetworks,
    getContractData,
    getContractAssets,
    getAsset,
    getAssetSupply,
  } = useNode()
  const { 
    awaitContractInvocation
  } = useTransactionContext()
  const {
    assetPrices
  } = usePrices()
  const {
    router
  } = useForge()

  const {
    activePools,
    loadingPools,
    poolsError,
    refreshPools,
  } = usePools();

  const {
    assets,
    loading: loadingAssets,
    error: assetError,
    refreshAssets
  } = useAssets()

  // Get router contract address from current node (works for all networks)
  const routerContract = currentNode?.contractAddresses?.router
  const availableAssets = assets

  // All state declarations
  const [currentScreen, setCurrentScreen] = useState(SCREENS.LIST)
  const [currentFlow, setCurrentFlow] = useState<'add' | 'remove'>('add')
  const [autoFillEnabled, setAutoFillEnabled] = useState(true);
  const [refresh, setRefresh] = useState(false)
  const [tokenSelection, setTokenSelection] = useState({
    token1Hash: '',
    token2Hash: '',
    token1Amount: '',
    token2Amount: '',
    token1Symbol: 'XEL',
    token2Symbol: '',
    token1Decimals: 8,
    token2Decimals: 8
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')

  // Refs
  const currentScreenRef = useRef(currentScreen)
  const currentFlowRef = useRef(currentFlow)

  // Effects
  useEffect(() => {
    currentScreenRef.current = currentScreen
  }, [currentScreen])

  useEffect(() => {
    currentFlowRef.current = currentFlow
  }, [currentFlow])

  // Handle wallet disconnects - free up buttons
  useEffect(() => {
    if (!isConnected && isSubmitting) {
      setIsSubmitting(false)
      showErrorToast('Wallet disconnected', { duration: 4000 })
    }
  }, [isConnected, isSubmitting])

  useEffect(() => {
    if (refresh) {
      refreshPools();
      if (isConnected) {
        refreshAssets();
      }
    }
  }, [isConnected, routerContract, refresh])

  // Navigate between screens
  const goToScreen = (screen: string) => {
    setCurrentScreen(screen)
    if (error) setError('')
  }

  // Start add liquidity flow
  const handleAddLiquidity = () => {
    if (!isConnected) {
      openConnectModal()
      return
    }
    setCurrentFlow('add')
    goToScreen(SCREENS.SELECT_TOKENS_ADD)
  }

  // Start remove liquidity flow
  const handleRemoveLiquidity = () => {
    if (!isConnected) {
      openConnectModal()
      return
    }
    setCurrentFlow('remove')
    goToScreen(SCREENS.SELECT_TOKENS_REMOVE)
  }

  // Handle token selection
  const handleSelectTokens = (token1Hash: string, token2Hash: string) => {
    const token1 = assets[token1Hash]
    const token2 = assets[token2Hash]

    console.log(assets)
    console.log(token1Hash, token2Hash)
    console.log(token1, token2)

    if (!token1 || !token2) {
      console.error('Selected tokens not found')
      return
    }
    
    setTokenSelection({
      token1Hash,
      token2Hash,
      token1Amount: '',
      token2Amount: '',
      token1Symbol: token1.ticker,
      token2Symbol: token2.ticker,
      token1Decimals: token1.decimals,
      token2Decimals: token2.decimals
    })
    
    goToScreen(SCREENS.ADD_LIQUIDITY)
  }

  // Handle amount changes
  const handleAmountChange = (tokenField: string, value: number) => {
    const updatedSelection = { ...tokenSelection, [tokenField]: value }

    const price1 = assetPrices.get(tokenSelection.token1Hash) || 0
    const price2 = assetPrices.get(tokenSelection.token2Hash) || 0

    // Autofill logic (only if toggle is enabled and prices are valid)
    if (autoFillEnabled && price1 > 0 && price2 > 0) {
      if (tokenField === 'token1Amount') {
        updatedSelection.token2Amount = (value * price1 / price2).toFixed(tokenSelection.token2Decimals)
      } else if (tokenField === 'token2Amount') {
        updatedSelection.token1Amount = (value * price2 / price1).toFixed(tokenSelection.token1Decimals)
      }
    }

    setTokenSelection(updatedSelection)
  }

  // Format amount with proper decimals
  const formatAmountForContract = (amount: string, decimals: number) => {
    return parseFloat(amount) * Math.pow(10, decimals)
  }

  // Submit liquidity addition
  const submitAddLiquidity = async (isNewPair: boolean = false) => {
    setIsSubmitting(true)
    setError('')

    try {
      if (!routerContract || !tokenSelection.token1Hash || !tokenSelection.token2Hash) {
        throw new Error('Missing router address or token selection')
      }

      console.log(tokenSelection)

      const token1Amount = formatAmountForContract(
        tokenSelection.token1Amount,
        tokenSelection.token1Decimals
      )

      const token2Amount = formatAmountForContract(
        tokenSelection.token2Amount,
        tokenSelection.token2Decimals
      )

      // Build deposits object
      const deposits: Record<string, number> = {
        [tokenSelection.token1Hash]: token1Amount,
        [tokenSelection.token2Hash]: token2Amount,
      }

      // Add 1 XEL protocol fee for new pair creation
      if (isNewPair) {
        const NEW_PAIR_FEE = 1e8 // 1 XEL in atomic units
        if (deposits[NATIVE_ASSET_HASH]) {
          deposits[NATIVE_ASSET_HASH] += NEW_PAIR_FEE
        } else {
          deposits[NATIVE_ASSET_HASH] = NEW_PAIR_FEE
        }
      }

      const txData = router?.invokeUnsafe('add_liquidity', {
        contract: routerContract,
        token0_hash: tokenSelection.token1Hash,
        token1_hash: tokenSelection.token2Hash,
        deposits,
        permission: "all",
      })!

      console.log("XSWD Request Base", txData);

      const txBuilder: any = await buildTransaction(txData)

      console.log("Add LP TX", txBuilder)

      awaitContractInvocation(txBuilder.hash, routerContract, {
        successMessage: 'Liquidity added successfully!',
        callback: async (status, hash) => {
          console.log(`Tx ${hash} completed with status: ${status}`)
          setTxHash(hash)
          setRefresh(!refresh)

          if (status === 'executed') {
            if (currentScreenRef.current == SCREENS.CONFIRM) {
              goToScreen(SCREENS.SUCCESS)
            }
          } else {
            const errorMsg = status === 'reverted' ? 'Transaction reverted' : `Transaction ${status}`
            setError(errorMsg)
            if (currentScreenRef.current == SCREENS.CONFIRM) {
              goToScreen(SCREENS.ERROR)
            }
          }
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

      setError(`Failed to add liquidity: ${err.message || err}` + cacheErrorMessage)
      setIsSubmitting(false)
      goToScreen(SCREENS.ERROR)
    }
  }

  // Submit liquidity removal
  const submitRemoveLiquidity = async (lp: string, amount: number) => {
    setIsSubmitting(true)
    setError('')

    try {
      if (!routerContract) {
        throw new Error('Missing router address or token selection')
      }

      console.log(tokenSelection)

      const txData = router?.invokeUnsafe('remove_liquidity', {
        contract: routerContract,
        liquidity_token_hash: lp,
        deposits: {
          [lp]: amount
        },
        permission: "all",
      })!

      const txBuilder: any = await buildTransaction(txData)

      console.log("Remove LP TX", txBuilder)

      awaitContractInvocation(txBuilder.hash, routerContract, {
        successMessage: 'Liquidity removed successfully!',
        callback: async (status, hash) => {
          console.log(`Tx ${hash} completed with status: ${status}`)
          setTxHash(hash)
          setRefresh(!refresh)
          let screenCheck
          if (currentFlowRef.current == 'add') screenCheck = SCREENS.CONFIRM
          else if (currentFlowRef.current == 'remove') screenCheck = SCREENS.SELECT_TOKENS_REMOVE

          if (status === 'executed') {
            if (currentScreenRef.current == screenCheck) {
              goToScreen(SCREENS.SUCCESS)
            }
          } else {
            const errorMsg = status === 'reverted' ? 'Transaction reverted' : `Transaction ${status}`
            setError(errorMsg)
            if (currentScreenRef.current == screenCheck) {
              goToScreen(SCREENS.ERROR)
            }
          }
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

      setError(`Failed to remove liquidity: ${err.message || err}` + cacheErrorMessage)
      setIsSubmitting(false)
      goToScreen(SCREENS.ERROR)
    }
  }

  // Get formatted balance for a token
  const getFormattedBalance = (tokenHash: string) => {
    if (!tokenHash || !assets[tokenHash]) return '0.0'
    
    const asset = assets[tokenHash]
    const balance = parseFloat(asset.balance)
    
    return balance.toFixed(asset.decimals === 0 ? 0 : 2)
  }

  // Render the appropriate screen content
  const renderScreenContent = () => {
    switch (currentScreen) {
      case SCREENS.LIST:
        return (
          <PoolListScreen
            onAddLiquidity={handleAddLiquidity}
            onRemoveLiquidity={handleRemoveLiquidity}
            pools={activePools}
            loading={loadingPools}
            error={poolsError || undefined}
            routerContract={routerContract}
            isConnected={isConnected}
            connecting={connecting}
          />
        )

      case SCREENS.SELECT_TOKENS_ADD:
        return (
          <SelectTokensScreen
            goBack={() => goToScreen(SCREENS.LIST)}
            onContinue={(token1, token2) => {console.log("parent click"); handleSelectTokens(token1, token2)}}
            tokenSelection={tokenSelection}
            setTokenSelection={(partial) => setTokenSelection(prev => ({ ...prev, ...partial }))}
            loadingAssets={loadingAssets || loadingPools}
            availableAssets={availableAssets}
            assets={assets}
          />
        )

      case SCREENS.SELECT_TOKENS_REMOVE:
        return (
          <RemoveLiquidityScreen
            goBack={() => goToScreen(SCREENS.LIST)}
            pools={activePools}
            loading={loadingPools}
            isSubmitting={isSubmitting}
            error={error}
            onWithdraw={(_, pool, amount) => {
              submitRemoveLiquidity(pool.lpAsset, amount)
            }}
          />
        )

      case SCREENS.ADD_LIQUIDITY:
        return (
          <AddLiquidityScreen
            goBack={() => goToScreen(SCREENS.SELECT_TOKENS_ADD)}
            goNext={() => goToScreen(SCREENS.CONFIRM)}
            tokenSelection={tokenSelection}
            handleAmountChange={handleAmountChange}
            autoFillEnabled={autoFillEnabled}
            setAutoFillEnabled={setAutoFillEnabled}
            assetPrices={assetPrices}
          />
        )

      case SCREENS.CONFIRM:
        return (
          <ConfirmScreen
            goBack={() => goToScreen(SCREENS.ADD_LIQUIDITY)}
            onSubmit={submitAddLiquidity}
            tokenSelection={tokenSelection}
            assetPrices={assetPrices}
            activePools={activePools}
            isSubmitting={isSubmitting}
            routerContract={routerContract}
          />
        )

      case SCREENS.SUCCESS:
        return (
          <ResultScreen
            type="success"
            title={currentFlowRef.current === 'add' ? "Liquidity Added!" : "Liquidity Withdrawn."}
            message="Your transaction was successful."
            txHash={txHash}
            onPrimary={() => goToScreen(SCREENS.LIST)}
            primaryLabel="Back to Pools"
          />
        )

      case SCREENS.ERROR:
        return (
          <ResultScreen
            type="error"
            title={currentFlowRef.current === 'add' ? 'Failed to Add Liquidity' : 'Failed to Remove Liquidity'}
            error={error}
            onPrimary={() =>
              goToScreen(currentFlowRef.current === 'add' ? SCREENS.ADD_LIQUIDITY : SCREENS.SELECT_TOKENS_REMOVE)
            }
            primaryLabel="Try Again"
            onSecondary={() => goToScreen(SCREENS.LIST)}
            secondaryLabel="Back to Pools"
          />
        )

      default:
        return null
    }
  }

  return (
    <div className="flex justify-center items-center min-h-[75vh] -mt-[40px]">
      <div className="background-transparent rounded-2xl p-5 w-full max-w-md">
        <GeometricAccents
          accentWidth={19}
          tipExtension={60}
          tipAngle={50}
          variant="white"
          gap={7}
          className="w-full max-w-md mt-5"
          alpha={0.7}
          glassEffect={true}
          gradient={true}
          blendMode='soft-light'
          isLoading={isSubmitting}
        >
          {renderScreenContent()}
        </GeometricAccents>
      </div>
    </div>
  )
}

export default Pools