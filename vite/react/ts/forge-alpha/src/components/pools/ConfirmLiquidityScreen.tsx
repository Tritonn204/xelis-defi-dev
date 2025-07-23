import React from 'react'
import Decimal from 'decimal.js'
import { ArrowLeft } from 'lucide-react'
import Button from '../ui/Button'

import { PoolData } from '@/contexts/PoolContext'

interface ConfirmLiquidityScreenProps {
  goBack: () => void
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
  assetPrices: Map<string, number>
  activePools: Map<string, PoolData>
  routerContract?: string
  txHash?: string
  isSubmitting: boolean
  onSubmit: () => void
}

const ConfirmLiquidityScreen: React.FC<ConfirmLiquidityScreenProps> = ({
  goBack,
  tokenSelection,
  assetPrices,
  activePools,
  routerContract,
  txHash,
  isSubmitting,
  onSubmit,
}) => {
  const {
    token1Hash,
    token2Hash,
    token1Symbol,
    token2Symbol,
    token1Amount,
    token2Amount,
    token1Decimals,
    token2Decimals,
  } = tokenSelection

  const poolKey1 = `${token1Hash}_${token2Hash}`
  const poolKey2 = `${token2Hash}_${token1Hash}`
  const pool = activePools.get(poolKey1) || activePools.get(poolKey2)

  const tokenAAmountAtomic = new Decimal(token1Amount || 0).mul(10 ** token1Decimals)
  const tokenBAmountAtomic = new Decimal(token2Amount || 0).mul(10 ** token2Decimals)

  let estimatedLpTokens: string

  if (pool) {
    const poolLockedA = new Decimal(pool.locked[0] || 0)
    const poolLockedB = new Decimal(pool.locked[1] || 0)
    const totalLPSupply = new Decimal(pool.totalLpSupply.toString())

    const ratioA = tokenAAmountAtomic.div(poolLockedA || 1)
    const ratioB = tokenBAmountAtomic.div(poolLockedB || 1)
    const shareRatio = Decimal.min(ratioA, ratioB)

    const lpAmountAtomic = totalLPSupply.mul(shareRatio)
    estimatedLpTokens = lpAmountAtomic.div(1e8).toFixed(8)
  } else {
    const lpAmountAtomic = tokenAAmountAtomic.mul(tokenBAmountAtomic).sqrt()
    const MINIMUM_LIQUIDITY = new Decimal(1000)
    estimatedLpTokens = lpAmountAtomic.sub(MINIMUM_LIQUIDITY).div(1e8).toFixed(8)
  }

  const getUsdValue = (amount: string, price: number) =>
    (parseFloat(amount || '0') * price).toFixed(2)

  return (
    <>
      <div className="flex items-center mb-4">
        <button className="text-gray-400 hover:text-white mr-2" onClick={goBack}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-semibold text-white">Confirm</h2>
      </div>

      <div className="bg-black/70 rounded-xl p-4 border border-white/12 mb-4">
        <h3 className="text-lg font-medium text-white mb-3">You are adding</h3>

        <div className="flex justify-between items-center mb-2">
          <div className="text-gray-300">
            {token1Amount} {token1Symbol}
          </div>
          <div className="text-white font-medium">
            ${getUsdValue(token1Amount, assetPrices.get(token1Hash) || 0)}
          </div>
        </div>

        <div className="flex justify-between items-center mb-4">
          <div className="text-gray-300">
            {token2Amount} {token2Symbol}
          </div>
          <div className="text-white font-medium">
            ${getUsdValue(token2Amount, assetPrices.get(token2Hash) || 0)}
          </div>
        </div>

        <div className="border-t border-white/10 pt-3">
          <div className="flex justify-between items-center">
            <div className="text-gray-300">Estimated LP tokens</div>
            <div className="text-white font-medium">{estimatedLpTokens} LP</div>
          </div>

          <div className="flex justify-between items-center mt-2">
            <div className="text-gray-300">Router contract</div>
            <div className="text-white font-medium text-xs truncate max-w-[200px]">
              {routerContract}
            </div>
          </div>
        </div>
      </div>

      <Button
        onClick={onSubmit}
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
}

export default ConfirmLiquidityScreen
