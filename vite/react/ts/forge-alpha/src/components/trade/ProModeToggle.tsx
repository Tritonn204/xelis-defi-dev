import { useForge } from '@/contexts/ForgeContext'
import React, { memo } from 'react'
import Button from '../ui/Button'
import Tooltip from '../ui/Tooltip'

interface ProModeToggleProps {
  // where it's going to live; defaults to header-friendly
  variant?: 'ghost' | 'solid'
  className?: string
}

export const ProModeToggle: React.FC<ProModeToggleProps> = ({
  variant = 'ghost',
  className = '',
}) => {
  const { isProMode, toggleProMode } = useForge();

  const base =
    'inline-flex items-center gap-1 rounded-md text-xs font-medium transition-all duration-150'

  const variants = {
    // good for a header row that already has background
    ghost: 'bg-white/5 text-white hover:bg-white/10 px-2 py-1 border border-white/5',
    // good if it’s floating over content
    solid: isProMode
      ? 'bg-forge-orange text-black hover:bg-forge-orange/90 px-2.5 py-1'
      : 'bg-black/50 text-white hover:bg-black/70 px-2.5 py-1 border border-forge-orange/30',
  }

  return (
    <Tooltip content={`Switch to ${isProMode ? 'Lite' : 'Pro'} mode`} position='left' delay={1000}>
      <Button
        type="button"
        onClick={() => {toggleProMode()}}
        className={`${base} ${variants[variant]} ${className}`}
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isProMode ? (
            <>
              {/* simple icon */}
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="12" cy="12" r="3" />
            </>
          ) : (
            <>
              {/* pro icon */}
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </>
          )}
        </svg>
        {/* hide label on v small screens */}
        <span className="hidden sm:inline">
          {isProMode ? 'Lite' : 'Pro'}
        </span>
      </Button>
    </Tooltip>
  )
}

export default memo(ProModeToggle);
