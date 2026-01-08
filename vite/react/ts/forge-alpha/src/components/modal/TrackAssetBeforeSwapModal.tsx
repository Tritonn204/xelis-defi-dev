import { Eye } from 'lucide-react'
import Button from '../ui/Button'

interface TrackAssetBeforeSwapModalProps {
  isOpen: boolean
  onTrack: () => void
  onSkip: () => void
  assetSymbol: string
  assetName?: string
}

const TrackAssetBeforeSwapModal = ({
  isOpen,
  onTrack,
  onSkip,
  assetSymbol,
  assetName
}: TrackAssetBeforeSwapModalProps) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onSkip}
      />

      {/* Modal */}
      <div className="relative bg-black/90 border-2 border-forge-orange/30 rounded-2xl w-full max-w-md mx-4 p-6">
        <div className="flex flex-col space-y-4">
          {/* Icon and Title */}
          <div className="flex items-center space-x-3">
            <div className="bg-forge-orange/10 p-3 rounded-xl">
              <Eye className="w-6 h-6 text-forge-orange" />
            </div>
            <h2 className="text-xl font-semibold text-white">
              Track Asset Balance?
            </h2>
          </div>

          {/* Message */}
          <div className="space-y-3">
            <p className="text-gray-300 leading-relaxed">
              <span className="text-white font-semibold">{assetSymbol}</span>
              {assetName && ` (${assetName})`} is not currently tracked in your wallet.
            </p>

            <div className="bg-forge-orange/5 border border-forge-orange/20 rounded-xl p-4">
              <p className="text-gray-300 text-sm">
                Tracking this asset will allow you to see your balance for it in your wallet and across Forge. You can track it now or skip this step.
              </p>
            </div>

            <p className="text-gray-400 text-sm">
              Would you like to track this asset before swapping?
            </p>
          </div>

          {/* Buttons */}
          <div className="flex space-x-3 pt-2">
            <Button
              onClick={onSkip}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white border-2 border-forge-orange/30 rounded-xl py-2 px-4 transition-all duration-200 hover:scale-[1.015] active:scale-[0.98]"
              focusOnClick={false}
            >
              Skip
            </Button>
            <Button
              onClick={onTrack}
              className="flex-1 bg-forge-orange hover:bg-forge-orange/90 text-white rounded-xl py-1 px-4 transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98] font-medium"
              focusOnClick={false}
            >
              Track & Swap
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TrackAssetBeforeSwapModal
