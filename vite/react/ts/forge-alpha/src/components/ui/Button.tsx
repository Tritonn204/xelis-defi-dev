const Button = ({ 
  children, 
  onClick, 
  className = '', 
  disabled = false,
  focusOnClick = true,
  type = 'button',
  isLoading = false,
  loadingText = null,
  staticSize = false,
  ...props 
}) => {
  const handleClick = (e) => {
    if (disabled || isLoading) return;
    
    if (!focusOnClick) {
      e.preventDefault();
      e.currentTarget.blur();
    }
    
    onClick?.(e);
  };

  // Simple spinner component
  const Spinner = () => (
    <svg 
      className="animate-spin h-5 w-5" 
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
  );

  return (
    <div
      role="button"
      tabIndex={disabled || isLoading ? -1 : 0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled && !isLoading) {
          e.preventDefault();
          handleClick(e);
        }
      }}
      className={`
        ${className}
        ${disabled || isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        select-none
        outline-none
        focus:ring-2
        inline-flex
        items-center
        justify-center
        gap-2
        relative
      `}
      aria-disabled={disabled || isLoading}
      aria-busy={isLoading}
      {...props}
    >
      {staticSize && isLoading ? (
        <>
          {/* Keep original content for size but make it invisible */}
          <span className="opacity-0">{children}</span>
          {/* Absolutely position the spinner in the center */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </div>
        </>
      ) : isLoading ? (
        <>
          <Spinner />
          {loadingText && <span>{loadingText}</span>}
        </>
      ) : (
        children
      )}
    </div>
  );
};

export default Button;