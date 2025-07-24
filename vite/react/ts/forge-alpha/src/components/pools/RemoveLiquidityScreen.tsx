import React, { useState } from 'react'
import { ArrowLeft, Settings } from 'lucide-react'
import Button from '../ui/Button'
import PoolList from './PoolList'
import { PoolData } from '@/contexts/PoolContext'
import { formatCompactNumber } from '@/utils/number'
import TokenIcon from '../ui/TokenIcon'
import Decimal from 'decimal.js'
import { useAssets } from '@/contexts/AssetContext'

interface RemoveLiquidityScreenProps {
  pools: Map<string, PoolData>
  loading: boolean
  error?: string
  isSubmitting: boolean
  onWithdraw: (poolKey: string, pool: PoolData, amount: number) => void
  goBack: () => void
}

const RemoveLiquidityScreen = ({
  pools,
  loading,
  error,
  isSubmitting,
  onWithdraw,
  goBack
}: RemoveLiquidityScreenProps) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [withdrawAmount, setWithdrawAmount] = useState<string>('')
  const [inputValue, setInputValue] = useState<string>('');

  const selectedPool = selectedKey ? pools.get(selectedKey) : null

  const { assets } = useAssets()

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;

    if (!/^\d*\.?\d*$/.test(raw)) return;

    setInputValue(raw);

    if (!selectedPool) {
      setWithdrawAmount('');
      return;
    }

    try {
      const percent = new Decimal(raw || '0');
      const clamped = Decimal.min(100, Decimal.max(0, percent));

      if (!percent.equals(clamped)) {
        setInputValue(clamped.toString());
      }

      const lpBalance = new Decimal(assets[selectedPool.lpAsset]?.balance || '0');
      const amountToWithdraw = lpBalance.mul(clamped).div(100).toDecimalPlaces(8, Decimal.ROUND_DOWN);
      const finalAmt = amountToWithdraw.mul(new Decimal(10).pow(8)).floor()

      console.log(finalAmt.toString(), lpBalance.toString())
      setWithdrawAmount(finalAmt.toString());
    } catch {
      setWithdrawAmount('0');
    }
  };

  const parsedAmount = parseFloat(inputValue || '0')
  const withdrawFraction = Math.min(1, Math.max(0, parsedAmount / 100)); 

  const tokenWithdrawals = selectedPool?.locked.map((amount) =>
    new Decimal(amount).mul(new Decimal(withdrawFraction))
  ) ?? [];

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center">
          <button 
            className="text-gray-400 hover:text-white mr-2"
            onClick={goBack}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-semibold text-white">Withdraw Liquidity</h2>
        </div>
        <button className="text-gray-400 hover:text-white">
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {error && (
        <div className="mt-2 text-red-500 text-sm text-center">
          {error}
        </div>
      )}

      <div className="relative mt-2">
        {/* Content with blur during loading */}
        <div className={loading ? 'blur-sm pointer-events-none transition-all duration-100' : ''}>
          <PoolList
            pools={pools}
            filterMode="user"
            scrollClass="h-[31vh]"
            onPoolClick={(key, _) => setSelectedKey(key)}
          />
        </div>

        {/* Overlay spinner */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="animate-spin h-8 w-8 border-4 border-forge-orange border-t-transparent rounded-full mx-auto" />
          </div>
        )}
      </div>

      <div className="mt-1 bg-black/70 border border-white/15 rounded-xl p-2 space-y-2">
        <div className="text-lg text-forge-orange">
          {selectedPool ? (
            <>
              Selected Pool: <span className="font-regular text-white">{selectedPool.name}</span>
            </>
          ) : (
            <>Select a pool to withdraw from.</>
          )}
        </div>

        <div className="bg-black/50 rounded-xl p-3 min-h-[14vh] flex items-center justify-center">
          {selectedPool ? (
            <div className="flex justify-around w-full text-center">
              {selectedPool.tickers.map((ticker, i) => (
                <div key={i} className="flex flex-col items-center space-y-1">
                  {/* Token Icon - use your own component if available */}
                  <div className="w-10 h-10 rounded-full overflow-hidden mb-1">
                    <TokenIcon
                      tokenSymbol={selectedPool.tickers[i]}
                      tokenHash={selectedPool.hashes[i]}
                      tokenName={selectedPool.names[i]}
                      size={40}
                    />
                  </div>
                  <div className="text-[1.1rem] font-semibold text-white">{ticker}</div>
                  <div className="text-white text-sm">
                    Your Share: {formatCompactNumber(selectedPool.locked[i] ?? '0')}
                  </div>
                  <div className="text-forge-orange text-sm">
                    Withdrawing: {formatCompactNumber(tokenWithdrawals[i])}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-white/40 text-sm">No pool selected</div>
          )}
        </div>

        <div className="relative w-full">
          <div className="relative w-full">
            <input
              type="text"
              inputMode="decimal"
              value={inputValue}
              onChange={handleAmountChange}
              placeholder="12.5"
              className="w-full pr-6 bg-black/80 text-white text-lg p-2 rounded-lg border border-white/20 focus:outline-none focus:ring-2 focus:ring-forge-orange"
              disabled={!selectedPool}
            />
            <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/60 text-lg pointer-events-none">
              %
            </span>
          </div>
        </div>

        <Button
          onClick={() => selectedPool && onWithdraw(selectedKey!, selectedPool, parseFloat(withdrawAmount))}
          disabled={!selectedPool || parsedAmount <= 0}
          isLoading={isSubmitting}
          staticSize={true}
          className="
            w-full 
            bg-forge-orange 
            hover:bg-forge-orange/90
            text-white 
            font-light
            text-[1.5rem]
            py-1 px-4 
            rounded-lg 
            transition-all duration-200
            hover:shadow-lg
            hover:ring-2 ring-white
            hover:scale-[1.015]
            active:scale-[0.98]
          "
        >
          Withdraw
        </Button>
      </div>
    </>
  )
}

export default RemoveLiquidityScreen
