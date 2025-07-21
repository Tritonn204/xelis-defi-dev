import React from 'react'
import { stringToColor } from '@/utils/strings'
import logoMap from '@/utils/tokenLogos'

interface TokenIconProps {
  tokenSymbol: string
  tokenName: string
  tokenHash?: string
  size?: number
}

export const TokenIcon = ({
  tokenSymbol,
  tokenName,
  tokenHash,
  size = 24,
}: TokenIconProps) => {
  const key = (tokenHash || tokenSymbol).toLowerCase()
  const logoSrc = logoMap[key]

  const tokenColor = stringToColor(tokenSymbol + tokenName)
  const firstLetter = tokenSymbol?.charAt(0) || '?'
  const fontSize = size * 0.45

  return (
    <div
      className="relative z-0 rounded-full"
      style={{ width: size, height: size }}
    >
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={tokenSymbol}
          className="absolute top-0 left-0 w-full h-full object-cover rounded-full z-0"
        />
      ) : (
        <div
          className="absolute top-0 left-0 flex items-center justify-center text-white font-bold z-0"
          style={{
            backgroundColor: tokenColor,
            width: size,
            height: size,
            fontSize,
            borderRadius: '9999px',
          }}
        >
          {firstLetter}
        </div>
      )}
    </div>
  )
}

export default TokenIcon
