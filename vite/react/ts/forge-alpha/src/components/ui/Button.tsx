const Button = ({ 
  children, 
  onClick, 
  className = '', 
  disabled = false,
  focusOnClick = true,
  type = 'button',
  ...props 
}) => {
  const handleClick = (e) => {
    if (disabled) return;
    
    if (!focusOnClick) {
      e.preventDefault();
      e.currentTarget.blur();
    }
    
    onClick?.(e);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          handleClick(e);
        }
      }}
      className={`
        ${className}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        select-none
        outline-none
        focus:ring-2
      `}
      aria-disabled={disabled}
      {...props}
    >
      {children}
    </div>
  );
};

export default Button;