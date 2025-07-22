import React, { useEffect, useState } from 'react'

import { ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react'

import { TokenIcon } from '../ui/TokenIcon';
import { formatCompactNumber } from '../../utils/number';
import { PoolData, usePools } from '@/contexts/PoolContext';
import { useWallet } from '@/contexts/WalletContext';
import { usePrices } from '@/contexts/PriceContext';
import { NATIVE_ASSET_HASH } from '@/contexts/NodeContext';

import Decimal from 'decimal.js';
import Button from '../ui/Button';
import Tooltip from '../ui/Tooltip';

interface PoolListProps {
  pools?: Map<string, PoolData>;
}

const d10 = new Decimal(10)

export const PoolList = ({
  pools = new Map<string, PoolData>()
}: PoolListProps) => {
  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set());

  const { isConnected } = useWallet()
  const { poolTVLs } = usePrices()

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

  const [searchTerm, setSearchTerm] = useState('');
  const [showNonXel, setshowNonXel] = useState(false);
  const [sortBy, setSortBy] = useState<'TVL' | 'Share'>('TVL');
  const [sortAsc, setSortAsc] = useState(false);

  const filterAndSortPools = () => {
    return [...poolEntries]
      .filter(([_, pool]) => {
        const q = searchTerm.toLowerCase();
        return (
          pool.name.toLowerCase().includes(q) ||
          pool.names.some(name => name.toLowerCase().includes(q)) ||
          pool.hashes.some(hash => hash.toLowerCase().includes(q))
        );
      })
      .filter(([_, pool]) => {
        if (showNonXel) return true;
        return pool.hashes.includes(NATIVE_ASSET_HASH);
      })
      .sort((a, b) => {
        const key = sortBy === 'TVL' ? poolTVLs : new Map(poolEntries.map(([k, p]) => [k, p.userShare ?? 0]));
        const aVal = key.get(a[0]) as number ?? 0;
        const bVal = key.get(b[0]) as number ?? 0;
        return sortAsc ? aVal - bVal : bVal - aVal;
      });
  };

  return (
    <div className="space-y-1 w-full max-w-5xl mx-auto ">
      {/* Search Bar */}
      <div className="bg-black/60 rounded-xl p-3 border border-white/15">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search LP/Token Name or Asset ID"
          className="w-full bg-black/80 text-white p-2 rounded-lg border border-white/20 focus:outline-none focus:border-forge-orange"
        />
      </div>

      {/* Filter & Sort Controls */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 bg-black/60 rounded-xl p-1 border border-white/15">
        {/* Checkbox for XEL pairs */}
        <label className="flex items-center space-x-2 ml-2 mb-1.5 text-white">
          <input
            type="checkbox"
            checked={showNonXel}
            onChange={() => setshowNonXel(prev => !prev)}
            className="form-checkbox rounded text-forge-orange border-white/20"
          />
          <span className='text-left text-forge-orange text-sm'>Show Non-XEL Pairs</span>
        </label>

        {/* Sort options */}
        <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
          <div className="flex items-center space-x-2">
            <label className="text-white text-sm">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'TVL' | 'Share')}
              className="bg-black/80 text-white p-1 rounded-lg border border-white/20 focus:outline-none"
            >
              <option value="TVL">TVL</option>
              <option value="Share">My Share</option>
            </select>
          </div>

          <Tooltip content={`Click to Sort in ${!sortAsc ? 'Ascending' : 'Descending'} Order`}>
            <Button
              onClick={() => setSortAsc(!sortAsc)}
              focusOnClick={false}
              className="bg-black/70 border border-white/20 rounded-lg p-2 hover:bg-white/10 transition"
            >
              {sortAsc ? (
                <ArrowDown className="w-4 h-4 text-white transition-transform duration-200" />
              ) : (
                <ArrowUp className="w-4 h-4 text-white transition-transform duration-200" />
              )}
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Scrollable Pool List */}
      <div className="overflow-y-auto h-[55vh] pr-1 space-y-1">
        {filterAndSortPools().length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            No matching pools found
          </div>
        ) : (
          filterAndSortPools().map(([key, pool]) => {
            const isExpanded = expandedPools.has(key);
            const TVL = poolTVLs.get(key) ?? 0;

            return (
              <div
                key={key}
                onClick={() => togglePool(key)}
                className="bg-black/70 rounded-xl px-2 py-2 border border-white/12 hover:border-white/30 transition-all cursor-pointer overflow-visible"
              >
                <div className="relative min-h-14 flex items-center">
                  {/* Left: Pool Info */}
                  <div className="ml-2 z-10 text-left">
                    <div className="text-white text-[13pt] font-normal flex items-center space-x-1">
                      <span>{pool.name}</span>
                      {(TVL === 0 || !TVL) && !pool.hashes.includes(NATIVE_ASSET_HASH) && (
                        <Tooltip content="Insufficient price data — TVL shown as 0.">
                          <AlertTriangle className="w-4 h-4 text-yellow-400 ml-1" />
                        </Tooltip>
                      )}
                    </div>
                    <div className="text-forge-orange/80 text-sm">
                      TVL: <span className="text-forge-orange font-bold">${formatCompactNumber(TVL).toLocaleString()}</span> USD
                    </div>
                  </div>

                  {/* Center: Diagonal Token Icons */}
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

                  {/* Right: LP Share */}
                  <div className="ml-auto mr-2 text-right text-forge-orange/80 text-md z-10">
                    LP Share: <span className={`${isConnected ? 'text-forge-orange' : 'text-white/20'} font-bold text-md`}>
                      {pool.userShare ?? '--'}%
                    </span>
                  </div>
                </div>

                {/* Expandable Detail */}
                <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? 'max-h-40 mt-3 opacity-100' : 'max-h-0 opacity-0'}`}>
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
          })
        )}
      </div>
    </div>
  );
};

export default PoolList;