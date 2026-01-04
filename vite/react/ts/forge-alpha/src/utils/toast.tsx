import toast from 'react-hot-toast'
import { CheckCircle2, XCircle, Info, Send, AlertTriangle, ExternalLink, X } from 'lucide-react'
import Button from '@/components/ui/Button'

interface CustomToastOptions {
  duration?: number
  txHash?: string
  explorerUrl?: string
}

// Custom toast wrapper with styled components
const customToast = (
  message: string,
  type: 'success' | 'error' | 'info' | 'submit' | 'warning',
  options?: CustomToastOptions
) => {
  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />,
    error: <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />,
    info: <Info className="w-5 h-5 text-blue-400 flex-shrink-0" />,
    submit: <Send className="w-5 h-5 text-forge-orange flex-shrink-0" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
  }

  const borderColors = {
    success: 'border-green-400/30',
    error: 'border-red-400/30',
    info: 'border-blue-400/30',
    submit: 'border-forge-orange/30',
    warning: 'border-yellow-400/30'
  }

  const txLink = options?.txHash && options?.explorerUrl
    ? `${options.explorerUrl}/tx/${options.txHash}`
    : null

  toast.custom(
    (t) => (
      <div
        className={`
          bg-black/90 backdrop-blur-xl rounded-2xl p-4 border-2 ${borderColors[type]}
          shadow-2xl transition-all duration-300 ease-out
          ${t.visible ? 'animate-enter' : 'animate-leave'}
          max-w-md relative
        `}
        style={{
          animation: t.visible
            ? 'toast-enter 0.3s ease-out'
            : 'toast-leave 0.2s ease-in forwards'
        }}
      >
        <div className="absolute top-2 right-2">
          <Button
            onClick={() => toast.dismiss(t.id)}
            className="text-white/30 hover:text-white transition-colors w-5 h-5 min-w-0 p-0"
            focusOnClick={false}
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-start space-x-3 pr-6">
          <div className="mt-0.5">{icons[type]}</div>
          <div className="flex-1">
            <p className="text-white text-sm leading-relaxed">{message}</p>
            {txLink && (
              <a
                href={txLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-xs text-forge-orange hover:text-forge-orange/80 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                View Transaction
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    ),
    {
      duration: options?.duration || (type === 'error' ? 6000 : type === 'success' ? 12000 : 4000),
      position: 'bottom-right'
    }
  )
}

export const showSuccessToast = (message: string, options?: CustomToastOptions) => {
  customToast(message, 'success', options)
}

export const showErrorToast = (message: string, options?: CustomToastOptions) => {
  customToast(message, 'error', options)
}

export const showInfoToast = (message: string, options?: CustomToastOptions) => {
  customToast(message, 'info', options)
}

export const showSubmitToast = (message: string = 'Transaction submitted to network', options?: CustomToastOptions) => {
  customToast(message, 'submit', { duration: 3000, ...options })
}

export const showWarningToast = (message: string, options?: CustomToastOptions) => {
  customToast(message, 'warning', options)
}
