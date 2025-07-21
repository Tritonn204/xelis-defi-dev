import { useState, useEffect, createContext, useRef } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { NATIVE_ASSET_HASH, useNode } from '@/contexts/NodeContext'
import { usePools } from '@/contexts/PoolContext';
import { useTransactionContext, type TransactionStatus } from '@/contexts/TransactionContext'

import { Settings } from 'lucide-react'
import Button from '@/components/ui/Button'
import GeometricAccents from '@/components/ui/GeometricAccents'
import LiquidityInput from '@/components/pools/LiquidityInput'
import { PoolList, type PoolData } from '@/components/pools/PoolList'
import PoolStats from '@/components/pools/PoolStats'
import { ArrowLeft } from 'lucide-react'

// Contract interfaces
import * as router from '@/contracts/router/contract';

import * as daemonTypes from '@xelis/sdk/daemon/types'
import * as walletTypes from '@xelis/sdk/wallet/types'

import Decimal from 'decimal.js'
import { useAssets } from '@/contexts/AssetContext';

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
  
  // Screen state
  const [currentScreen, setCurrentScreen] = useState(SCREENS.LIST)
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
    setTokenSelection({
      ...tokenSelection,
      [tokenField]: value
    })
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
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-semibold text-white">Liquidity Pools</h2>
              <button className="text-gray-400 hover:text-white">
                <Settings className="w-5 h-5" />
              </button>
            </div>
            
            <Button
              onClick={handleAddLiquidity}
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
              "
              disabled={!routerContract && isConnected}
              isLoading={connecting}
              staticSize={true}
            >
              {isConnected ? 'Add Liquidity' : 'Connect Wallet'}
            </Button>
            
            {!routerContract && isConnected && (
              <div className="mt-2 text-red-500 text-sm text-center">
                Router contract not found for this network
              </div>
            )}
            
            {poolsError && (
              <div className="mt-2 text-red-500 text-sm text-center">
                {poolsError}
              </div>
            )}
            
            <div className="mt-2">
              {loadingPools ? (
                <div className="text-center py-6">
                  <div className="animate-spin h-8 w-8 border-4 border-forge-orange border-t-transparent rounded-full mx-auto mb-4"></div>
                  <div className="text-white">Loading pools...</div>
                </div>
              ) : (
                <PoolList pools={activePools} />
              )}
            </div>
          </>
        )
            
      case SCREENS.SELECT_TOKENS:
        return (
          <>
            <div className="flex items-center mb-4">
              <button 
                className="text-gray-400 hover:text-white mr-2"
                onClick={() => goToScreen(SCREENS.LIST)}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-xl font-semibold text-white">Select Tokens</h2>
            </div>
            
            <div className="text-gray-300 mb-4">
              Select two tokens to add liquidity
            </div>
            
            {loadingAssets ? (
              <div className="text-center py-6">
                <div className="animate-spin h-8 w-8 border-4 border-forge-orange border-t-transparent rounded-full mx-auto mb-4"></div>
                <div className="text-white">Loading assets...</div>
              </div>
            ) : (
              <>
                {/* Token selection component */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="bg-black/70 rounded-xl p-3 border border-white/12">
                    <div className="text-white font-medium mb-2">Token 1</div>
                    <select 
                      className="w-full bg-black/80 text-white p-2 rounded-lg border border-white/20"
                      onChange={(e) => setTokenSelection({
                        ...tokenSelection,
                        token1Hash: e.target.value,
                        token1Symbol: assets[e.target.value]?.symbol || 'Unknown'
                      })}
                      value={tokenSelection.token1Hash || ''}
                    >
                      <option value="">Select Token</option>
                      {availableAssets.map(asset => (
                        <option key={asset.hash} value={asset.hash}>
                          {asset.symbol} - {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="bg-black/70 rounded-xl p-3 border border-white/12">
                    <div className="text-white font-medium mb-2">Token 2</div>
                    <select 
                      className="w-full bg-black/80 text-white p-2 rounded-lg border border-white/20"
                      onChange={(e) => setTokenSelection({
                        ...tokenSelection,
                        token2Hash: e.target.value,
                        token2Symbol: assets[e.target.value]?.symbol || 'Unknown'
                      })}
                      value={tokenSelection.token2Hash || ''}
                    >
                      <option value="">Select Token</option>
                      {availableAssets.map(asset => (
                        <option key={asset.hash} value={asset.hash}>
                          {asset.symbol} - {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                
                <Button
                  onClick={() => handleSelectTokens(
                    tokenSelection.token1Hash,
                    tokenSelection.token2Hash
                  )}
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
                  "
                  disabled={!tokenSelection.token1Hash || !tokenSelection.token2Hash}
                >
                  Continue
                </Button>
              </>
            )}
          </>
        )
      
      case SCREENS.ADD_LIQUIDITY:
        return (
          <>
            <div className="flex items-center mb-4">
              <button 
                className="text-gray-400 hover:text-white mr-2"
                onClick={() => goToScreen(SCREENS.SELECT_TOKENS)}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-xl font-semibold text-white">Add Liquidity</h2>
            </div>
            
            <div className="text-gray-300 mb-4">
              Enter the amount of tokens you want to deposit
            </div>
            
            <div className="relative">
              {/* First token input */}
              <div className="-mb-6">
                <LiquidityInput 
                  label={`${tokenSelection.token1Symbol} Amount`}
                  balance={getFormattedBalance(tokenSelection.token1Hash)}
                  amount={tokenSelection.token1Amount}
                  onChange={(value: number) => handleAmountChange('token1Amount', value)}
                  tokenSymbol={tokenSelection.token1Symbol}
                  tokenName={availableAssets.find(a => a.hash === tokenSelection.token1Hash)?.name || ''}
                />
              </div>
              
              {/* Plus sign between inputs */}
              <div className="flex justify-center items-center">
                <div className="text-white text-4xl">+</div>
              </div>
              
              {/* Second token input */}
              <div className="-mt-4">
                <LiquidityInput 
                  label={`${tokenSelection.token2Symbol} Amount`}
                  balance={getFormattedBalance(tokenSelection.token2Hash)}
                  amount={tokenSelection.token2Amount}
                  onChange={(value: number) => handleAmountChange('token2Amount', value)}
                  tokenSymbol={tokenSelection.token2Symbol}
                  tokenName={assets[tokenSelection.token2Hash]?.name || ''}
                />
              </div>
            </div>
            
            <div className="mt-2">
              <Button
                onClick={() => goToScreen(SCREENS.CONFIRM)}
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
                "
                disabled={!tokenSelection.token1Amount || !tokenSelection.token2Amount}
              >
                Review
              </Button>
            </div>
          </>
        )
      
      case SCREENS.CONFIRM:
        const poolKey1 = `${tokenSelection.token1Hash}_${tokenSelection.token2Hash}`
        const poolKey2 = `${tokenSelection.token2Hash}_${tokenSelection.token1Hash}`
        const pool = activePools.get(poolKey1) || activePools.get(poolKey2)

        let estimatedLpTokens: string

        if (pool) {
          const totalLP = new Decimal(pool.totalLpSupply.toString())
          const ratio1 = new Decimal(tokenSelection.token1Amount).div(pool.locked[0] || 1)
          const ratio2 = new Decimal(tokenSelection.token2Amount).div(pool.locked[1] || 1)
          const shareRatio = Decimal.min(ratio1, ratio2)

          estimatedLpTokens = totalLP.mul(shareRatio).div(1e8).toFixed(8)
        } else {
          const amount1 = new Decimal(tokenSelection.token1Amount)
          const amount2 = new Decimal(tokenSelection.token2Amount)
          estimatedLpTokens = amount1.mul(amount2).sqrt().toFixed(8)
        }

        return (
          <>
            <div className="flex items-center mb-4">
              <button 
                className="text-gray-400 hover:text-white mr-2"
                onClick={() => goToScreen(SCREENS.ADD_LIQUIDITY)}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-xl font-semibold text-white">Confirm</h2>
            </div>
            
            <div className="bg-black/70 rounded-xl p-4 border border-white/12 mb-4">
              <h3 className="text-lg font-medium text-white mb-3">You are adding</h3>
              
              <div className="flex justify-between items-center mb-2">
                <div className="text-gray-300">
                  {tokenSelection.token1Amount} {tokenSelection.token1Symbol}
                </div>
                <div className="text-white font-medium">
                  ${(parseFloat(tokenSelection.token1Amount || '0') * 1.0).toFixed(2)}
                </div>
              </div>
              
              <div className="flex justify-between items-center mb-4">
                <div className="text-gray-300">
                  {tokenSelection.token2Amount} {tokenSelection.token2Symbol}
                </div>
                <div className="text-white font-medium">
                  ${(parseFloat(tokenSelection.token2Amount || '0') * 0.5).toFixed(2)}
                </div>
              </div>
              
              <div className="border-t border-white/10 pt-3">
                <div className="flex justify-between items-center">
                  <div className="text-gray-300">Estimated LP tokens</div>
                  <div className="text-white font-medium">
                    {estimatedLpTokens.toString()} LP
                  </div>
                </div>
                
                <div className="flex justify-between items-center mt-2">
                  <div className="text-gray-300">Router contract</div>
                  <div className="text-white font-medium text-xs truncate max-w-[200px]">
                    {routerContract}
                  </div>
                </div>
              </div>
            </div>
            
            <Button
              onClick={submitAddLiquidity}
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
              "
              isLoading={isSubmitting}
              staticSize={true}
            >
              Confirm
            </Button>
          </>
        )
      
      case SCREENS.SUCCESS:
        return (
          <div className="text-center py-6">
            <div className="text-green-400 text-3xl mb-4">✓</div>
            <h2 className="text-xl font-semibold text-white mb-3">Liquidity Added!</h2>
            
            {txHash && (
              <div className="text-gray-400 mb-4 break-all">
                {txHash}
              </div>
            )}
            
            <Button
              onClick={() => goToScreen(SCREENS.LIST)}
              focusOnClick={false}
              className="
                w-full 
                bg-forge-orange 
                hover:bg-forge-orange/90 
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
              "
            >
              Back to Pools
            </Button>
          </div>
        )
      
      case SCREENS.ERROR:
        return (
          <div className="text-center py-6">
            <div className="text-red-500 text-3xl mb-4">✗</div>
            <h2 className="text-xl font-semibold text-white mb-3">Failed to Add Liquidity</h2>
            
            {error && (
              <div className="text-red-400 mb-4">
                {error}
              </div>
            )}
            
            <div className="flex flex-col space-y-3">
              <Button
                onClick={() => goToScreen(SCREENS.ADD_LIQUIDITY)}
                focusOnClick={false}
                className="
                  w-full 
                  bg-forge-orange 
                  hover:bg-forge-orange/90 
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
                "
              >
                Try Again
              </Button>
              
              <Button
                onClick={() => goToScreen(SCREENS.LIST)}
                focusOnClick={false}
                className="
                  w-full 
                  bg-transparent
                  border border-white/20
                  hover:bg-white/10
                  text-white 
                  font-light
                  text-[1.5rem]
                  py-1 px-4 
                  rounded-xl 
                  transition-all duration-200
                "
              >
                Back to Pools
              </Button>
            </div>
          </div>
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
          className="w-full max-w-md"
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