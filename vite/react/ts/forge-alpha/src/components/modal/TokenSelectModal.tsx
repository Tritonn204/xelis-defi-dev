import { useState, useEffect, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { useAssets } from '@/contexts/AssetContext'
import { usePools } from '@/contexts/PoolContext'
import { useWallet } from '@/contexts/WalletContext'
import { NATIVE_ASSET_HASH } from '@/contexts/NodeContext'
import { TokenIcon } from '../ui/TokenIcon'
import Button from '../ui/Button'

interface TokenSelectModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (tokenHash: string) => void
  currentToken?: string // Hash of currently selected token
  otherToken?: string // Hash of the other token in the pair
  position: 'from' | 'to'
  mode?: 'trade' | 'pool' // New: determines filtering behavior
}

const TokenSelectModal = ({
  isOpen,
  onClose,
  onSelect,
  currentToken,
  otherToken,
  position,
  mode = 'trade'
}: TokenSelectModalProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [showZeroBalances, setShowZeroBalances] = useState(mode === 'pool') // Default true for pool mode

  const { assets } = useAssets()
  const { activePools, poolAssets } = usePools()
  const { isConnected, isAssetTracked, trackAsset } = useWallet()

  const [trackedMap, setTrackedMap] = useState<Record<string, boolean>>({})

  const allPoolAssets = useMemo(() => Array.from(poolAssets.values()), [poolAssets]);
  const { ownedAssets } = useWallet();

  // Clear search when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('')
      // we don't reset showZeroBalances here; leave user's choice
    }
  }, [isOpen])

  // Format hash for display (first 4 + ... + last 8)
  const formatHash = (hash: string) => {
    if (hash.length <= 12) return hash
    return `${hash.slice(0, 4)}...${hash.slice(-8)}`
  }

  // Get available tokens based on position and connection status
  const availableTokens = useMemo(() => {
    // Pool mode: show all assets from wallet (tracked and untracked)
    if (mode === 'pool') {
      // Show all assets the wallet knows about
      // Assets are keyed by hash, so we need to use Object.entries to get both key and value
      return Object.entries(assets).map(([hash, asset]) => ({
        hash: hash,
        ticker: asset.ticker,
        name: asset.name,
        decimals: asset.decimals
      }))
    }

    // Trade mode: "from" side is the one where wallet balance usually matters
    if (position === 'from') {
      let filtered = allPoolAssets

      if (isConnected && !showZeroBalances) {
        // only show tokens the wallet actually has balance for
        filtered = allPoolAssets.filter(asset =>
          assets[asset.hash] &&
          ownedAssets?.has(asset.hash) &&
          (parseFloat(assets[asset.hash].balance) > 0 || asset.hash === currentToken)
        )
      }

      return filtered
    } else {
      // "to" side: find pairs compatible with otherToken
      if (!otherToken) return []

      const availableHashes = new Set<string>()

      activePools.forEach(pool => {
        if (pool.hashes.includes(otherToken)) {
          pool.hashes.forEach(hash => {
            if (hash !== otherToken && poolAssets.has(hash)) {
              availableHashes.add(hash)
            }
          })
        }
      })

      return allPoolAssets.filter(asset => availableHashes.has(asset.hash))
    }
  }, [
    mode,
    allPoolAssets,
    activePools,
    position,
    otherToken,
    isConnected,
    currentToken,
    poolAssets,
    assets,
    showZeroBalances,
    ownedAssets
  ])

  // fetch tracking state for whatever tokens we’re currently showing
  useEffect(() => {
    if (!isOpen) return
    if (!availableTokens.length) {
      setTrackedMap({})
      return
    }

    let cancelled = false

    ;(async () => {
      const results = await Promise.all(
        availableTokens.map(async (asset) => {
          const tracked = await isAssetTracked({ asset: asset.hash })
          return { hash: asset.hash, tracked }
        })
      )
      if (cancelled) return
      const next: Record<string, boolean> = {}
      results.forEach(({ hash, tracked }) => {
        next[hash] = tracked
      })
      setTrackedMap(next)
    })()

    return () => {
      cancelled = true
    }
  }, [isOpen, availableTokens, isAssetTracked])

  // Filter tokens based on search (now includes hash)
  const filteredTokens = useMemo(() => {
    let tokens = availableTokens

    // Apply search filter if present
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      tokens = availableTokens.filter(asset =>
        asset.ticker.toLowerCase().includes(search) ||
        asset.name.toLowerCase().includes(search) ||
        asset.hash.toLowerCase().includes(search)
      )
    }

    // Pin native asset to the top if it's in the filtered results
    const nativeIndex = tokens.findIndex(asset => asset.hash === NATIVE_ASSET_HASH)
    if (nativeIndex > 0) {
      const nativeAsset = tokens[nativeIndex]
      tokens = [nativeAsset, ...tokens.slice(0, nativeIndex), ...tokens.slice(nativeIndex + 1)]
    }

    return tokens
  }, [availableTokens, searchTerm])

  const handleSelect = (tokenHash: string) => {
    onSelect(tokenHash)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-black/80 border-2 border-forge-orange/30 rounded-2xl w-full max-w-md mx-4">
        <div
          className="flex flex-col"
          style={{
            maxHeight: 'min(66.67vh, 800px)',
            height: 'min(66.67vh, 800px)'
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-forge-orange/20">
            <h2 className="text-xl font-semibold text-white">
              {mode === 'pool' ? 'Select Liquidity Pool Token' : 'Select Token'}
            </h2>
            <Button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10"
              focusOnClick={false}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Search */}
          <div className="p-4 border-b border-forge-orange/20">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, ticker, or asset ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-black/50 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-forge-orange focus:border-transparent"
                autoFocus
              />
            </div>
          </div>

          {/* Show 0 balances checkbox (below divider) - only in trade mode */}
          {mode === 'trade' && position === 'from' && (
            <div className="px-4 py-2 border-b border-forge-orange/20 border-b-0">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={showZeroBalances}
                  onChange={(e) => setShowZeroBalances(e.target.checked)}
                  className="form-checkbox rounded-sm bg-black/50 border-white/40"
                />
                <span>Include Untracked and 0 Balances</span>
              </label>
            </div>
          )}

          {/* Token List */}
          <div className="flex-1 overflow-y-auto p-2">
            {filteredTokens.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-gray-400 mb-2">
                  {searchTerm ? 'No tokens found' : 'No available tokens'}
                </div>
                <div className="text-sm text-gray-500">
                  {mode === 'pool'
                    ? isConnected
                      ? 'No assets in wallet'
                      : 'Connect wallet to see your assets'
                    : position === 'from'
                      ? isConnected
                        ? showZeroBalances
                          ? 'No pool assets detected'
                          : 'You need tokens that are available in liquidity pools'
                        : 'Select from tokens available in liquidity pools'
                      : otherToken
                        ? `No pools found with ${poolAssets.get(otherToken)?.ticker || 'selected token'}`
                        : 'Select a token above first'
                  }
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredTokens.map((asset) => {
                  const isCurrent = asset.hash === currentToken
                  const isTracked = trackedMap[asset.hash] === true
                  const showTrackButton = isConnected && !isTracked && (mode === 'pool' || position === 'from')

                  return (
                    <Button
                      key={asset.hash}
                      onClick={() => handleSelect(asset.hash)}
                      disabled={isCurrent}
                      className={`
                        w-full flex items-center space-x-3 p-3 rounded-xl transition-all duration-200
                        ${isCurrent
                          ? 'bg-white/5 text-gray-400 cursor-not-allowed'
                          : !isTracked && mode === 'pool'
                            ? 'hover:bg-white/10 text-gray-500 hover:scale-[1.02] opacity-60'
                            : 'hover:bg-white/10 text-white hover:scale-[1.02]'
                        }
                      `}
                    >
                      <TokenIcon
                        tokenSymbol={asset.ticker}
                        tokenName={asset.name}
                        tokenHash={asset.hash}
                        size={40}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className={`font-medium truncate ${!isTracked && mode === 'pool' ? 'text-gray-500' : 'text-white'}`}>
                            {asset.ticker}
                          </div>
                        </div>
                        <div className="text-sm text-gray-400 text-left truncate">
                          {asset.name}
                          <span className="text-xs text-forge-orange/50 font-mono ml-2 flex-shrink-0">
                            {formatHash(asset.hash)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <div className={`text-sm ${!isTracked && mode === 'pool' ? 'text-gray-600' : 'text-gray-400'}`}>
                          {isConnected
                            ? parseFloat(assets[asset.hash]?.balance || '0').toFixed(4)
                            : '—'}
                        </div>
                        {showTrackButton && (
                          <Button
                            focusOnClick={false}
                            onClick={async (e: any) => {
                              e.stopPropagation()
                              await trackAsset({ asset: asset.hash })
                              setTrackedMap((prev) => ({
                                ...prev,
                                [asset.hash]: true,
                              }))
                            }}

                            className="mt-1 bg-transparent transition-all duration-200 hover:bg-black/50 active:bg-black text-forge-orange text-xs px-2 py-1 rounded-lg"
                          >
                            Track Asset
                          </Button>
                        )}
                      </div>
                    </Button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TokenSelectModal
