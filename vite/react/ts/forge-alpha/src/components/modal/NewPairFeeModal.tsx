import { AlertTriangle } from 'lucide-react'
import Button from '../ui/Button'

interface NewPairFeeModalProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  token1Symbol: string
  token2Symbol: string
}

const NewPairFeeModal = ({
  isOpen,
  onConfirm,
  onCancel,
  token1Symbol,
  token2Symbol
}: NewPairFeeModalProps) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-black/90 border-2 border-forge-orange/30 rounded-2xl w-full max-w-md mx-4 p-6">
        <div className="flex flex-col space-y-4">
          {/* Icon and Title */}
          <div className="flex items-center space-x-3">
            <div className="bg-forge-orange/10 p-3 rounded-xl">
              <AlertTriangle className="w-6 h-6 text-forge-orange" />
            </div>
            <h2 className="text-xl font-semibold text-white">
              New Pair Creation
            </h2>
          </div>

          {/* Message */}
          <div className="space-y-3">
            <p className="text-gray-300 leading-relaxed">
              This is a <span className="text-white font-medium">new liquidity pair</span> for{' '}
              <span className="text-forge-orange">{token1Symbol}</span> and{' '}
              <span className="text-forge-orange">{token2Symbol}</span>.
            </p>

            <div className="bg-forge-orange/5 border border-forge-orange/20 rounded-xl p-4">
              <p className="text-gray-200 text-sm leading-relaxed">
                Creating a new pair requires minting a new LP asset, which has a protocol fee of{' '}
                <span className="text-white font-semibold">1 XEL</span>.
              </p>
            </div>

            <p className="text-gray-400 text-sm">
              This one-time fee will be added to your transaction deposits.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex space-x-3 pt-2">
            <Button
              onClick={onCancel}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white border-2 border-forge-orange/30 rounded-xl py-2 px-4 transition-all duration-200 hover:scale-[1.015] active:scale-[0.98]"
              focusOnClick={false}
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              className="flex-1 bg-forge-orange hover:bg-forge-orange/90 text-white rounded-xl py-1 px-4 transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98] font-medium"
              focusOnClick={false}
            >
              Proceed
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NewPairFeeModal
