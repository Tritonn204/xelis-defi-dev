import React, { useState } from 'react'
import { Settings } from 'lucide-react'
import Button from '../ui/Button'
import PoolList from './PoolList'
import ConfirmDialog from '../ui/ConfirmDialog'
import { PoolData } from '@/contexts/PoolContext'
import ChoiceDialog from '../ui/ChoiceDialog'

export interface PoolListScreenProps {
  pools: Map<string, PoolData>
  isConnected: boolean
  connecting: boolean
  loading: boolean
  error?: string
  routerContract?: string
  onAddLiquidity: () => void
  onRemoveLiquidity: () => void // new prop
}

const PoolListScreen = ({
  pools,
  isConnected,
  connecting,
  loading,
  error,
  routerContract,
  onAddLiquidity,
  onRemoveLiquidity,
}: PoolListScreenProps) => {
  const [showDialog, setShowDialog] = useState(false)

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold text-white">Liquidity Pools</h2>
        <button className="text-gray-400 hover:text-white">
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {isConnected ? (
        <Button
          onClick={() => setShowDialog(true)}
          focusOnClick={false}
          className="
            w-full 
            bg-forge-orange 
            hover:bg-forge-orange/90 
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
        >
          Manage Positions
        </Button>
      ) : (
        <Button
          onClick={onAddLiquidity}
          focusOnClick={false}
          className="
            w-full 
            bg-white 
            text-black 
            font-light
            text-[1.5rem]
            py-1 px-4 
            rounded-xl 
            transition-all duration-200
            hover:shadow-lg
            hover:ring-2 ring-forge-orange
            hover:scale-[1.015]
            active:scale-[0.98]
          "
          disabled={!routerContract && isConnected}
          isLoading={connecting}
          staticSize={true}
        >
          Connect Wallet
        </Button>
      )}

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

      <div className="mt-2 relative">
        {/* Main content blurred when loading */}
        <div className={loading ? 'blur-sm pointer-events-none transition-all duration-510' : ''}>
          <PoolList pools={pools} scrollClass='h-[55vh]' />
        </div>

        {/* Overlay spinner */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
            <div className="animate-spin h-8 w-8 border-4 border-forge-orange border-t-transparent rounded-full mb-2" />
            <span className="text-white text-sm">Loading pools...</span>
          </div>
        )}
      </div>

      {/* Liquidity Action Dialog */}
      <ChoiceDialog
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
        title="Select Action"
        message=""
        actions={[
          {
            label: 'Add Liquidity',
            variant: 'neutral',
            onClick: onAddLiquidity,
            fontClassName: 'font-light text-[1.4rem]'
          },
          {
            label: 'Withdraw Liquidity',
            variant: 'neutral',
            onClick: onRemoveLiquidity,
            fontClassName: 'font-light text-[1.4rem]'
          },
          {
            label: 'Cancel',
            variant: 'danger',
            onClick: () => {},
            fontClassName: 'font-regular text-[1.4rem]'
          },
        ]}
      />
    </>
  )
}

export default PoolListScreen
