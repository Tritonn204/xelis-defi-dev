import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import Button from '../ui/Button'

interface LargeSupplyWarningModalProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  storageKey?: string
}

const LargeSupplyWarningModal = ({
  isOpen,
  onConfirm,
  onCancel,
  storageKey = 'large_supply_warning'
}: LargeSupplyWarningModalProps) => {
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
      <div className="relative bg-black/90 border-2 border-yellow-500/30 rounded-2xl w-full max-w-md mx-4 p-6">
        <div className="flex flex-col space-y-4">
          {/* Icon and Title */}
          <div className="flex items-center space-x-3">
            <div className="bg-yellow-500/10 p-3 rounded-xl">
              <AlertTriangle className="w-6 h-6 text-yellow-500" />
            </div>
            <h2 className="text-xl font-semibold text-white">
              Large Initial Supply Warning
            </h2>
          </div>

          {/* Message */}
          <div className="space-y-3">
            <p className="text-gray-300 leading-relaxed">
              Your token has a very large initial supply. Balances this large may take longer to decode in wallets, which could impact user experience.
            </p>

            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 space-y-2">
              <div className="flex items-start space-x-2">
                <span className="text-yellow-500 font-semibold text-sm mt-0.5">⚡</span>
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">Recommended Alternative:</p>
                  <p className="text-gray-300 text-sm mt-1">
                    Consider using a <span className="text-yellow-500 font-semibold">mintable token with a max supply</span> instead. This allows you to handle smaller amounts initially and mint more as needed, providing better wallet performance.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-gray-400 text-sm">
              You can still proceed with this configuration if you understand the potential performance implications.
            </p>
          </div>

          {/* Don't show again checkbox */}
          {storageKey && (
            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={doNotShowAgain}
                onChange={(e) => setDoNotShowAgain(e.target.checked)}
                className="form-checkbox h-4 w-4 text-yellow-500 bg-white/10 border-white/20 rounded focus:ring-yellow-500 focus:ring-offset-0"
              />
              <span>Don't show this again</span>
            </label>
          )}

          {/* Buttons */}
          <div className="flex space-x-3 pt-2">
            <Button
              onClick={onCancel}
              className="flex-1 bg-white/5 hover:bg-white/10 text-white border-2 border-yellow-500/30 rounded-xl py-2 px-4 transition-all duration-200 hover:scale-[1.015] active:scale-[0.98]"
              focusOnClick={false}
            >
              Go Back
            </Button>
            <Button
              onClick={handleConfirm}
              className="flex-1 bg-yellow-500 hover:bg-yellow-500/90 text-black rounded-xl py-1 px-4 transition-all duration-200 hover:shadow-lg hover:ring-2 ring-white hover:scale-[1.015] active:scale-[0.98] font-medium"
              focusOnClick={false}
            >
              Proceed Anyway
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LargeSupplyWarningModal
