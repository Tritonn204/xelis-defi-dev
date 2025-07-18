import { useTokens } from '../contexts/TokenContext'
import { useWallet } from '../contexts/WalletContext'
import { Settings } from 'lucide-react'
import TokenInput from '../components/trading/TokenInput'
import TokenStats from '../components/trading/TokenStats'
import SwapButton from '../components/trading/SwapButton'
import Button from '../components/ui/Button'
import GeometricAccents from '../components/ui/GeometricAccents'

const Trade = () => {
  const { 
    tokens, 
    selectedTokens, 
    swapAmounts, 
    swapTokens, 
    setAmount,
    loading 
  } = useTokens()
  const { isConnected, connectWallet } = useWallet()

  const fromToken = tokens[selectedTokens.from]
  const toToken = tokens[selectedTokens.to]

  const handleSwap = () => {
    if (!isConnected) {
      connectWallet()
      return
    }
    // Handle swap logic
  }

  return (
    <div className="flex justify-center items-center min-h-[75vh]">

      <div className="background-transparent rounded-2xl p-5 w-full max-w-md">
        {/* Header */}
        {/* <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-xl font-semibold text-white">Swap</h2>
          <button className="text-gray-400 hover:text-white">
            <Settings className="w-5 h-5" />
          </button>
        </div> */}
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
          gradientBurn={0.1}
          blendMode='soft-light'
        >
          {/* Token inputs with swap button */}
          <div className="relative">
            {/* From Token */}
            <div className="mb-1.5">
              <TokenInput 
                label="You Send"
                balance={fromToken?.balance}
                amount={swapAmounts.from}
                onChange={(value) => setAmount('from', value)}
                tokenSymbol={fromToken?.symbol || 'XEL'}
                tokenName={fromToken?.name || 'Xel Token'}
                price={fromToken?.price}
                tickerWidth={5}
              />
            </div>

            {/* To Token */}
            <div className="mt-1.5">
              <TokenInput 
                label="You Receive"
                balance={toToken?.balance}
                amount={swapAmounts.to}
                onChange={(value) => setAmount('to', value)}
                tokenSymbol={toToken?.symbol || 'SUGG'}
                tokenName={toToken?.name || 'Suggestion Token'}
                price={toToken?.price}
                tickerWidth={5}
              />
            </div>

            {/* Circular Swap Button - positioned between inputs */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              <SwapButton
                onClick={swapTokens}
                loading={loading}
                disabled={false} // Add your disable logic here
              />
            </div>
          </div>

          {/* Spacing after inputs */}
          <div className="mt-1.5"></div>

          {/* Action Button - Connect Wallet or Swap */}
          {isConnected ? (
            <Button
              onClick={handleSwap}
              disabled={loading}
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
            >
              {loading ? 'Swapping...' : 'Swap'}
            </Button>
          ) : (
            <Button
              onClick={connectWallet}
              focusOnClick={false}
              className="
                w-full 
                bg-white 
                text-black 
                font-light
                text-[1.5rem]
                py-1 px-4 
                rounded-xl 
                transition-all duration-200
                hover:shadow-lg
                hover:ring-2 ring-forge-orange
                hover:scale-[1.015]
                active:scale-[0.98]
              "
            >
              Connect Wallet
            </Button>
          )}

          <div className="mt-2"></div>
          {/* Token Stats - only show when connected */}
          <div className="grid grid-cols-2 gap-2">
            <TokenStats 
              symbol={fromToken?.symbol || "XEL"}
              price="1.790"
              priceChange="10.13"
              color="bg-orange-500"
            />
            <TokenStats 
              symbol={toToken?.symbol || "SUGG"}
              price="1.790"
              priceChange="0.1"
              color="bg-green-500"
            />
          </div>
        </GeometricAccents>
      </div>
    </div>
  )
}

export default Trade