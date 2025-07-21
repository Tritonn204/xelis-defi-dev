import { useState, useEffect, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { useAssets } from '@/contexts/AssetContext'
import { usePools } from '@/contexts/PoolContext'
import { useWallet } from '@/contexts/WalletContext'
import { TokenIcon } from '../ui/TokenIcon'
import Button from '../ui/Button'

interface TokenSelectModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (tokenHash: string) => void
  currentToken?: string // Hash of currently selected token
  otherToken?: string // Hash of the other token in the pair
  position: 'from' | 'to'
}

const TokenSelectModal = ({
  isOpen,
  onClose,
  onSelect,
  currentToken,
  otherToken,
  position
}: TokenSelectModalProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const { assets } = useAssets()
  const { activePools, poolAssets } = usePools()
  const { isConnected } = useWallet()

  const allPoolAssets = useMemo(() => Array.from(poolAssets.values()), [poolAssets])

  // Clear search when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('')
    }
  }, [isOpen])

  // Format hash for display (first 4 + ... + last 8)
  const formatHash = (hash: string) => {
    if (hash.length <= 12) return hash
    return `${hash.slice(0, 4)}...${hash.slice(-8)}`
  }

  // Get available tokens based on position and connection status
  const availableTokens = useMemo(() => {
    if (position === 'from') {
      let filtered = allPoolAssets

      if (isConnected) {
        filtered = allPoolAssets.filter(asset => 
          assets[asset.hash] && (parseFloat(assets[asset.hash].balance) > 0 || asset.hash === currentToken)
        )
      }

      return filtered
    } else {
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
  }, [allPoolAssets, activePools, position, otherToken, isConnected, currentToken, poolAssets])

  // Filter tokens based on search (now includes hash)
  const filteredTokens = useMemo(() => {
    if (!searchTerm) return availableTokens
    
    const search = searchTerm.toLowerCase()
    return availableTokens.filter(asset => 
      asset.symbol.toLowerCase().includes(search) ||
      asset.name.toLowerCase().includes(search) ||
      asset.hash.toLowerCase().includes(search)
    )
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
      <div className="relative bg-black/80 border border-white/20 rounded-2xl w-full max-w-md mx-4 backdrop-blur-xl">
        <div 
          className="flex flex-col"
          style={{ 
            maxHeight: 'min(66.67vh, 800px)',
            height: 'min(66.67vh, 800px)'
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-xl font-semibold text-white">
              Select Token
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
          <div className="p-4 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, symbol, or asset ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-black/50 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-forge-orange focus:border-transparent"
                autoFocus
              />
            </div>
          </div>
          
          {/* Token List */}
          <div className="flex-1 overflow-y-auto p-2">
            {filteredTokens.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-gray-400 mb-2">
                  {searchTerm ? 'No tokens found' : 'No available tokens'}
                </div>
                <div className="text-sm text-gray-500">
                  {position === 'from' 
                    ? isConnected 
                      ? 'You need tokens that are available in liquidity pools'
                      : 'Select from tokens available in liquidity pools'
                    : otherToken
                      ? `No pools found with ${poolAssets.get(otherToken)?.symbol || 'selected token'}`
                      : 'Select a token above first'
                  }
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredTokens.map((asset) => (
                  <Button
                    key={asset.hash}
                    onClick={() => handleSelect(asset.hash)}
                    disabled={asset.hash === currentToken}
                    className={`
                      w-full flex items-center space-x-3 p-3 rounded-xl transition-all duration-200
                      ${asset.hash === currentToken 
                        ? 'bg-white/5 text-gray-400 cursor-not-allowed' 
                        : 'hover:bg-white/10 text-white hover:scale-[1.02]'
                      }
                    `}
                  >
                    <TokenIcon 
                      tokenSymbol={asset.symbol} 
                      tokenName={asset.name} 
                      tokenHash={asset.hash}
                      size={40} 
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-white truncate">
                          {asset.symbol}
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
                      <div className="text-sm text-gray-400">
                        {isConnected ? parseFloat(assets[asset.hash]?.balance || '0').toFixed(4) : '—'}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TokenSelectModal