import React from 'react'
import { Settings } from 'lucide-react'
import Button from '../ui/Button'
import PoolList from './PoolList'
import { PoolData } from '@/contexts/PoolContext'

export interface PoolListScreenProps {
  pools: Map<string, PoolData>
  isConnected: boolean
  connecting: boolean
  loading: boolean
  error?: string
  routerContract?: string
  onAddLiquidity: () => void
}

const PoolListScreen = ({
  pools,
  isConnected,
  connecting,
  loading,
  error,
  routerContract,
  onAddLiquidity,
}: PoolListScreenProps) => {
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold text-white">Liquidity Pools</h2>
        <button className="text-gray-400 hover:text-white">
          <Settings className="w-5 h-5" />
        </button>
      </div>

      <Button
        onClick={onAddLiquidity}
        focusOnClick={false}
        className="
          w-full 
          bg-forge-orange 
          hover:bg-forge-orange/90 
          disabled:bg-gray-600 
          text-white 
          font-light
          text-[1.5rem]
          py-1 px-4 
          rounded-xl 
          transition-all duration-200
          hover:shadow-lg
          hover:ring-2 ring-white
          hover:scale-[1.015]
          active:scale-[0.98]
        "
        disabled={!routerContract && isConnected}
        isLoading={connecting}
        staticSize={true}
      >
        {isConnected ? 'Add Liquidity' : 'Connect Wallet'}
      </Button>

      {!routerContract && isConnected && (
        <div className="mt-2 text-red-500 text-sm text-center">
          Router contract not found for this network
        </div>
      )}

      {error && (
        <div className="mt-2 text-red-500 text-sm text-center">
          {error}
        </div>
      )}

      <div className="mt-2">
        {loading ? (
          <div className="text-center py-6">
            <div className="animate-spin h-8 w-8 border-4 border-forge-orange border-t-transparent rounded-full mx-auto mb-4"></div>
            <div className="text-white">Loading pools...</div>
          </div>
        ) : (
          <PoolList pools={pools} />
        )}
      </div>
    </>
  )
}

export default PoolListScreen
