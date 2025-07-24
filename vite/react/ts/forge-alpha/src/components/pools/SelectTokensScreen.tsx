import React from 'react'
import { ArrowLeft } from 'lucide-react'
import Button from '../ui/Button'
import { Asset } from '@/contexts/AssetContext'
import { usePools } from '@/contexts/PoolContext'
import PoolList from './PoolList'

interface SelectTokensScreenProps {
  goBack: () => void
  onContinue: (token1Hash: string, token2Hash: string) => void
  tokenSelection: {
    token1Hash: string
    token1Symbol: string
    token2Hash: string
    token2Symbol: string
  }
  setTokenSelection: (next: Partial<SelectTokensScreenProps['tokenSelection']>) => void
  loadingAssets: boolean
  availableAssets: Asset[]
  assets: Record<string, Asset>
}

const SelectTokensScreen: React.FC<SelectTokensScreenProps> = ({
  goBack,
  onContinue,
  tokenSelection,
  setTokenSelection,
  loadingAssets,
  availableAssets,
  assets
}) => {
  const { activePools } = usePools()
  return (
    <>
      <div className="flex items-center mb-4">
        <button 
          className="text-gray-400 hover:text-white mr-2"
          onClick={goBack}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-regular text-white">Select/Create a Liquidity Pool</h2>
      </div>
      <div className="relative">
        {/* Content with blur during loading */}
        <div className={loadingAssets ? 'blur-sm pointer-events-none transition-all duration-100' : ''}>
          {/* ➕ Add PoolList here */}
          <div className="mb-1">
            <PoolList
              pools={activePools}
              filterMode="user"
              scrollClass='h-[31vh]'
              onPoolClick={(key, pool) => {
                setTokenSelection({
                  token1Hash: pool.hashes[0],
                  token1Symbol: pool.tickers[0],
                  token2Hash: pool.hashes[1],
                  token2Symbol: pool.tickers[1]
                })
                onContinue(pool.hashes[0], pool.hashes[1])
              }}
            />
          </div>

          <hr className="my-1 h-px border-t-0 bg-transparent bg-gradient-to-r from-transparent via-forge-orange/50 to-transparent opacity-25 dark:opacity-100" />

          <h2 className="text-xl font-regular text-white mb-2">Create New LP</h2>

          {/* Token selectors */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="bg-black/70 rounded-xl p-3 border border-white/12">
              <div className="text-white font-medium mb-2">Token 1</div>
              <select
                className="w-full bg-black/80 text-white p-2 rounded-lg border border-white/20"
                onChange={(e) => {
                  const hash = e.target.value
                  setTokenSelection({
                    token1Hash: hash,
                    token1Symbol: assets[hash]?.ticker || 'Unknown'
                  })
                }}
                value={tokenSelection.token1Hash || ''}
              >
                <option value="">Select Token</option>
                {Object.entries(availableAssets).map(([hash, asset]) => (
                  <option key={hash} value={hash}>
                    {asset.ticker} - {asset.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-black/70 rounded-xl p-3 border border-white/12">
              <div className="text-white font-medium mb-2">Token 2</div>
              <select
                className="w-full bg-black/80 text-white p-2 rounded-lg border border-white/20"
                onChange={(e) => {
                  const hash = e.target.value
                  setTokenSelection({
                    token2Hash: hash,
                    token2Symbol: assets[hash]?.ticker || 'Unknown'
                  })
                }}
                value={tokenSelection.token2Hash || ''}
              >
                <option value="">Select Token</option>
                {Object.entries(availableAssets).map(([hash, asset]) => (
                  <option key={hash} value={hash}>
                    {asset.ticker} - {asset.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Button
            onClick={() => {
              console.log("CLICKED")
              onContinue(tokenSelection.token1Hash, tokenSelection.token2Hash)
            }}
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
        </div>

        {/* Overlay spinner when loading */}
        {loadingAssets && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="animate-spin h-8 w-8 border-4 border-forge-orange border-t-transparent rounded-full" />
          </div>
        )}
      </div>
    </>
  )
}

export default SelectTokensScreen
