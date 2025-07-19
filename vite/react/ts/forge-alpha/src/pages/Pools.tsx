import { useState, useEffect } from 'react'
import { useWallet } from '../contexts/WalletContext'
import { useNode } from '../contexts/NodeContext'
import { Settings } from 'lucide-react'
import Button from '../components/ui/Button'
import GeometricAccents from '../components/ui/GeometricAccents'
import LiquidityInput from '../components/pools/LiquidityInput'
import PoolList from '../components/pools/PoolList'
import PoolStats from '../components/pools/PoolStats'
import { ArrowLeft } from 'lucide-react'
import { createAddLiquidityTransaction } from '../utils/contractHelpers'

// Screen state management
const SCREENS = {
  LIST: 'list',
  SELECT_TOKENS: 'select_tokens',
  ADD_LIQUIDITY: 'add_liquidity',
  CONFIRM: 'confirm',
  SUCCESS: 'success',
  ERROR: 'error'
}

// Native XEL asset hash
const NATIVE_ASSET_HASH = '0000000000000000000000000000000000000000000000000000000000000000'

const Pools = () => {
  const { 
    isConnected, 
    connectWallet, 
    connecting, 
    address, 
    xelBalance ,
    buildAndSubmitTransaction,
    getBalance,
    getAssets
  } = useWallet()
  const { 
    currentNetwork, 
    currentNode, 
    customNetworks,
    getContractData,
    getContractAssets
  } = useNode()
  
  // Screen state
  const [currentScreen, setCurrentScreen] = useState(SCREENS.LIST)
  
  // Asset state
  const [availableAssets, setAvailableAssets] = useState([])
  const [assetBalances, setAssetBalances] = useState({})
  const [loadingAssets, setLoadingAssets] = useState(false)
  
  // Liquidity state
  const [tokenSelection, setTokenSelection] = useState({
    token1Hash: null,
    token2Hash: null,
    token1Amount: '',
    token2Amount: '',
    token1Symbol: 'XEL',
    token2Symbol: '',
    token1Decimals: 8,
    token2Decimals: 8
  })
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [txHash, setTxHash] = useState(null)

  // Get router contract address from custom network config
  const getRouterAddress = () => {
    if (currentNetwork === 'custom' && currentNode) {
      const networkConfig = Array.from(customNetworks.values())
        .find(network => network.name === currentNode.name)
      
      return networkConfig?.contractAddresses?.router
    }
    return undefined
  }

  const routerAddress = getRouterAddress()

  // Load assets when wallet is connected
  useEffect(() => {
    if (isConnected && address) {
      loadWalletAssets()
    }
  }, [isConnected, address])

  useEffect(() => {
    if (routerAddress) {
      loadLPList()
    }
  }, [routerAddress])

  // Load assets from wallet
  const loadWalletAssets = async () => {
    setLoadingAssets(true)
    try {
      // In a real implementation, you'd use the XSWD instance to get this data
      // For this example, we're assuming we have the asset data from the console.log you shared
      
      // This would be the actual implementation:
      // const assetData = await xswdRef.current.wallet.getAssets()
      
      // Using the sample data you provided
      const assetData = await getAssets()
      
      // Transform the asset data for easier use
      const assets = assetData.map(([hash, data]) => ({
        hash,
        name: data.name,
        ticker: data.ticker,
        decimals: data.decimals
      }))
      
      setAvailableAssets(assets)
      
      // Get balances for each asset
      const balances = {}
      for (const asset of assets) {
        if (asset.hash === NATIVE_ASSET_HASH) {
          // For XEL, use the xelBalance from the wallet context
          // Convert from raw to decimal format
          const rawBalance = parseFloat(xelBalance?.split(' ')[0] || '0')
          balances[asset.hash] = rawBalance
        } else {
          // For other assets, we would need to get their balances
          // In a real implementation, you'd use:
          const result = await getBalance(asset.hash)
          const rawBalance = parseFloat(result?.split(' ')[0] || '0')
          balances[asset.hash] = rawBalance
        }
      }
      
      setAssetBalances(balances)
    } catch (error) {
      console.error('Error loading assets:', error)
      setError('Failed to load assets from wallet')
    } finally {
      setLoadingAssets(false)
    }
  }

  const loadLPList = async () => {
    if (routerAddress) {
      const assetList = await getContractAssets(routerAddress)
      console.log(assetList)

      assetList.forEach(async (id) => {
        if (id != NATIVE_ASSET_HASH) {
          const data = await getContractData({
            contract: routerAddress,
            key: {type: "default", value: {
              type: "opaque", 
              value: { 
                type: "Hash", 
                value: id
              }
            }}
          })

          if (data?.data.type == "object" && data?.data.value.length == 2) {
            console.log(`Found LP`, data)
          }
        }
      })
    }
  }

  // Navigate between screens
  const goToScreen = (screen: string) => {
    setCurrentScreen(screen)
    if (error) setError(null)
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
  const handleSelectTokens = (token1Hash, token2Hash) => {
    // Find the selected tokens in our available assets
    const token1 = availableAssets.find(asset => asset.hash === token1Hash)
    const token2 = availableAssets.find(asset => asset.hash === token2Hash)
    
    if (!token1 || !token2) {
      setError('Selected tokens not found')
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
  const handleAmountChange = (tokenField, value) => {
    setTokenSelection({
      ...tokenSelection,
      [tokenField]: value
    })
  }

  // Format amount with proper decimals
  const formatAmountForContract = (amount, decimals) => {
    return parseFloat(amount) * Math.pow(10, decimals)
  }

  // Submit liquidity addition
  const submitAddLiquidity = async () => {
    setIsSubmitting(true)
    setError(null)
    
    try {
      if (!routerAddress || !tokenSelection.token1Hash || !tokenSelection.token2Hash) {
        throw new Error('Missing router address or token selection')
      }
      
      // Format amounts for the contract
      const token1Amount = formatAmountForContract(
        tokenSelection.token1Amount, 
        tokenSelection.token1Decimals
      )
      
      const token2Amount = formatAmountForContract(
        tokenSelection.token2Amount,
        tokenSelection.token2Decimals
      )
      
      // Create transaction data
      const txData = createAddLiquidityTransaction({
        routerAddress,
        token1Hash: tokenSelection.token1Hash,
        token2Hash: tokenSelection.token2Hash,
        token1Amount,
        token2Amount
      })
      
      console.log('Transaction data:', txData)
      
      // Submit the transaction using the wallet
      const result = await buildAndSubmitTransaction(txData)
      
      if (result.success) {
        setTxHash(result.hash)
        goToScreen(SCREENS.SUCCESS)
      } else {
        throw new Error('Transaction submission failed')
      }
    } catch (err) {
      setError(err.message || 'Failed to add liquidity')
      goToScreen(SCREENS.ERROR)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Get formatted balance for a token
  const getFormattedBalance = (tokenHash: string) => {
    if (!tokenHash || !assetBalances[tokenHash]) return '0.0'
    
    const asset = availableAssets.find(a => a.hash === tokenHash)
    if (!asset) return '0.0'
    
    return assetBalances[tokenHash].toFixed(asset.decimals === 0 ? 0 : 2)
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
              disabled={!routerAddress && isConnected}
              isLoading={connecting}
              staticSize={true}
            >
              {isConnected ? 'Add Liquidity' : 'Connect Wallet'}
            </Button>
            
            {!routerAddress && isConnected && (
              <div className="mt-2 text-red-500 text-sm text-center">
                Router contract not found for this network
              </div>
            )}
            
            <div className="mt-6">
              <PoolList />
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
                <div className="grid grid-cols-2 gap-2 mb-6">
                  <div className="bg-black/70 rounded-xl p-3 border border-white/12">
                    <div className="text-white font-medium mb-2">Token 1</div>
                    <select 
                      className="w-full bg-black/80 text-white p-2 rounded-lg border border-white/20"
                      onChange={(e) => setTokenSelection({
                        ...tokenSelection,
                        token1Hash: e.target.value,
                        token1Symbol: availableAssets.find(a => a.hash === e.target.value)?.ticker || 'Unknown'
                      })}
                      value={tokenSelection.token1Hash || ''}
                    >
                      <option value="">Select Token</option>
                      {availableAssets.map(asset => (
                        <option key={asset.hash} value={asset.hash}>
                          {asset.ticker} - {asset.name}
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
                        token2Symbol: availableAssets.find(a => a.hash === e.target.value)?.ticker || 'Unknown'
                      })}
                      value={tokenSelection.token2Hash || ''}
                    >
                      <option value="">Select Token</option>
                      {availableAssets
                        .filter(asset => asset.hash !== tokenSelection.token1Hash)
                        .map(asset => (
                          <option key={asset.hash} value={asset.hash}>
                            {asset.ticker} - {asset.name}
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
              <div className="mb-3">
                <LiquidityInput 
                  label={`${tokenSelection.token1Symbol} Amount`}
                  balance={getFormattedBalance(tokenSelection.token1Hash)}
                  amount={tokenSelection.token1Amount}
                  onChange={(value) => handleAmountChange('token1Amount', value)}
                  tokenSymbol={tokenSelection.token1Symbol}
                  tokenName={availableAssets.find(a => a.hash === tokenSelection.token1Hash)?.name || ''}
                  price={1.0} // This would come from your price feed
                />
              </div>
              
              {/* Plus sign between inputs */}
              <div className="flex justify-center items-center my-2">
                <div className="text-white text-2xl">+</div>
              </div>
              
              {/* Second token input */}
              <div className="mt-3">
                <LiquidityInput 
                  label={`${tokenSelection.token2Symbol} Amount`}
                  balance={getFormattedBalance(tokenSelection.token2Hash)}
                  amount={tokenSelection.token2Amount}
                  onChange={(value) => handleAmountChange('token2Amount', value)}
                  tokenSymbol={tokenSelection.token2Symbol}
                  tokenName={availableAssets.find(a => a.hash === tokenSelection.token2Hash)?.name || ''}
                  price={0.5} // This would come from your price feed
                />
              </div>
            </div>
            
            <div className="mt-6">
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
                    {Math.sqrt(
                      parseFloat(tokenSelection.token1Amount || '0') * 
                      parseFloat(tokenSelection.token2Amount || '0')
                    ).toFixed(4)} LP
                  </div>
                </div>
                
                <div className="flex justify-between items-center mt-2">
                  <div className="text-gray-300">Router contract</div>
                  <div className="text-white font-medium text-xs truncate max-w-[200px]">
                    {routerAddress}
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
                Transaction: {txHash}
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
            <h2 className="text-xl font-semibold text-white mb-3">Transaction Failed</h2>
            
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
        >
          {renderScreenContent()}
        </GeometricAccents>
      </div>
    </div>
  )
}

export default Pools