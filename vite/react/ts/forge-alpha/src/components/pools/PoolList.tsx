import React, { useEffect, useState } from 'react'

import { TokenIcon } from '../ui/TokenIcon';
import { formatCompactNumber } from '../../utils/number';
import { PoolData } from '@/contexts/PoolContext';
import { useWallet } from '@/contexts/WalletContext';

interface PoolListProps {
  pools?: Map<string, PoolData>;
}

export const PoolList = ({
  pools = new Map<string, PoolData>()
}: PoolListProps) => {
  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set());

  const { isConnected } = useWallet()

  const togglePool = (key: string) => {
    setExpandedPools(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const poolEntries = Array.from(pools.entries());

  if (poolEntries.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400">
        No active pools found
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {poolEntries.map(([key, pool]) => {
        const isExpanded = expandedPools.has(key);

        return (
          <div
            key={key}
            onClick={() => togglePool(key)}
            className="bg-black/70 rounded-xl px-2 py-2 border border-white/12 hover:border-white/30 transition-all cursor-pointer overflow-hidden"
          >
            {/* Top row: Info + Icons + My Share */}
            <div className="relative min-h-14 flex items-center">
              {/* Left: Pool Info */}
              <div className="ml-2 z-10">
                <div className="text-white font-medium">{pool.name}</div>
                <div className="text-forge-orange text-sm">
                  TVL: ${pool.tvl.toLocaleString()}
                </div>
              </div>

              {/* Center: Diagonal Icons */}
              <div className="absolute left-1/2 -translate-x-1/2 z-0">
                <div className="relative w-fit h-fit">
                  <div className="-ml-4">
                    <TokenIcon tokenSymbol={pool.tickers[0]} tokenHash={pool.hashes[0]} tokenName={pool.names[0]} size={39} />
                  </div>
                  <div className="-mt-2.5 -mr-4">
                    <TokenIcon tokenSymbol={pool.tickers[1]} tokenHash={pool.hashes[1]} tokenName={pool.names[1]} size={39} />
                  </div>
                </div>
              </div>

              {/* Right: My Share */}
              <div className="ml-auto mr-2 text-right text-forge-orange text-md z-10">
                LP Share: <span className={`${isConnected ? 'text-white' : 'text-white/20'} font-bold text-md`}>{pool.userShare ?? '--'}%</span>
              </div>
            </div>

            {/* Expandable section */}
            <div
              className={`transition-all duration-300 ease-in-out overflow-hidden ${
                isExpanded ? 'max-h-40 mt-3 opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="bg-black/50 rounded-md p-2 text-sm text-gray-300 space-y-1">
                {pool.locked.map((amount, index) => {
                  const symbol = pool.tickers[index];
                  const formatted = formatCompactNumber(amount);
                  return (
                    <div key={index}>
                      {symbol} – {formatted}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PoolList;