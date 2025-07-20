import React, { useRef, useEffect, useState } from 'react'

const GeometricAccents = ({ 
  children, 
  className = '',
  accentWidth = 6,
  gap = 12,
  tipExtension = 40,
  tipAngle = 68, // angle in degrees
  variant = 'orange',
  alpha = 1.0,
  glassEffect = false,
  gradient = false,
  gradientBurn = 0.3,
  blendMode = 'normal',
  isLoading = false
}) => {
  const contentRef = useRef(null)
  const [contentHeight, setContentHeight] = useState(0)
  
  useEffect(() => {
    if (contentRef.current) {
      const element = contentRef.current
      
      const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          if (entry.target === element) {
            setContentHeight(entry.contentRect.height)
          }
        }
      })
      
      resizeObserver.observe(element)
      
      return () => {
        resizeObserver.unobserve(element)
        resizeObserver.disconnect()
      }
    }
  }, [])

  const variants = {
    orange: '#ff4902',
    blue: '#4a90e2',
    purple: '#8b5cf6',
    green: '#10b981',
    white: '#ffffff',
    gray: '#6b7280',
    brown: '#6e3b31'
  }

  const color = variants[variant] || variants.orange

  // Calculate tip x-offset for the specified angle
  const angleRadians = (90 - tipAngle) * (Math.PI / 180)
  const tipXOffset = tipExtension * Math.tan(angleRadians)
  
  // Calculate miter offset for y-coordinate
  const miterYOffset = accentWidth / (2 * Math.tan(tipAngle * Math.PI / 180))
  
  // SVG width needs to accommodate the tip extension
  const svgWidth = accentWidth + Math.abs(tipXOffset)

  // Left side with mitered joints
  const leftTipPath = `
    M ${Math.abs(tipXOffset)},${tipExtension + miterYOffset}
    L ${Math.abs(tipXOffset) + (accentWidth/2) - tipXOffset},0
    L ${Math.abs(tipXOffset) + accentWidth},${tipExtension}
    L ${Math.abs(tipXOffset) + accentWidth},${tipExtension + contentHeight}
    L ${Math.abs(tipXOffset) + (accentWidth/2) - tipXOffset},${(2 * tipExtension) + contentHeight}
    L ${Math.abs(tipXOffset)},${tipExtension + contentHeight - miterYOffset}
    Z
  `

  // Right side with mitered joints (mirror of left)
  const rightTipPath = `
    M ${accentWidth},${tipExtension + miterYOffset}
    L ${(accentWidth/2) + tipXOffset},0
    L 0,${tipExtension}
    L 0,${tipExtension + contentHeight}
    L ${(accentWidth/2) + tipXOffset},${(2 * tipExtension) + contentHeight}
    L ${accentWidth},${tipExtension + contentHeight - miterYOffset}
    Z
  `

  const darkenColor = (hex, percent = 0.3) => {
    const num = parseInt(hex.slice(1), 16)
    const r = Math.floor((num >> 16) * (1 - percent))
    const g = Math.floor(((num >> 8) & 0x00FF) * (1 - percent))
    const b = Math.floor((num & 0x0000FF) * (1 - percent))
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`
  }

  const darkColor = darkenColor(color, gradientBurn)
  const gradientId = `gradient-${Math.random().toString(36).substr(2, 9)}`
  
  // Use gradient or solid color
  const fillColor = gradient ? `url(#${gradientId})` : color

  return (
    <div className={`relative flex items-center ${className}`}>
      {/* Left accent */}
      <div className="relative" style={{ marginRight: gap, height: contentHeight }}>
        <svg 
          width={svgWidth} 
          height={contentHeight + (2 * tipExtension)}
          className="absolute"
          style={{ 
            top: -tipExtension, 
            right: 0,
            opacity: alpha,
            mixBlendMode: blendMode
          }}
        >
          {gradient && (
            <defs>
              <linearGradient id={gradientId} x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor={color} />
                <stop offset="100%" stopColor={darkColor} />
              </linearGradient>
            </defs>
          )}
          <path
            d={leftTipPath}
            fill={fillColor}
            className={isLoading ? 'fill-pulse' : ''}
          />
        </svg>
      </div>
      
      {/* Content */}
      <div ref={contentRef} className="flex-grow">
        {children}
      </div>
      
      {/* Right accent */}
      <div className="relative" style={{ marginLeft: gap, height: contentHeight }}>
        <svg 
          width={svgWidth} 
          height={contentHeight + (2 * tipExtension)}
          className="absolute"
          style={{ 
            top: -tipExtension, 
            left: 0,
            opacity: alpha,
            mixBlendMode: blendMode
          }}
        >
          {gradient && (
            <defs>
              <linearGradient id={`${gradientId}-right`} x1="-20%" y1="0%" x2="-20%" y2="100%">
                <stop offset="0%" stopColor={color} />
                <stop offset="100%" stopColor={darkColor} />
              </linearGradient>
            </defs>
          )}
          <path 
            d={rightTipPath} 
            fill={gradient ? `url(#${gradientId}-right)` : color}
            className={isLoading ? 'fill-pulse' : ''}
          />
        </svg>
      </div>
    </div>
  )
}

export default GeometricAccents