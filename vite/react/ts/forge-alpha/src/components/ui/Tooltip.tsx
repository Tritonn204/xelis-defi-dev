import { ReactNode } from 'react'

interface TooltipProps {
  content: string | ReactNode
  children: ReactNode
  position?: 'top' | 'bottom'
  delay?: 75 | 100 | 150 | 200 | 300 | 500 | 700 | 1000
  bgColor?: string
  textColor?: string
  fontSize?: 'xs' | 'sm' | 'base' | 'lg'
  className?: string
}

const Tooltip = ({ 
  content, 
  children, 
  position = 'top',
  delay = 500,
  bgColor = 'bg-black/90',
  textColor = 'text-white',
  fontSize = 'xs',
  className = ''
}: TooltipProps) => {
  
  const getPositionClasses = () => {
    return position === 'top' 
      ? 'bottom-full left-1/2 transform -translate-x-1/2 mb-2'
      : 'top-full left-1/2 transform -translate-x-1/2 mt-2'
  }

  const getArrowClasses = () => {
    const baseArrowClasses = 'absolute left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-transparent'
    
    if (position === 'top') {
      return `${baseArrowClasses} top-full border-t-2`
    } else {
      return `${baseArrowClasses} bottom-full border-b-2`
    }
  }

  // Extract color value for arrow (handles both regular colors and colors with opacity)
  const getArrowColorClass = () => {
    // For classes like 'bg-black/90', we need to construct the border color manually
    if (bgColor.includes('/')) {
      const [color] = bgColor.split('/')
      return position === 'top' 
        ? `border-t-black/90` 
        : `border-b-black/90`
    }
    
    // For regular color classes like 'bg-gray-800'
    const colorName = bgColor.replace('bg-', '')
    return position === 'top' 
      ? `border-t-${colorName}` 
      : `border-b-${colorName}`
  }

  return (
    <div className="relative group inline-block">
      {children}
      
      {/* Tooltip */}
      <div 
        className={`
          absolute ${getPositionClasses()} 
          px-2 py-1 
          text-${fontSize} ${textColor} ${bgColor} 
          backdrop-blur-sm rounded 
          opacity-0 group-hover:opacity-100 
          transition-opacity duration-200 
          pointer-events-none whitespace-nowrap z-50 
          group-hover:delay-${delay}
          ${className}
        `}
      >
        {content}
        <div className={`${getArrowClasses()} ${getArrowColorClass()}`}></div>
      </div>
    </div>
  )
}

export default Tooltip