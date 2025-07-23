import React from 'react'
import { ArrowLeft } from 'lucide-react'
import Button from '../ui/Button'

interface Asset {
  hash: string
  name: string
  symbol: string
}

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
  return (
    <>
      <div className="flex items-center mb-4">
        <button 
          className="text-gray-400 hover:text-white mr-2"
          onClick={goBack}
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
                    token1Symbol: assets[hash]?.symbol || 'Unknown'
                  })
                }}
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
                onChange={(e) => {
                  const hash = e.target.value
                  setTokenSelection({
                    token2Hash: hash,
                    token2Symbol: assets[hash]?.symbol || 'Unknown'
                  })
                }}
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
            onClick={() => onContinue(tokenSelection.token1Hash, tokenSelection.token2Hash)}
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
}

export default SelectTokensScreen
