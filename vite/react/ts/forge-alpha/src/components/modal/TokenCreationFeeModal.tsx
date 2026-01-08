import { useState, useEffect } from 'react'
import { Coins } from 'lucide-react'
import Button from '../ui/Button'

interface TokenCreationFeeModalProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  storageKey?: string
}

const TokenCreationFeeModal = ({
  isOpen,
  onConfirm,
  onCancel,
  storageKey = 'token_creation_fee'
}: TokenCreationFeeModalProps) => {
  const [doNotShowAgain, setDoNotShowAgain] = useState(false)

  useEffect(() => {
    // Reset checkbox when modal opens
    if (isOpen) {
      setDoNotShowAgain(false)
    }
  }, [isOpen])

  const handleConfirm = () => {
    if (storageKey && doNotShowAgain) {
      localStorage.setItem(`hideDisclaimer_${storageKey}`, 'true')
    }
    onConfirm()
  }

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
              <Coins className="w-6 h-6 text-forge-orange" />
            </div>
            <h2 className="text-xl font-semibold text-white">
              Token Creation Fees
            </h2>
          </div>

          {/* Message */}
          <div className="space-y-3">
            <p className="text-gray-300 leading-relaxed">
              Creating a new token on the Xelis blockDAG with Forge requires two separate fees:
            </p>

            <div className="bg-forge-orange/5 border border-forge-orange/20 rounded-xl p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-200 text-sm">Xelis Protocol Fee:</span>
                <span className="text-white font-semibold">1 XEL</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-200 text-sm">Forge Platform Fee:</span>
                <span className="text-white font-semibold">1 XEL</span>
              </div>
              <div className="border-t border-forge-orange/20 pt-3 flex justify-between items-center">
                <span className="text-white font-medium">Total Fee:</span>
                <span className="text-forge-orange font-bold text-lg">2 XEL</span>
              </div>
            </div>

            <p className="text-gray-400 text-sm">
              These fees will be automatically added to your transaction deposits.
            </p>
          </div>

          {/* Don't show again checkbox */}
          {storageKey && (
            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={doNotShowAgain}
                onChange={(e) => setDoNotShowAgain(e.target.checked)}
                className="form-checkbox h-4 w-4 text-forge-orange bg-white/10 border-white/20 rounded focus:ring-forge-orange focus:ring-offset-0"
              />
              <span>Don't show this again</span>
            </label>
          )}

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
              onClick={handleConfirm}
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

export default TokenCreationFeeModal
