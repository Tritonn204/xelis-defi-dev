import React from 'react'

const PoolStats = ({ 
  symbol1, 
  symbol2, 
  tvl, 
  volume24h, 
  fees24h 
}) => {
  return (
    <div className="bg-black/70 rounded-xl p-3 border border-white/12">
      <div className="flex justify-between items-center mb-2">
        <div className="text-white font-medium">{symbol1}/{symbol2}</div>
        <div className="text-gray-400 text-sm">Pool Stats</div>
      </div>
      
      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-400 text-sm">TVL:</span>
          <span className="text-white text-sm">${tvl}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400 text-sm">24h Volume:</span>
          <span className="text-white text-sm">${volume24h}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400 text-sm">24h Fees:</span>
          <span className="text-white text-sm">${fees24h}</span>
        </div>
      </div>
    </div>
  )
}

export default PoolStats