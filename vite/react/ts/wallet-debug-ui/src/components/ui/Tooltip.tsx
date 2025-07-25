import { ReactNode } from 'react';

interface TooltipProps {
  content: string | ReactNode;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: 75 | 100 | 150 | 200 | 300 | 500 | 700 | 1000;
  bgColor?: string;
  textColor?: string;
  fontSize?: 'xs' | 'sm' | 'base' | 'lg';
  className?: string;
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
    switch (position) {
      case 'top':
        return 'bottom-full left-1/2 transform -translate-x-1/2 mb-2';
      case 'bottom':
        return 'top-full left-1/2 transform -translate-x-1/2 mt-2';
      case 'left':
        return 'right-full top-1/2 transform -translate-y-1/2 mr-2';
      case 'right':
        return 'left-full top-1/2 transform -translate-y-1/2 ml-2';
    }
  };

  const getArrowClasses = () => {
    const baseArrow = 'absolute w-0 h-0 border-transparent';

    switch (position) {
      case 'top':
        return `${baseArrow} left-1/2 transform -translate-x-1/2 top-full border-l-4 border-r-4 border-t-4`;
      case 'bottom':
        return `${baseArrow} left-1/2 transform -translate-x-1/2 bottom-full border-l-4 border-r-4 border-b-4`;
      case 'left':
        return `${baseArrow} top-1/2 transform -translate-y-1/2 right-0 border-t-4 border-b-4 border-l-4`;
      case 'right':
        return `${baseArrow} top-1/2 transform -translate-y-1/2 left-0 border-t-4 border-b-4 border-r-4`;
    }
  };

  const getArrowColorClass = () => {
    if (bgColor.includes('/')) {
      const [color] = bgColor.split('/');
      switch (position) {
        case 'top': return `border-t-${color}/90`;
        case 'bottom': return `border-b-${color}/90`;
        case 'left': return `border-l-${color}/90`;
        case 'right': return `border-r-${color}/90`;
      }
    }

    const colorName = bgColor.replace('bg-', '');
    switch (position) {
      case 'top': return `border-t-${colorName}`;
      case 'bottom': return `border-b-${colorName}`;
      case 'left': return `border-l-${colorName}`;
      case 'right': return `border-r-${colorName}`;
    }
  };

  return (
    <div className="relative group inline-block">
      {children}

      <div
        className={`
          absolute ${getPositionClasses()}
          px-2 py-1 text-${fontSize} ${textColor} ${bgColor}
          backdrop-blur-sm rounded
          opacity-0 group-hover:opacity-100
          transition-opacity duration-200
          pointer-events-none whitespace-nowrap z-50
          group-hover:delay-${delay}
          ${className}
        `}
      >
        {content}
        <div className={`${getArrowClasses()} ${getArrowColorClass()}`} />
      </div>
    </div>
  );
};

export default Tooltip;
