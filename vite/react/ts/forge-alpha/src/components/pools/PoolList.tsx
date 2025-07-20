import React, { useEffect } from 'react'

export interface PoolData {
  name: string;
  tvl: number;
  userShare: string | undefined;
}

interface PoolListProps {
  pools?: Map<string, PoolData>;
}

export const PoolList = ({
  pools = new Map<string, PoolData>()
}: PoolListProps) => {

  const poolEntries = Array.from(pools.entries());

  useEffect(() => {
    console.log('Pool entries:', poolEntries);
  }, [pools]);

  if (poolEntries.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400">
        No active pools found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {poolEntries.map(([key, pool]) => (
        <div 
          key={key}
          className="bg-black/70 rounded-xl p-3 border border-white/12 hover:border-white/30 transition-all cursor-pointer"
        >
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <div className="mr-2">
                {/* Pool icons would go here */}
              </div>
              <div>
                <div className="text-white font-medium">{pool.name}</div>
                <div className="text-gray-400 text-sm">TVL: ${pool.tvl.toLocaleString()}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-gray-400 text-sm">My share: {pool.userShare ?? '--'}%</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default PoolList;