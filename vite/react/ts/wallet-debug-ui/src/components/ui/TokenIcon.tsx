import React, { useState } from 'react'
import { stringToColor } from '@/utils/strings'
import logoMap from '@/utils/tokenLogos'
import { usePools } from '@/contexts/PoolContext'

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

  const tokenColor = stringToColor(tokenSymbol + tokenName)
  const firstLetter = tokenSymbol?.charAt(0) || '?'
  const fontSize = size * 0.45

  const [imgError, setImgError] = useState(false)

  return (
    <div
      className="relative z-0 rounded-full"
      style={{ width: size, height: size }}
    >
      {
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
      }
    </div>
  )
}

export default TokenIcon
