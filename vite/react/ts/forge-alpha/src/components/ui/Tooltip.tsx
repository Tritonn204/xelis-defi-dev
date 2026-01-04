import React, {
  memo,
  type ReactNode,
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
} from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string | ReactNode;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: 75 | 100 | 150 | 200 | 300 | 500 | 700 | 1000;
  bgColor?: string;
  textColor?: string;
  fontSize?: 'xs' | 'sm' | 'base' | 'lg';
  maxWidth?: string | number;
  className?: string;
  container?: HTMLElement;
  disabled?: boolean;
}

const TooltipComponent = ({
  content,
  children,
  position = 'top',
  delay = 500,
  bgColor = 'bg-black/90',
  textColor = 'text-white',
  fontSize = 'xs',
  maxWidth,
  className = '',
  container,
  disabled = false,
}: TooltipProps) => {
  const triggerRef = useRef<HTMLSpanElement | null>(null)

  const [open, setOpen] = useState(false)
  const [rendered, setRendered] = useState(false)

  const [coords, setCoords] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)

  const [timer, setTimer] = useState<number | null>(null)

  const fontSizeMap = {
    xs: 'text-xs',
    sm: 'text-sm',
    base: 'text-base',
    lg: 'text-lg',
  } as const

  const maxWidthValue =
    maxWidth != null
      ? typeof maxWidth === 'number'
        ? `${maxWidth}px`
        : maxWidth
      : undefined

  const readRect = () => {
    if (!triggerRef.current) return null
    const rect = triggerRef.current.getBoundingClientRect()
    return {
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height,
    }
  }

  const handleEnter = () => {
    if (disabled) return;
    const id = window.setTimeout(() => {
      const r = readRect()
      if (!r) return
      setCoords(r)
      setRendered(true)
      requestAnimationFrame(() => {
        setOpen(true)
      })
    }, Number(delay))
    setTimer(id)
  }

  const handleLeave = () => {
    if (timer) window.clearTimeout(timer)
    if (disabled) {
      setOpen(false)
      setRendered(false)
      return
    }
    setOpen(false)
    window.setTimeout(() => {
      setRendered(false)
    }, 200)
  }

  useEffect(() => {
    if (disabled) {
      if (timer) window.clearTimeout(timer)
      setOpen(false)
      setRendered(false)
    }
  }, [disabled, timer])

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const r = readRect()
      if (r) setCoords(r)
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    if (!rendered) return;

    const close = () => handleLeave();

    window.addEventListener('blur', close);
    document.addEventListener('mouseleave', close);

    return () => {
      window.removeEventListener('blur', close);
      document.removeEventListener('mouseleave', close);
    };
  }, [rendered]);

  useEffect(() => {
    if (!rendered) return;

    const checkHover = (e: MouseEvent) => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const isOver =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      if (!isOver) {
        handleLeave();
      }
    };

    window.addEventListener('mousemove', checkHover);
    return () => window.removeEventListener('mousemove', checkHover);
  }, [rendered]);

  return (
    <>
      <span
        ref={triggerRef}
        className="relative inline-block"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {children}
      </span>

      {rendered && coords &&
        createPortal(
          <TooltipBubble
            isOpen={open}
            coords={coords}
            position={position}
            content={content}
            bgColor={bgColor}
            textColor={textColor}
            fontSize={fontSizeMap[fontSize]}
            maxWidth={maxWidthValue}
            className={className}
          />,
          container || document.body
        )}
    </>
  )
}

interface TooltipBubbleProps {
  isOpen: boolean
  coords: { top: number; left: number; width: number; height: number }
  position: 'top' | 'bottom' | 'left' | 'right'
  content: ReactNode
  bgColor: string
  textColor: string
  fontSize: string
  maxWidth?: string
  className?: string
}

const TooltipBubble: React.FC<TooltipBubbleProps> = ({
  isOpen,
  coords,
  position,
  content,
  bgColor,
  textColor,
  fontSize,
  maxWidth,
  className = '',
}) => {
  const GAP = 8

  const getPositionStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      zIndex: 9999,
    }

    if (position === 'top') {
      base.left = coords.left + coords.width / 2
      base.top = coords.top - GAP
      base.transform = 'translate(-50%, -100%)'
    } else if (position === 'bottom') {
      base.left = coords.left + coords.width / 2
      base.top = coords.top + coords.height + GAP
      base.transform = 'translate(-50%, 0)'
    } else if (position === 'left') {
      base.left = coords.left - GAP
      base.top = coords.top + coords.height / 2
      base.transform = 'translate(-100%, -50%)'
    } else if (position === 'right') {
      base.left = coords.left + coords.width + GAP
      base.top = coords.top + coords.height / 2
      base.transform = 'translate(0, -50%)'
    }

    if (maxWidth) {
      base.maxWidth = maxWidth
    }

    return base
  }

  const getArrowClasses = () => {
    const baseArrow = 'absolute w-0 h-0 border-transparent';

    switch (position) {
      case 'top':
        return `${baseArrow} left-1/2 transform -translate-x-1/2 top-full border-l-4 border-r-4 border-t-4`;
      case 'bottom':
        return `${baseArrow} left-1/2 transform -translate-x-1/2 bottom-full border-l-4 border-r-4 border-b-4`;
      case 'left':
        return `${baseArrow} top-1/2 transform -translate-y-1/2 left-full border-t-4 border-b-4 border-l-4`;
      case 'right':
        return `${baseArrow} top-1/2 transform -translate-y-1/2 right-full border-t-4 border-b-4 border-r-4`;
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
    <div
      className={`
        px-2 py-1 ${fontSize} ${textColor} ${bgColor}
        backdrop-blur-sm rounded
        transition-opacity duration-200
        pointer-events-none ${maxWidth ? 'whitespace-normal' : 'whitespace-nowrap'}
        ${isOpen ? 'opacity-100' : 'opacity-0'}
        ${className}
      `}
      style={getPositionStyle()}
    >
      {content}
      <div className={`${getArrowClasses()} ${getArrowColorClass()}`} />
    </div>
  )
}

const Tooltip = memo(TooltipComponent)
Tooltip.displayName = 'Tooltip'

export default Tooltip;
