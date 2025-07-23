import { useState, useEffect, createContext, useRef } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { NATIVE_ASSET_HASH, useNode } from '@/contexts/NodeContext'
import { usePools } from '@/contexts/PoolContext';
import { useTransactionContext, type TransactionStatus } from '@/contexts/TransactionContext'

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
import * as router from '@/contracts/router/contract';

import * as daemonTypes from '@xelis/sdk/daemon/types'
import * as walletTypes from '@xelis/sdk/wallet/types'

import Decimal from 'decimal.js'
import { useAssets } from '@/contexts/AssetContext';
import { usePrices } from '@/contexts/PriceContext';

// Screen state management
const SCREENS = {
  LIST: 'list',
  SELECT_TOKENS: 'select_tokens',
  ADD_LIQUIDITY: 'add_liquidity',
  CONFIRM: 'confirm',
  SUCCESS: 'success',
  ERROR: 'error'
}

const Pools = () => {
  const { 
    isConnected, 
    connectWallet, 
    connecting, 
    address, 
    xelBalance ,
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
  // Screen state
  const [currentScreen, setCurrentScreen] = useState(SCREENS.LIST)
  const [autoFillEnabled, setAutoFillEnabled] = useState(true);
  const currentScreenRef = useRef(currentScreen)

  useEffect(() => {
    currentScreenRef.current = currentScreen
  }, [currentScreen])
  // Asset state
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

  // Get router contract address from custom network config
  const getrouterContract = () => {
    if (currentNetwork === 'custom' && currentNode) {
      const networkConfig = Array.from(customNetworks.values())
        .find(network => network.name === currentNode.name)
      
      return networkConfig?.contractAddresses?.router
    }
    return undefined
  }

  const routerContract = getrouterContract()
  const availableAssets = Object.values(assets)

  // Mount ping
  const [refresh, setRefresh] = useState(false)
  useEffect(() => {
    if (refresh) {
      refreshPools();
      if (isConnected) {
        refreshAssets();
      }
    }
  }, [isConnected, routerContract, refresh]);
  
  // Liquidity state
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

  // Navigate between screens
  const goToScreen = (screen: string) => {
    setCurrentScreen(screen)
    if (error) setError('')
  }

  // Start add liquidity flow
  const handleAddLiquidity = () => {
    if (!isConnected) {
      connectWallet()
      return
    }
    goToScreen(SCREENS.SELECT_TOKENS)
  }

  // Handle token selection
  const handleSelectTokens = (token1Hash: string, token2Hash: string) => {
    const token1 = assets[token1Hash]
    const token2 = assets[token2Hash]
    
    if (!token1 || !token2) {
      setError('Selected tokens not found')
      return
    }
    
    setTokenSelection({
      token1Hash,
      token2Hash,
      token1Amount: '',
      token2Amount: '',
      token1Symbol: token1.symbol, // Changed from ticker to symbol
      token2Symbol: token2.symbol, // Changed from ticker to symbol
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
        updatedSelection.token2Amount = (value * price1 / price2).toFixed(tokenSelection.token1Decimals)
      } else if (tokenField === 'token2Amount') {
        updatedSelection.token1Amount = (value * price2 / price1).toFixed(tokenSelection.token2Decimals)
      }
    }

    setTokenSelection(updatedSelection)
  }

  // Format amount with proper decimals
  const formatAmountForContract = (amount: string, decimals: number) => {
    return parseFloat(amount) * Math.pow(10, decimals)
  }

  // Submit liquidity addition
  const submitAddLiquidity = async () => {
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

      const txData = router.entries.createAddLiquidityTransaction({
        routerContract,
        token1Hash: tokenSelection.token1Hash,
        token2Hash: tokenSelection.token2Hash,
        token1Amount,
        token2Amount
      })

      const txBuilder: any = await buildTransaction(txData)

      console.log("Add LP TX", txBuilder)

      awaitContractInvocation(txBuilder.hash, routerContract, async (status, hash) => {
        console.log(`Tx ${hash} completed with status: ${status}`)
        setTxHash(hash)
        setRefresh(!refresh)

        if (status === 'executed') {
          if (currentScreenRef.current == SCREENS.CONFIRM) {
            goToScreen(SCREENS.SUCCESS)            
          }
        } else {
          setError(`Transaction ${status}`)
          if (currentScreenRef.current == SCREENS.CONFIRM) {
            goToScreen(SCREENS.ERROR)            
          }
        }

        setIsSubmitting(false)
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

      setError(`Failed to add liquidity: ${err.message || err}` + cacheErrorMessage)
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
            pools={activePools}
            loading={loadingPools}
            error={poolsError || undefined}
            routerContract={routerContract}
            isConnected={isConnected}
            connecting={connecting}
          />
        )

      case SCREENS.SELECT_TOKENS:
        return (
          <SelectTokensScreen
            goBack={() => goToScreen(SCREENS.LIST)}
            onContinue={(token1, token2) => handleSelectTokens(token1, token2)}
            tokenSelection={tokenSelection}
            setTokenSelection={(partial) => setTokenSelection(prev => ({ ...prev, ...partial }))}
            loadingAssets={loadingAssets}
            availableAssets={availableAssets}
            assets={assets}
          />
        )

      case SCREENS.ADD_LIQUIDITY:
        return (
          <AddLiquidityScreen
            goBack={() => goToScreen(SCREENS.SELECT_TOKENS)}
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
            title="Liquidity Added!"
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
            title="Failed to Add Liquidity"
            error={error}
            onPrimary={() => goToScreen(SCREENS.ADD_LIQUIDITY)}
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
    <div className="flex justify-center items-center min-h-[75vh]">
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
          gradientBurn={0.1}
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