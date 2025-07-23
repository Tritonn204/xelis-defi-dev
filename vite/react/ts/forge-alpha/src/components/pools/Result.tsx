import React from 'react'
import Button from '../ui/Button'
import { PoolListScreenProps } from './PoolListScreen'

interface ResultScreenProps {
  type: 'success' | 'error'
  title: string
  message?: string
  txHash?: string
  error?: string
  onPrimary: () => void
  onSecondary?: () => void
  primaryLabel: string
  secondaryLabel?: string,
}

const ResultScreen: React.FC<ResultScreenProps> = ({
  type,
  title,
  message,
  txHash,
  error,
  onPrimary,
  onSecondary,
  primaryLabel,
  secondaryLabel
}) => {
  const isSuccess = type === 'success'

  return (
    <div className="text-center py-6">
      <div className={`text-3xl mb-4 ${isSuccess ? 'text-green-400' : 'text-red-500'}`}>
        {isSuccess ? '✓' : '✗'}
      </div>

      <h2 className="text-xl font-semibold text-white mb-3">{title}</h2>

      {message && <div className="text-gray-400 mb-4">{message}</div>}
      {txHash && <div className="text-gray-400 mb-4 break-all">{txHash}</div>}
      {error && <div className="text-red-400 mb-4">{error}</div>}

      <div className="flex flex-col space-y-3">
        <Button
          onClick={onPrimary}
          focusOnClick={false}
          className="
            w-full 
            bg-forge-orange 
            hover:bg-forge-orange/90 
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
          {primaryLabel}
        </Button>

        {onSecondary && secondaryLabel && (
          <Button
            onClick={onSecondary}
            focusOnClick={false}
            className="
              w-full 
              bg-transparent
              border border-white/20
              hover:bg-white/10
              text-white 
              font-light
              text-[1.5rem]
              py-1 px-4 
              rounded-xl 
              transition-all duration-200
            "
          >
            {secondaryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

export default ResultScreen
