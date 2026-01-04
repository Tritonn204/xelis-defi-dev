import { useState, useEffect, useMemo, useCallback } from 'react'
import { useMultiArpFeed } from '@/hooks/useFeed'
import { Search } from 'lucide-react'
import { useAssets } from '@/contexts/AssetContext'
import { useWallet } from '@/contexts/WalletContext'
import { NATIVE_ASSET_HASH } from '@/contexts/NodeContext'
import PortfolioItem from './PortfolioItem'

interface EnrichedAsset {
  hash: string
  ticker: string
  name: string
  decimals: number
  balance: string
  tracked: boolean
}

interface PortfolioProps {
  onSelect: (tokenHash: string) => void
}

const Portfolio = ({ onSelect }: PortfolioProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const { assets } = useAssets()
  const {
    isConnected,
    ownedAssets,
    isAssetTracked,
    trackAsset,
    getBalance,  // ← Add this!
  } = useWallet()

  const [allOwnedAssets, setAllOwnedAssets] = useState<EnrichedAsset[]>([])
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0)

  // Build enriched asset list with balances
  useEffect(() => {
    if (!ownedAssets || !isConnected) {
      setAllOwnedAssets([])
      return
    }

    let cancelled = false

    ;(async () => {
      const entries = Array.from(ownedAssets.entries())
      
      const enriched = await Promise.all(
        entries.map(async ([hash, value]) => {
          // Fetch both tracked status and balance in parallel
          const [tracked, balance] = await Promise.all([
            isAssetTracked({ asset: hash }),
            getBalance(hash)  // ← Fetch balance directly from wallet!
          ])
          
          return {
            ...value,
            hash,
            tracked,
            balance: balance || '0',
          } as EnrichedAsset
        })
      )

      if (!cancelled) {
        setAllOwnedAssets(enriched)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [ownedAssets, isAssetTracked, getBalance, isConnected, balanceRefreshKey])

  // Filter tokens based on search
  const filteredTokens = useMemo(() => {
    let tokens = allOwnedAssets

    // Apply search filter if present
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      tokens = allOwnedAssets.filter((asset) =>
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
  }, [allOwnedAssets, searchTerm])

  // Memoize callbacks
  const handleTrack = useCallback(async (hash: string) => {
    await trackAsset({ asset: hash })
    // Refresh balances after tracking (tracking might trigger balance fetch in wallet)
    setBalanceRefreshKey(prev => prev + 1)
  }, [trackAsset])

  const handleSelect = useCallback((tokenHash: string) => {
    onSelect(tokenHash)
  }, [onSelect])

  // Get tracked hashes for price subscription
  const trackedHashes = useMemo(
    () => allOwnedAssets
      .filter(a => a.tracked)
      .map(a => a.hash),
    [allOwnedAssets]
  )

  // Subscribe to all tracked assets at once
  const priceData = useMultiArpFeed(trackedHashes, 'usd')

  // Optional: Refresh balances periodically
  useEffect(() => {
    if (!isConnected) return

    const interval = setInterval(() => {
      setBalanceRefreshKey(prev => prev + 1)
    }, 30000) // Refresh every 30 seconds

    return () => clearInterval(interval)
  }, [isConnected])

  const formatHash = (hash: string) => {
    if (hash.length <= 12) return hash
    return `${hash.slice(0, 4)}...${hash.slice(-8)}`
  }
  
  return (
    <div className="relative bg-black/50 rounded-lg w-full h-full backdrop-blur-xl min-h-110 border border-forge-orange/10">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center flex p-2 border-b border-forge-orange/10 gap-[0.5rem]">
          <h2 className="text-l font-semibold text-white">
            Portfolio
          </h2>
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, ticker, or asset ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-2 py-1 bg-black/50 border border-forge-orange/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-forge-orange focus:border-transparent"
              autoFocus
            />
          </div>
        </div>

        {/* Token List */}
        <div className="flex-1 overflow-y-auto p-1">
          {!isConnected ? (
            <div className="text-center py-8">
              <div className="text-gray-400 mb-2">No wallet connected</div>
              <div className="text-sm text-gray-500">
                Please connect your wallet to view portfolio
              </div>
            </div>
          ) : filteredTokens.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-400 mb-2">
                {allOwnedAssets.length === 0 ? 'No assets found' : 'No matching tokens'}
              </div>
              <div className="text-sm text-gray-500">
                {allOwnedAssets.length === 0 
                  ? 'You don\'t own any assets yet'
                  : 'Try a different search term'}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTokens.map((asset) => (
                <PortfolioItem
                  key={asset.hash}
                  asset={asset}
                  priceData={asset.tracked ? priceData[asset.hash] : null}
                  isConnected={isConnected}
                  onSelect={handleSelect}
                  onTrack={handleTrack}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Portfolio