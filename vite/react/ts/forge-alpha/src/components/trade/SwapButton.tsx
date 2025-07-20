import React from 'react'

const SwapButton = ({ onClick, loading, disabled }) => {
  const handleClick = (e) => {
    if (!disabled && !loading && onClick) {
      onClick(e);
    }
  };
  
  return (
    <div
      onClick={handleClick}
      className={`
        w-12 h-12
        bg-black 
        ${disabled ? 'bg-forge-swap cursor-not-allowed' : 'hover:bg-forge-orange/90 cursor-pointer'}
        rounded-full 
        flex items-center justify-center
        border-1 border-white/5
        ${!disabled && 'hover:border-white/20'}
        shadow-lg
        transition-all duration-300 ease-out
        ${!disabled && 'hover:scale-110 active:scale-105'}
        group
        select-none
      `}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
    >
      {loading ? (
        <svg 
          className="animate-spin h-5 w-5 text-white" 
          xmlns="http://www.w3.org/2000/svg" 
          fill="none" 
          viewBox="0 0 24 24"
        >
          <circle 
            className="opacity-25" 
            cx="12" 
            cy="12" 
            r="10" 
            stroke="currentColor" 
            strokeWidth="4"
          />
          <path 
            className="opacity-75" 
            fill="currentColor" 
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        <svg 
          width="22" 
          height="22" 
          viewBox="0 0 24 24" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          className="text-white transition-transform duration-300 group-hover:rotate-180"
        >
          <path 
            d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  )
}

export default SwapButton