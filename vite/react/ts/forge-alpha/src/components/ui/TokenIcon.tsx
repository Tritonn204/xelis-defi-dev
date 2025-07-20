import React from 'react';
import { stringToColor } from '../../utils/strings'

interface TokenIconProps {
  tokenSymbol: string;
  tokenName: string;
  size?: number;
}

export const TokenIcon = ({
  tokenSymbol,
  tokenName,
  size = 24,
}: TokenIconProps) => {
  const tokenColor = stringToColor(tokenSymbol + tokenName);
  const firstLetter = tokenSymbol?.charAt(0) || '?';

  const fontSize = size * 0.45;

  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold"
      style={{
        backgroundColor: tokenColor,
        width: size,
        height: size,
        fontSize,
      }}
    >
      {firstLetter}
    </div>
  );
};

export default TokenIcon;