import { useState, useEffect, useRef } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { useNode } from '@/contexts/NodeContext'
import { useTransactionContext } from '@/contexts/TransactionContext'

import { Hammer, Upload, Coins, Settings } from 'lucide-react'
import Button from '@/components/ui/Button'
import GeometricAccents from '@/components/ui/GeometricAccents'

import * as daemonTypes from '@xelis/sdk/daemon/types'

// Contract interfaces
import * as factory from '@/contracts/factory/contract';

// Panel management
const PANELS = {
  CREATE_TOKEN: 'create_token',
  DEPLOY_CONTRACT: 'deploy_contract', 
  MINT_TOKENS: 'mint_tokens'
}

const SCREENS = {
  FORM: 'form',
  CONFIRM: 'confirm',
  SUCCESS: 'success',
  ERROR: 'error'
}

const Tools = () => {
  const { 
    isConnected, 
    connectWallet, 
    connecting, 
    address,
    buildTransaction,
    submitTransaction,
    clearTxCache,
    getAssets,
  } = useWallet()
  
  const { 
    currentNetwork, 
    currentNode, 
    customNetworks,
  } = useNode()
  
  const { 
    awaitContractInvocation
  } = useTransactionContext()
  
  // Panel and screen state
  const [activePanel, setActivePanel] = useState(PANELS.CREATE_TOKEN)
  const [currentScreen, setCurrentScreen] = useState(SCREENS.FORM)
  const currentScreenRef = useRef(currentScreen)

  useEffect(() => {
    currentScreenRef.current = currentScreen
  }, [currentScreen])

  // Form states
  const [createTokenForm, setCreateTokenForm] = useState({
    name: '',
    ticker: '',
    decimals: 8,
    supply: '',
    mintable: false,
    maxSupply: ''
  })

  const [deployForm, setDeployForm] = useState({
    bytecode: '',
    hasConstructor: false
  })

  const [mintForm, setMintForm] = useState({
    assetHash: '',
    mintAmount: ''
  })

  // Transaction state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [availableAssets, setAvailableAssets] = useState<Record<string, any>[]>([])

  // Get Factory contract address from custom network config
  const getFactoryContract = () => {
    if (currentNetwork === 'custom' && currentNode) {
      const networkConfig = Array.from(customNetworks.values())
        .find(network => network.name === currentNode.name)
      
      return networkConfig?.contractAddresses?.factory
    }
    return undefined
  }

  const factoryAddress = getFactoryContract()

  // Load assets when wallet is connected (for mint form)
  useEffect(() => {
    if (isConnected && address && activePanel === PANELS.MINT_TOKENS) {
      loadWalletAssets()
    }
  }, [isConnected, address, activePanel])

  const loadWalletAssets = async () => {
    try {
      const assetData = (await getAssets()) as Record<string, any>
      const assets = assetData.map(([hash, data]) => ({
        hash,
        name: data.name,
        ticker: data.ticker,
        decimals: data.decimals
      }))
      setAvailableAssets(assets)
    } catch (error) {
      console.error('Error loading assets:', error)
    }
  }

  // Navigation helpers
  const goToScreen = (screen: string) => {
    setCurrentScreen(screen)
    if (error) setError('')
  }

  const switchPanel = (panel: string) => {
    setActivePanel(panel)
    setCurrentScreen(SCREENS.FORM)
    setError('')
    setTxHash('')
  }

  // Form handlers
  const handleCreateTokenChange = (field: string, value: any) => {
    setCreateTokenForm({
      ...createTokenForm,
      [field]: value
    })
  }

  const handleDeployChange = (field: string, value: any) => {
    setDeployForm({
      ...deployForm,
      [field]: value
    })
  }

  const handleMintChange = (field: string, value: any) => {
    setMintForm({
      ...mintForm,
      [field]: value
    })
  }

  // Transaction handlers
  const handleTransactionResult = (status: string, hash: string) => {
    console.log(`Tx ${hash} completed with status: ${status}`)
    setTxHash(hash)

    if (status === 'executed') {
      if (currentScreenRef.current === SCREENS.CONFIRM) {
        goToScreen(SCREENS.SUCCESS)
      }
    } else {
      setError(`Transaction ${status}`)
      if (currentScreenRef.current === SCREENS.CONFIRM) {
        goToScreen(SCREENS.ERROR)
      }
    }
    setIsSubmitting(false)
  }

  const handleTransactionError = async (err: any) => {
    let cacheErrorMessage = ''

    try {
      await clearTxCache()
    } catch (cacheErr: any) {
      cacheErrorMessage = `, (also failed to clear tx cache: ${cacheErr.message || 'unknown error'})`
      console.error('Failed to clear TX cache:', cacheErr)
    }

    setError(`Transaction failed: ${err.message || err}` + cacheErrorMessage)
    setIsSubmitting(false)
    goToScreen(SCREENS.ERROR)
  }

  // Submit functions
  const submitCreateToken = async () => {
    setIsSubmitting(true)
    setError('')

    try {
      if (!factoryAddress) {
        throw new Error('Factory contract address not found')
      }

      const txData = factory.entries.createTokenTransaction({
        contract: factoryAddress,
        name: createTokenForm.name,
        ticker: createTokenForm.ticker,
        decimals: createTokenForm.decimals,
        supply: parseFloat(createTokenForm.supply),
        mintable: createTokenForm.mintable,
        maxSupply: parseFloat(createTokenForm.maxSupply || createTokenForm.supply)
      })

      const txBuilder = await buildTransaction(txData)
      console.log("Create Token TX", txBuilder)

      awaitContractInvocation(txBuilder.hash, factoryAddress, handleTransactionResult)
      await submitTransaction(txBuilder)

    } catch (err: any) {
      handleTransactionError(err)
    }
  }

  const submitDeployContract = async () => {
    setIsSubmitting(true)
    setError('')

    try {
      const txData = factory.entries.createDeployContractTransaction({
        bytecode: deployForm.bytecode,
        hasConstructor: deployForm.hasConstructor
      })

      const txBuilder = await buildTransaction(txData)
      console.log("Deploy Contract TX", txBuilder)

      // For contract deployment, we don't have a specific contract to monitor
      awaitContractInvocation(txBuilder.hash, '', handleTransactionResult)
      await submitTransaction(txBuilder)

    } catch (err: any) {
      handleTransactionError(err)
    }
  }

  const submitMintTokens = async () => {
    setIsSubmitting(true)
    setError('')

    try {
      if (!factoryAddress) {
        throw new Error('Factory contract address not found')
      }

      const selectedAsset = availableAssets.find(asset => asset.hash === mintForm.assetHash)
      if (!selectedAsset) {
        throw new Error('Selected asset not found')
      }

      const adjustedAmount = parseFloat(mintForm.mintAmount) * Math.pow(10, selectedAsset.decimals)

      const txData = factory.entries.createMintTokensTransaction({
        contract: factoryAddress,
        assetHash: mintForm.assetHash,
        mintAmount: adjustedAmount
      })

      const txBuilder = await buildTransaction(txData)
      console.log("Mint Tokens TX", txBuilder)

      awaitContractInvocation(txBuilder.hash, factoryAddress, handleTransactionResult)
      await submitTransaction(txBuilder)

    } catch (err: any) {
      handleTransactionError(err)
    }
  }

  // Panel icons and labels
  const panels = [
    {
      id: PANELS.CREATE_TOKEN,
      icon: Hammer, // Using Hammer as anvil alternative
      label: 'Create Token',
      description: 'Create new token'
    },
    {
      id: PANELS.DEPLOY_CONTRACT,
      icon: Upload,
      label: 'Deploy Contract',
      description: 'Deploy custom bytecode'
    },
    {
      id: PANELS.MINT_TOKENS,
      icon: Coins,
      label: 'Mint Tokens',
      description: 'Mint existing tokens'
    }
  ]

  // Render form content based on active panel and screen
  const renderFormContent = () => {
    if (currentScreen === SCREENS.CONFIRM) {
      return renderConfirmScreen()
    }

    if (currentScreen === SCREENS.SUCCESS) {
      return renderSuccessScreen()
    }

    if (currentScreen === SCREENS.ERROR) {
      return renderErrorScreen()
    }

    // Form screens
    switch (activePanel) {
      case PANELS.CREATE_TOKEN:
        return (
          <div className="space-y-1 bg-black/55 border-forge-orange/12 border-1 p-2 rounded-lg backdrop-blur-md">
            <div>
              <label className="block text-forge-orange text-sm font-medium mb-2">Token Name</label>
              <input
                type="text"
                value={createTokenForm.name}
                onChange={(e) => handleCreateTokenChange('name', e.target.value)}
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-white/20 focus:border-forge-orange focus:outline-none"
                placeholder="My Token"
              />
            </div>

            <div>
              <label className="block text-forge-orange text-sm font-medium mb-2">Ticker Symbol</label>
              <input
                type="text"
                value={createTokenForm.ticker}
                onChange={(e) => handleCreateTokenChange('ticker', e.target.value.toUpperCase())}
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-white/20 focus:border-forge-orange focus:outline-none"
                placeholder="MTK"
                maxLength={10}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-forge-orange text-sm font-medium mb-2">Decimals</label>
                <input
                  type="number"
                  value={createTokenForm.decimals}
                  onChange={(e) => handleCreateTokenChange('decimals', parseInt(e.target.value))}
                  className="w-full bg-black/80 text-white p-3 rounded-lg border border-white/20 focus:border-forge-orange focus:outline-none"
                  min="0"
                  max="18"
                />
              </div>

              <div>
                <label className="block text-forge-orange text-sm font-medium mb-2">Initial Supply</label>
                <input
                  type="number"
                  value={createTokenForm.supply}
                  onChange={(e) => handleCreateTokenChange('supply', e.target.value)}
                  className="w-full bg-black/80 text-white p-3 rounded-lg border border-white/20 focus:border-forge-orange focus:outline-none"
                  placeholder="1000000"
                  min="0"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center space-x-2 text-white">
                <input
                  type="checkbox"
                  checked={createTokenForm.mintable}
                  onChange={(e) => handleCreateTokenChange('mintable', e.target.checked)}
                  className="rounded border-white/20"
                />
                <span>Mintable (allow creating more tokens later)</span>
              </label>
            </div>

            <div
              className={`
                transition-all duration-300 ease-in-out overflow-hidden 
                ${createTokenForm.mintable ? 'max-h-40 opacity-100 mt-2' : 'max-h-0 opacity-0'}
              `}
            >
              <div>
                <label className="block text-forge-orange text-sm font-medium mb-2">Max Supply</label>
                <input
                  type="number"
                  value={createTokenForm.maxSupply}
                  onChange={(e) => handleCreateTokenChange('maxSupply', e.target.value)}
                  className="w-full bg-black/80 text-white p-3 rounded-lg border border-white/20 focus:border-forge-orange focus:outline-none"
                  placeholder="10000000"
                  min={createTokenForm.supply}
                />
              </div>
            </div>

            <Button
              onClick={() => goToScreen(SCREENS.CONFIRM)}
              disabled={!createTokenForm.name || !createTokenForm.ticker || !createTokenForm.supply || !factoryAddress}
              className="w-full bg-forge-orange hover:bg-forge-orange/90 disabled:bg-gray-600 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98]"
            >
              Create Token
            </Button>

            {!factoryAddress && isConnected && (
              <div className="text-red-500 text-sm text-center">
                Factory contract not found for this network
              </div>
            )}
          </div>
        )

      case PANELS.DEPLOY_CONTRACT:
        return (
          <div className="space-y-2">
            <div>
              <label className="block text-white text-sm font-medium mb-2">Contract Bytecode (Hex)</label>
              <textarea
                value={deployForm.bytecode}
                onChange={(e) => handleDeployChange('bytecode', e.target.value)}
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-white/20 focus:border-forge-orange focus:outline-none h-32 font-mono text-xs"
                placeholder="Enter contract bytecode in hexadecimal format..."
              />
            </div>

            <div>
              <label className="flex items-center space-x-2 text-white">
                <input
                  type="checkbox"
                  checked={deployForm.hasConstructor}
                  onChange={(e) => handleDeployChange('hasConstructor', e.target.checked)}
                  className="rounded border-white/20"
                />
                <span>Contract has constructor</span>
              </label>
            </div>

            <Button
              onClick={() => goToScreen(SCREENS.CONFIRM)}
              disabled={!deployForm.bytecode}
              className="w-full bg-forge-orange hover:bg-forge-orange/90 disabled:bg-gray-600 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98]"
            >
              Deploy Contract
            </Button>
          </div>
        )

      case PANELS.MINT_TOKENS:
        return (
          <div className="space-y-1">
            <div>
              <label className="block text-white text-sm font-medium mb-2">Select Token</label>
              <select
                value={mintForm.assetHash}
                onChange={(e) => handleMintChange('assetHash', e.target.value)}
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-white/20 focus:border-forge-orange focus:outline-none"
              >
                <option value="">Select a token to mint</option>
                {availableAssets.map(asset => (
                  <option key={asset.hash} value={asset.hash}>
                    {asset.ticker} - {asset.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-white text-sm font-medium mb-2">Amount to Mint</label>
              <input
                type="number"
                value={mintForm.mintAmount}
                onChange={(e) => handleMintChange('mintAmount', e.target.value)}
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-white/20 focus:border-forge-orange focus:outline-none"
                placeholder="100"
                min="0"
                step="0.00000001"
              />
            </div>

            <Button
              onClick={() => goToScreen(SCREENS.CONFIRM)}
              disabled={!mintForm.assetHash || !mintForm.mintAmount || !factoryAddress}
              className="w-full bg-forge-orange hover:bg-forge-orange/90 disabled:bg-gray-600 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98]"
            >
              Mint Tokens
            </Button>

            {!factoryAddress && isConnected && (
              <div className="text-red-500 text-sm text-center">
                Factory contract not found for this network
              </div>
            )}
          </div>
        )

      default:
        return null
    }
  }

  const renderConfirmScreen = () => {
    const currentPanel = panels.find(p => p.id === activePanel)
    
    return (
      <div className="space-y-4">
        <div className="text-center mb-4">
          <h3 className="text-lg font-medium text-white">Confirm {currentPanel?.label}</h3>
        </div>

        <div className="bg-black/70 rounded-xl p-4 border border-white/12">
          {activePanel === PANELS.CREATE_TOKEN && (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-300">Name:</span>
                <span className="text-white">{createTokenForm.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Ticker:</span>
                <span className="text-white">{createTokenForm.ticker}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Decimals:</span>
                <span className="text-white">{createTokenForm.decimals}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Supply:</span>
                <span className="text-white">{createTokenForm.supply}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Mintable:</span>
                <span className="text-white">{createTokenForm.mintable ? 'Yes' : 'No'}</span>
              </div>
              {createTokenForm.mintable && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Max Supply:</span>
                  <span className="text-white">{createTokenForm.maxSupply || createTokenForm.supply}</span>
                </div>
              )}
            </div>
          )}

          {activePanel === PANELS.DEPLOY_CONTRACT && (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-300">Bytecode Length:</span>
                <span className="text-white">{deployForm.bytecode.length} chars</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Has Constructor:</span>
                <span className="text-white">{deployForm.hasConstructor ? 'Yes' : 'No'}</span>
              </div>
            </div>
          )}

          {activePanel === PANELS.MINT_TOKENS && (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-300">Token:</span>
                <span className="text-white">
                  {availableAssets.find(a => a.hash === mintForm.assetHash)?.ticker}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Amount:</span>
                <span className="text-white">{mintForm.mintAmount}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex space-x-3">
          <Button
            onClick={() => goToScreen(SCREENS.FORM)}
            className="flex-1 bg-transparent border border-white/20 hover:bg-white/10 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200"
          >
            Back
          </Button>
          
          <Button
            onClick={() => {
              if (activePanel === PANELS.CREATE_TOKEN) submitCreateToken()
              else if (activePanel === PANELS.DEPLOY_CONTRACT) submitDeployContract()
              else if (activePanel === PANELS.MINT_TOKENS) submitMintTokens()
            }}
            isLoading={isSubmitting}
            className="flex-1 bg-forge-orange hover:bg-forge-orange/90 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98]"
            staticSize={true}
          >
            Confirm
          </Button>
        </div>
      </div>
    )
  }

  const renderSuccessScreen = () => (
    <div className="text-center py-6">
      <div className="text-green-400 text-3xl mb-4">✓</div>
      <h2 className="text-xl font-semibold text-white mb-3">Transaction Successful!</h2>
      
      {txHash && (
        <div className="text-gray-400 mb-4 break-all text-sm">
          {txHash}
        </div>
      )}
      
      <Button
        onClick={() => goToScreen(SCREENS.FORM)}
        className="w-full bg-forge-orange hover:bg-forge-orange/90 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98]"
      >
        Continue
      </Button>
    </div>
  )

  const renderErrorScreen = () => (
    <div className="text-center py-6">
      <div className="text-red-500 text-3xl mb-4">✗</div>
      <h2 className="text-xl font-semibold text-white mb-3">Transaction Failed</h2>
      
      {error && (
        <div className="text-red-400 mb-4 text-sm">
          {error}
        </div>
      )}
      
      <div className="flex flex-col space-y-3">
        <Button
          onClick={() => goToScreen(SCREENS.FORM)}
          className="w-full bg-forge-orange hover:bg-forge-orange/90 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98]"
        >
          Try Again
        </Button>
      </div>
    </div>
  )

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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold text-white">Tools</h2>
            <button className="text-gray-400 hover:text-white">
              <Settings className="w-5 h-5" />
            </button>
          </div>

          {!isConnected ? (
            <div className="text-center py-6">
              <Button
                onClick={connectWallet}
                isLoading={connecting}
                className="w-full bg-forge-orange hover:bg-forge-orange/90 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98]"
                staticSize={true}
              >
                Connect Wallet
              </Button>
            </div>
          ) : (
            <>
              {/* Panel Navigation */}
              <div className="flex space-x-1 mb-4 bg-black/30 rounded-xl p-1">
                {panels.map((panel) => {
                  const Icon = panel.icon
                  return (
                    <button
                      key={panel.id}
                      onClick={() => switchPanel(panel.id)}
                      className={`
                        flex-1 flex flex-col items-center p-3 rounded-lg transition-all duration-200
                        ${activePanel === panel.id 
                          ? 'bg-forge-orange text-white shadow-lg' 
                          : 'text-gray-400 hover:text-white hover:bg-white/10'
                        }
                      `}
                    >
                      <Icon className="w-5 h-5 mb-1" />
                      <span className="text-xs font-medium">{panel.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Panel Description */}
              <div className="text-white text-xl font-bold mb-4 text-center">
                {panels.find(p => p.id === activePanel)?.description}
              </div>

              {/* Panel Content */}
              {renderFormContent()}
            </>
          )}
        </GeometricAccents>
      </div>
    </div>
  )
}

export default Tools