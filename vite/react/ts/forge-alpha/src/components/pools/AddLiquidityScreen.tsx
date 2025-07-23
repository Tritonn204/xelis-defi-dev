import React from 'react'
import { ArrowLeft } from 'lucide-react'
import Button from '../ui/Button'
import LiquidityInput from './LiquidityInput'

interface AddLiquidityScreenProps {
  goBack: () => void
  goNext: () => void
  tokenSelection: {
    token1Hash: string
    token1Symbol: string
    token1Amount: string
    token1Decimals: number
    token2Hash: string
    token2Symbol: string
    token2Amount: string
    token2Decimals: number
  }
  handleAmountChange: (field: 'token1Amount' | 'token2Amount', value: number) => void
  autoFillEnabled: boolean
  setAutoFillEnabled: (next: boolean) => void
  assetPrices: Map<string, number>
}

const AddLiquidityScreen: React.FC<AddLiquidityScreenProps> = ({
  goBack,
  goNext,
  tokenSelection,
  handleAmountChange,
  autoFillEnabled,
  setAutoFillEnabled,
  assetPrices,
}) => {
  const token1Price = assetPrices.get(tokenSelection.token1Hash) || 0
  const token2Price = assetPrices.get(tokenSelection.token2Hash) || 0

  return (
    <>
      <div className="flex items-center mb-4">
        <button 
          className="text-gray-400 hover:text-white mr-2"
          onClick={goBack}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-semibold text-white">Add Liquidity</h2>
      </div>

      <div className="text-gray-300 mb-4">
        Enter the amount of tokens you want to deposit
      </div>

      <div className="relative">
        <div className="-mb-6">
          <LiquidityInput 
            label={`${tokenSelection.token1Symbol} Amount`}
            amount={tokenSelection.token1Amount}
            onChange={(value: number) => handleAmountChange('token1Amount', value)}
            tokenHash={tokenSelection.token1Hash}
          />
        </div>

        <div className="flex justify-center items-center">
          <div className="text-white text-4xl">+</div>
        </div>

        <div className="-mt-4">
          <LiquidityInput 
            label={`${tokenSelection.token2Symbol} Amount`}
            amount={tokenSelection.token2Amount}
            onChange={(value: number) => handleAmountChange('token2Amount', value)}
            tokenHash={tokenSelection.token2Hash}
          />
        </div>
      </div>

      {(token1Price > 0 && token2Price > 0) && (
        <div className="flex items-center justify-between ml-1 mt-2 mr-1 mb-2">
          <label htmlFor="autofill-toggle" className="text-white text-sm">
            Autofill other token using price
          </label>
          <input
            id="autofill-toggle"
            type="checkbox"
            className="w-5 h-5 accent-forge-orange"
            checked={autoFillEnabled}
            onChange={(e) => setAutoFillEnabled(e.target.checked)}
          />
        </div>
      )}

      <div className="mt-2">
        <Button
          onClick={goNext}
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
}

export default AddLiquidityScreen
