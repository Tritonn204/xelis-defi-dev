import React, { useState, lazy, Suspense } from 'react'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import Button from '../ui/Button'
import { Asset } from '@/contexts/AssetContext'
import { usePools } from '@/contexts/PoolContext'
import PoolList from './PoolList'
import { TokenIcon } from '../ui/TokenIcon'

const TokenSelectModal = lazy(() => import('../modal/TokenSelectModal'))

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
  availableAssets: Record<string, Asset>
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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalPosition, setModalPosition] = useState<'token1' | 'token2'>('token1')

  const handleTokenSelect = (position: 'token1' | 'token2') => {
    setModalPosition(position)
    setIsModalOpen(true)
  }

  const handleTokenSelected = (tokenHash: string) => {
    const asset = assets[tokenHash]
    if (!asset) return

    if (modalPosition === 'token1') {
      setTokenSelection({
        token1Hash: tokenHash,
        token1Symbol: asset.ticker
      })
    } else {
      setTokenSelection({
        token2Hash: tokenHash,
        token2Symbol: asset.ticker
      })
    }
    setIsModalOpen(false)
  }

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
            <div className="bg-black/70 rounded-xl p-3 border border-forge-orange/30">
              <div className="text-white font-medium mb-2">Asset 1</div>
              <Button
                onClick={() => handleTokenSelect('token1')}
                className="w-full flex items-center justify-between p-3 bg-black/80 hover:bg-black/60 rounded-lg border border-forge-orange/30 transition-all duration-200"
              >
                {tokenSelection.token1Hash && assets[tokenSelection.token1Hash] ? (
                  <div className="flex items-center space-x-2">
                    <TokenIcon
                      tokenSymbol={assets[tokenSelection.token1Hash].ticker}
                      tokenHash={tokenSelection.token1Hash}
                      tokenName={assets[tokenSelection.token1Hash].name}
                      size={24}
                    />
                    <span className="text-white">{assets[tokenSelection.token1Hash].ticker}</span>
                  </div>
                ) : (
                  <span className="text-gray-400">Select Asset</span>
                )}
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </Button>
            </div>

            <div className="bg-black/70 rounded-xl p-3 border border-forge-orange/30">
              <div className="text-white font-medium mb-2">Asset 2</div>
              <Button
                onClick={() => handleTokenSelect('token2')}
                className="w-full flex items-center justify-between p-3 bg-black/80 hover:bg-black/60 rounded-lg border border-forge-orange/30 transition-all duration-200"
              >
                {tokenSelection.token2Hash && assets[tokenSelection.token2Hash] ? (
                  <div className="flex items-center space-x-2">
                    <TokenIcon
                      tokenSymbol={assets[tokenSelection.token2Hash].ticker}
                      tokenHash={tokenSelection.token2Hash}
                      tokenName={assets[tokenSelection.token2Hash].name}
                      size={24}
                    />
                    <span className="text-white">{assets[tokenSelection.token2Hash].ticker}</span>
                  </div>
                ) : (
                  <span className="text-gray-400">Select Asset</span>
                )}
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </Button>
            </div>
          </div>

          <Button
            onClick={() => {
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

      {/* Token Selection Modal */}
      {isModalOpen && (
        <Suspense fallback={
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
            </div>
          </div>
        }>
          <TokenSelectModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSelect={handleTokenSelected}
            currentToken={modalPosition === 'token1' ? tokenSelection.token1Hash : tokenSelection.token2Hash}
            otherToken={modalPosition === 'token1' ? tokenSelection.token2Hash : tokenSelection.token1Hash}
            position="from"
            mode="pool"
          />
        </Suspense>
      )}
    </>
  )
}

export default SelectTokensScreen
