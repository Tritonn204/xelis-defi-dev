import { useState, useEffect, useRef } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { NATIVE_ASSET_HASH, NETWORK_NODES, NodeConfig, useNode } from '@/contexts/NodeContext'
import { useTransactionContext } from '@/contexts/TransactionContext'
import { showErrorToast, showSubmitToast } from '@/utils/toast'

import { Hammer, Upload, Coins, Settings } from 'lucide-react'
import Button from '@/components/ui/Button'
import GeometricAccents from '@/components/ui/GeometricAccents'
import TokenCreationFeeModal from '@/components/modal/TokenCreationFeeModal'
import LargeSupplyWarningModal from '@/components/modal/LargeSupplyWarningModal'

import * as daemonTypes from '@xelis/sdk/daemon/types'

// Contract interfaces
// import * as factory from '@/contracts/factory/contract';
import { useAssets } from '@/contexts/AssetContext'
import { useForge } from '@/contexts/ForgeContext'
import { createContractDeployment } from '@/utils/xvmSerializer'

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

const U64_MAX = 18446744073709551615n;
const pow10 = (n: number) => (BigInt(10) ** BigInt(n));

// Convert a human amount string ("123.45") into base units bigint
const toBaseUnits = (amt: string, decimals: number): bigint => {
  if (!amt || Number.isNaN(Number(amt))) return 0n;
  const [wholeStr, fracStr = ''] = amt.split('.');
  const whole = wholeStr ? BigInt(wholeStr) : 0n;
  const fracPadded = (fracStr + '0'.repeat(decimals)).slice(0, decimals);
  const frac = fracPadded ? BigInt(fracPadded) : 0n;
  return whole * pow10(decimals) + frac;
};

// Format base units bigint into human string with `decimals` places.
// Trims trailing zeros; keeps at least "0" before/after dot.
const formatUnits = (value: bigint, decimals: number): string => {
  if (decimals <= 0) return value.toLocaleString('en-US'); // commas for big ints

  const base = pow10(decimals);
  const whole = value / base;
  const frac = value % base;

  if (frac === 0n) {
    // Only whole part → add commas
    return whole.toLocaleString('en-US');
  }

  let fracStr = (base + frac).toString().slice(1); // zero-pad
  fracStr = fracStr.replace(/0+$/, ''); // trim trailing zeros

  // Add commas to the whole part
  const wholeStr = whole.toLocaleString('en-US');

  return `${wholeStr}.${fracStr}`;
};

const Tools = () => {
  const {
    assets
  } = useAssets()

  const {
    isConnected,
    openConnectModal,
    connecting,
    address,
    buildTransaction,
    submitTransaction,
    clearTxCache,
  } = useWallet()

  const {
    currentNetwork,
    currentNode,
    customNetworks,
  } = useNode()

  const {
    awaitContractInvocation
  } = useTransactionContext()

  const {
    factory
  } = useForge();

  // Panel and screen state
  const [activePanel, setActivePanel] = useState(PANELS.CREATE_TOKEN)
  const [currentScreen, setCurrentScreen] = useState(SCREENS.FORM)
  const currentScreenRef = useRef(currentScreen)
  const [currentFlow, setCurrentFlow] = useState<'create' | 'deploy' | 'mint' | 'update'>('create')

  useEffect(() => {
    currentScreenRef.current = currentScreen
  }, [currentScreen])

  // Form states
  const [createTokenForm, setCreateTokenForm] = useState({
    name: '',
    ticker: '',
    decimals: 8,
    supply: '',
    hasMaxSupply: false,
    mintable: true,
    hasIcon: false,
    maxSupply: '',
    iconUrl: ''
  })

  const [deployForm, setDeployForm] = useState({
    bytecode: '',
    hasConstructor: false
  })

  const [mintForm, setMintForm] = useState({
    assetHash: '',
    mintAmount: ''
  })

  const effectiveMintable = !createTokenForm.hasMaxSupply ? true : createTokenForm.mintable;

  // Transaction state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [waitingForConfirmation, setWaitingForConfirmation] = useState(false)

  // Fee notification modal state
  const [showFeeModal, setShowFeeModal] = useState(false)

  // Large supply warning modal state
  const [showLargeSupplyModal, setShowLargeSupplyModal] = useState(false)

  // Handle wallet disconnects - free up buttons
  useEffect(() => {
    if (!isConnected && isSubmitting) {
      setIsSubmitting(false)
      showErrorToast('Wallet disconnected', { duration: 4000 })
    }
  }, [isConnected, isSubmitting])

  // Get Factory contract address from current node (works for all networks)
  const factoryContract = currentNode?.contractAddresses?.factory;

  const createDisabled =
    !createTokenForm.name ||
    !createTokenForm.ticker ||
    !createTokenForm.supply ||
    !factoryContract ||
    (createTokenForm.hasMaxSupply &&
      (!createTokenForm.maxSupply ||
      parseFloat(createTokenForm.maxSupply) < parseFloat(createTokenForm.supply || '0')))

  // Navigation helpers
  const goToScreen = (screen: string) => {
    setCurrentScreen(screen)
    if (error) setError('')
    // Reset waiting state when returning to form
    if (screen === SCREENS.FORM) {
      setWaitingForConfirmation(false)
    }
  }

  // Check if initial supply is large (>2M with decimals accounted for)
  const isLargeSupply = () => {
    const supply = createTokenForm.supply
    if (!supply || Number.isNaN(Number(supply))) return false

    const supplyAtomic = toBaseUnits(supply, createTokenForm.decimals)
    const threshold = 5_000_000n * pow10(createTokenForm.decimals)

    return supplyAtomic > threshold
  }

  // Handle create token button click with fee modal check
  const handleCreateTokenClick = () => {
    const hideFeeModal = localStorage.getItem('hideDisclaimer_token_creation_fee') === 'true'

    if (hideFeeModal) {
      // User has opted to not see the fee modal, check large supply next
      checkLargeSupplyOrProceed()
    } else {
      // Show the fee modal first
      setShowFeeModal(true)
    }
  }

  // Check large supply and show warning if needed, or proceed to confirm
  const checkLargeSupplyOrProceed = () => {
    const hideLargeSupplyModal = localStorage.getItem('hideDisclaimer_large_supply_warning') === 'true'

    if (!hideLargeSupplyModal && isLargeSupply()) {
      setShowLargeSupplyModal(true)
    } else {
      goToScreen(SCREENS.CONFIRM)
    }
  }

  // Handle fee modal confirmation
  const handleFeeModalConfirm = () => {
    setShowFeeModal(false)
    checkLargeSupplyOrProceed()
  }

  // Handle fee modal cancellation
  const handleFeeModalCancel = () => {
    setShowFeeModal(false)
  }

  // Handle large supply modal confirmation
  const handleLargeSupplyConfirm = () => {
    setShowLargeSupplyModal(false)
    goToScreen(SCREENS.CONFIRM)
  }

  // Handle large supply modal cancellation
  const handleLargeSupplyCancel = () => {
    setShowLargeSupplyModal(false)
  }

  const switchPanel = (panel: string) => {
    setActivePanel(panel)
    setCurrentScreen(SCREENS.FORM)
    setError('')
    setTxHash('')
    setWaitingForConfirmation(false)
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
    setWaitingForConfirmation(false)

    if (status === 'executed') {
      if (currentScreenRef.current === SCREENS.CONFIRM) {
        goToScreen(SCREENS.SUCCESS)
      }
    } else {
      const errorMsg = status === 'reverted' ? 'Transaction reverted' : `Transaction ${status}`
      setError(errorMsg)
      if (currentScreenRef.current === SCREENS.CONFIRM) {
        goToScreen(SCREENS.ERROR)
      }
    }
  }

  const flowLabels = {
    create: 'Token created successfully!',
    deploy: 'Contract deployed successfully!',
    mint: 'Tokens minted successfully!'
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
    setCurrentFlow('create')

    try {
      if (!factoryContract) {
        throw new Error('Factory contract address not found');
      }
      if (!factory) {
        throw new Error('Factory contract interface not initialized');
      }

      const pow10 = (n: number) => (BigInt(10) ** BigInt(n));
      const toBaseUnits = (amt: string, decimals: number): bigint => {
        if (!amt || Number.isNaN(Number(amt))) return 0n;

        // allow "123.45" style input safely
        const [wholeStr, fracStr = ''] = amt.split('.');
        const whole = wholeStr ? BigInt(wholeStr) : 0n;

        const fracPadded = (fracStr + '0'.repeat(decimals)).slice(0, decimals);
        const frac = fracPadded ? BigInt(fracPadded) : 0n;

        return (whole * pow10(decimals)) + frac;
      };

      // --- derive effective flags from UI ---
      const decimals = Number(createTokenForm.decimals) || 0;
      const supplyBn = toBaseUnits(String(createTokenForm.supply), decimals);

      // when no max supply, mintable must be true (per your UI rule)
      const effectiveMintable = !createTokenForm.hasMaxSupply
        ? true
        : !!createTokenForm.mintable;

      // build enum value for MaxSupplyMode
      let maxSupplyModeParam: any;

      if (!createTokenForm.hasMaxSupply) {
        // No cap; mintable is implicitly true
        maxSupplyModeParam = factory.enum('MaxSupplyMode', 'None');
      } else {
        // We have a cap number; compute base units
        const maxSupplyBn = toBaseUnits(String(createTokenForm.maxSupply), decimals);

        if (effectiveMintable) {
          // Cap exists + mintable
          maxSupplyModeParam = factory.enum('MaxSupplyMode', 'Mintable', maxSupplyBn);
        } else {
          // Cap exists + not mintable (fixed cap)
          maxSupplyModeParam = factory.enum('MaxSupplyMode', 'Fixed', maxSupplyBn);
        }
      }

      console.log(maxSupplyModeParam);

      // --- finally build the invocation ---
      const txData = factory!.invokeUnsafe('deploy_asset', {
        name: createTokenForm.name,
        ticker: createTokenForm.ticker,
        decimals,
        supply: supplyBn,                  // bigint safe for u64/u128
        mintable: effectiveMintable,       // matches UI logic
        max_supply_mode: maxSupplyModeParam,
        icon: createTokenForm.iconUrl,     // can be empty string if not provided
        deposits: {
          [NATIVE_ASSET_HASH]: 100000000 + 100000000, // TODO: keep/adjust fee calc
        },
        permission: 'all',
      })!;

      console.log("txData", txData);

      const txBuilder = await buildTransaction(txData);
      console.log("Create Token TX", txBuilder)

      awaitContractInvocation(txBuilder.hash, factoryContract, {
        successMessage: flowLabels.create,
        callback: handleTransactionResult
      })
      await submitTransaction(txBuilder)

      // Free up the button immediately after submission
      setIsSubmitting(false)
      setWaitingForConfirmation(true)
      showSubmitToast()

    } catch (err: any) {
      handleTransactionError(err)
    }
  }

  const submitDeployContract = async () => {
    setIsSubmitting(true)
    setError('')
    setCurrentFlow('deploy')

    try {
      const txData = createContractDeployment({
        bytecode: deployForm.bytecode,
        hasConstructor: deployForm.hasConstructor,
        maxGas: 10000000
      })

      const txBuilder = await buildTransaction(txData)
      console.log("Deploy Contract TX", txBuilder)

      // For contract deployment, we don't have a specific contract to monitor
      awaitContractInvocation(txBuilder.hash, '', {
        successMessage: flowLabels.deploy,
        callback: handleTransactionResult
      })
      await submitTransaction(txBuilder)

      // Free up the button immediately after submission
      setIsSubmitting(false)
      setWaitingForConfirmation(true)
      showSubmitToast()

    } catch (err: any) {
      handleTransactionError(err)
    }
  }

  const submitMintTokens = async () => {
    setIsSubmitting(true)
    setError('')
    setCurrentFlow('mint')

    try {
      if (!factoryContract) {
        throw new Error('Factory contract address not found')
      }

      const selectedAsset = Object.values(assets).find(asset => asset.hash === mintForm.assetHash)
      if (!selectedAsset) {
        throw new Error('Selected asset not found')
      }

      const adjustedAmount = parseFloat(mintForm.mintAmount) * Math.pow(10, selectedAsset.decimals)

      const txData = factory?.invokeUnsafe('mint', {
        contract: factoryContract,
        assetHash: mintForm.assetHash,
        mintAmount: adjustedAmount
      })!

      const txBuilder = await buildTransaction(txData)
      console.log("Mint Tokens TX", txBuilder)

      awaitContractInvocation(txBuilder.hash, factoryContract, {
        successMessage: flowLabels.mint,
        callback: handleTransactionResult
      })
      await submitTransaction(txBuilder)

      // Free up the button immediately after submission
      setIsSubmitting(false)
      showSubmitToast()

    } catch (err: any) {
      handleTransactionError(err)
    }
  }

  useEffect(() => {
    if (!createTokenForm.hasMaxSupply && !createTokenForm.mintable) {
      setCreateTokenForm(f => ({ ...f, mintable: true }));
    }
    if (!createTokenForm.hasMaxSupply && createTokenForm.maxSupply) {
      setCreateTokenForm(f => ({ ...f, maxSupply: '' }));
    }
  }, [createTokenForm.hasMaxSupply]);

  // TODO: update icon submit {}

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
      label: 'Manage Tokens',
      description: 'Manage your Forge Tokens'
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
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-forge-orange/30 focus:border-forge-orange focus:outline-none"
                placeholder="My Token"
              />
            </div>

            <div>
              <label className="block text-forge-orange text-sm font-medium mb-2">Ticker Symbol</label>
              <input
                type="text"
                value={createTokenForm.ticker}
                onChange={(e) => handleCreateTokenChange('ticker', e.target.value.toUpperCase())}
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-forge-orange/30 focus:border-forge-orange focus:outline-none"
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
                  className="w-full bg-black/80 text-white p-3 rounded-lg border border-forge-orange/30 focus:border-forge-orange focus:outline-none"
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
                  className="w-full bg-black/80 text-white p-3 rounded-lg border border-forge-orange/30 focus:border-forge-orange focus:outline-none"
                  placeholder="1000000"
                  min="0"
                />
              </div>
            </div>

            {/* Icon URL gate */}
            <div>
              <label className="flex items-center space-x-2 text-white">
                <input
                  type="checkbox"
                  checked={createTokenForm.hasIcon}
                  onChange={(e) => handleCreateTokenChange('hasIcon', e.target.checked)}
                  className="rounded border-white/20"
                />
                <span>Provide Icon URL (optional)</span>
              </label>
            </div>

            {/* Icon URL field */}
            <div
              className={`
              transition-all duration-300 ease-in-out overflow-hidden 
              ${createTokenForm.hasIcon ? 'max-h-40 opacity-100 mt-2' : 'max-h-0 opacity-0'}
            `}
            >
              <div>
                <label className="block text-forge-orange text-sm font-medium mb-2">Icon URL</label>
                <input
                  type="text"
                  value={createTokenForm.iconUrl}
                  onChange={(e) => handleCreateTokenChange('iconUrl', e.target.value)}
                  className="w-full bg-black/80 text-white p-3 rounded-lg border border-forge-orange/30 focus:border-forge-orange focus:outline-none"
                  placeholder="https://your-cdn.com/my-token-icon.png"
                />
              </div>
            </div>

            {/* Max Supply gate */}
            <div className="mt-2">
              <label className="flex items-center space-x-2 text-white">
                <input
                  type="checkbox"
                  checked={createTokenForm.hasMaxSupply}
                  onChange={(e) => handleCreateTokenChange('hasMaxSupply', e.target.checked)}
                  className="rounded border-white/20"
                />
                <span>Set a Max Supply (optional)</span>
              </label>
              <p className="text-xs text-gray-400 mt-1">
                If disabled, the token will be mintable with no max cap <span className="text-white">(u64 atomic)</span>.
              </p>
            </div>

            {/* Max Supply field (gated) */}
            <div
              className={`
              transition-all duration-300 ease-in-out overflow-hidden 
              ${createTokenForm.hasMaxSupply ? 'max-h-40 opacity-100 mt-2' : 'max-h-0 opacity-0'}
            `}
            >
              <div>
                <label className="block text-forge-orange text-sm font-medium mb-2">Max Supply</label>
                <input
                  type="number"
                  value={createTokenForm.maxSupply}
                  onChange={(e) => handleCreateTokenChange('maxSupply', e.target.value)}
                  className="w-full bg-black/80 text-white p-3 rounded-lg border border-forge-orange/30 focus:border-forge-orange focus:outline-none"
                  placeholder="10000000"
                  min={createTokenForm.supply || 0}
                />
              </div>
            </div>

            {/* Mintable control: locked ON when max supply is OFF */}
            <div className="mt-2">
              <label className={`flex items-center space-x-2 ${!createTokenForm.hasMaxSupply ? 'text-gray-400' : 'text-white'}`}>
                <input
                  type="checkbox"
                  checked={effectiveMintable}
                  onChange={(e) => {
                    if (createTokenForm.hasMaxSupply) {
                      handleCreateTokenChange('mintable', e.target.checked)
                    }
                  }}
                  className="rounded border-white/20"
                  disabled={!createTokenForm.hasMaxSupply}
                />
                <span>
                  Mintable
                  {!createTokenForm.hasMaxSupply && ' (required when Max Supply is disabled)'}
                </span>
              </label>
              {createTokenForm.hasMaxSupply ? (
                <p className="text-xs text-gray-400 mt-1">
                  Allow creating more tokens later, up to your Max Supply.
                </p>
              ) : (
                <p className="text-xs text-gray-400 mt-1">
                  Mintable is automatically enabled because no Max Supply is set.
                </p>
              )}
            </div>

            <Button
              onClick={handleCreateTokenClick}
              disabled={!createTokenForm.name || !createTokenForm.ticker || !createTokenForm.supply || !factoryContract}
              className="w-full bg-forge-orange hover:bg-forge-orange/90 disabled:bg-gray-600 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98]"
            >
              Create Token
            </Button>

            {!factoryContract && isConnected && (
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
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-forge-orange/30 focus:border-forge-orange focus:outline-none h-32 font-mono text-xs"
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
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-forge-orange/30 focus:border-forge-orange focus:outline-none"
              >
                <option value="">Select a token to mint</option>
                {Object.values(assets)
                  .filter(asset => asset.isForge)
                  .map(asset => (
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
                className="w-full bg-black/80 text-white p-3 rounded-lg border border-forge-orange/30 focus:border-forge-orange focus:outline-none"
                placeholder="100"
                min="0"
                step="0.00000001"
              />
            </div>

            <Button
              onClick={() => goToScreen(SCREENS.CONFIRM)}
              disabled={createDisabled}
              className="w-full bg-forge-orange hover:bg-forge-orange/90 disabled:bg-gray-600 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98]"
            >
              Manage Tokens
            </Button>

            {!factoryContract && isConnected && (
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
    const currentPanel = panels.find(p => p.id === activePanel);
    const decimals = Number(createTokenForm.decimals) || 0;

    // Compute key numbers in base units for accurate comparisons/labels
    const supplyBn = toBaseUnits(String(createTokenForm.supply), decimals);

    // Decide the cap numbers and labels based on permutations
    let capBn: bigint;
    let capLabelHuman: string;
    let capHasAsterisk = false;
    
    if (createTokenForm.hasMaxSupply) {
      const maxSupplyBn = toBaseUnits(String(createTokenForm.maxSupply || '0'), decimals);
      capBn = maxSupplyBn;
      capLabelHuman = formatUnits(maxSupplyBn, decimals);
    } else {
      // Unlimited mode: cap is protocol max in atomic units; show scaled * value
      capBn = U64_MAX;
      capLabelHuman = formatUnits(U64_MAX, decimals);
      capHasAsterisk = true;
    }

    const initialSupplyHuman = formatUnits(supplyBn, decimals);

    // A readable “mode” label
    const supplyModeLabel = !createTokenForm.hasMaxSupply
      ? 'Unlimited (mintable)'
      : effectiveMintable
        ? 'Capped & Mintable'
        : 'Fixed Cap (not mintable)';

    return (
      <div className="space-y-4">
        <div className="text-center mb-4">
          <h3 className="text-lg font-medium text-white">Confirm {currentPanel?.label}</h3>
        </div>

        <div className="bg-black/70 rounded-xl p-4 border border-forge-orange/30">
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
                <span className="text-white">{decimals}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Initial Supply:</span>
                <span className="text-white">{initialSupplyHuman}</span>
              </div>

              {/* New: Show supply mode + cap */}
              <div className="flex justify-between">
                <span className="text-gray-300">Supply Mode:</span>
                <span className="text-white">{supplyModeLabel}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-300">Max Supply:</span>
                <span className="text-white">
                  {capLabelHuman}{capHasAsterisk ? ' *' : ''}
                </span>
              </div>

              {/* Keep Icon/Mintable lines if you like them explicit */}
              <div className="flex justify-between">
                <span className="text-gray-300">Mintable:</span>
                <span className="text-white">
                  {effectiveMintable ? (createTokenForm.hasMaxSupply ? 'Yes' : 'Yes (no max cap)') : 'No'}
                </span>
              </div>

              {createTokenForm.hasIcon && createTokenForm.iconUrl && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Icon URL:</span>
                  <span className="text-white break-all text-right">{createTokenForm.iconUrl}</span>
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
                  {Object.values(assets).find(a => a.hash === mintForm.assetHash)?.ticker}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Amount:</span>
                <span className="text-white">{mintForm.mintAmount}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footnote for the asterisk case */}
        {activePanel === PANELS.CREATE_TOKEN && !createTokenForm.hasMaxSupply && (
          <div className="text-xs text-gray-400">
            * Displayed cap is the protocol maximum: <span className="text-white">u64::MAX</span> atomic units
            (<span className="text-white">18,446,744,073,709,551,615</span>), scaled by your decimals setting.
          </div>
        )}

        {/* Show waiting state for create token and deploy contract */}
        {waitingForConfirmation && (activePanel === PANELS.CREATE_TOKEN || activePanel === PANELS.DEPLOY_CONTRACT) ? (
          <>
            <div className="flex items-center justify-center space-x-3 py-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-forge-orange"></div>
              <span className="text-gray-300">Waiting for blockchain confirmation...</span>
            </div>
            <Button
              onClick={() => goToScreen(SCREENS.FORM)}
              className="w-full bg-transparent border border-forge-orange/30 hover:bg-white/10 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200"
            >
              Go Back
            </Button>
          </>
        ) : (
          <div className="flex space-x-3">
            <Button
              onClick={() => goToScreen(SCREENS.FORM)}
              className="flex-1 bg-transparent border border-forge-orange/30 hover:bg-white/10 text-white font-light text-[1.5rem] py-1 px-4 rounded-xl transition-all duration-200"
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
        )}
      </div>
    )
  }

  const renderSuccessScreen = () => {
    const labels = () => {
      switch (currentFlow) {
        case 'create': return ["New Token Created!", "TX:"]
        case 'deploy': return ["Contract Deployed!", "SCID:"]
        case 'mint':   return ["Token Mint Successful!", "TX:"]
        case 'update': return ["Token Metadata Updated!", "TX:"]
        default:       return ["Success!", "TX:"]
      }
    }

    return (
      <div className="text-center py-6">
        <div className="text-green-400 text-3xl mb-4">✓</div>
        <h2 className="text-xl font-semibold text-white mb-3">{labels()[0]}</h2>
        {txHash && (
          <div className="text-gray-400 mb-4 break-all text-sm">
            {labels()[1]} {txHash}
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
  }

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
    <>
      <TokenCreationFeeModal
        isOpen={showFeeModal}
        onConfirm={handleFeeModalConfirm}
        onCancel={handleFeeModalCancel}
        storageKey="token_creation_fee"
      />

      <LargeSupplyWarningModal
        isOpen={showLargeSupplyModal}
        onConfirm={handleLargeSupplyConfirm}
        onCancel={handleLargeSupplyCancel}
        storageKey="large_supply_warning"
      />

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
          blendMode='soft-light'
          isLoading={isSubmitting}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold text-white">Forge</h2>
            <button className="text-gray-400 hover:text-white">
              <Settings className="w-5 h-5" />
            </button>
          </div>

          {!isConnected ? (
            <div className="text-center py-6">
              <Button
                onClick={openConnectModal}
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
    </>
  )
}

export default Tools