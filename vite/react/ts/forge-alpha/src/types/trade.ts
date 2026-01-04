import type { Asset } from '@/contexts/AssetContext'
import type { PoolData } from '@/contexts/PoolContext'
import { Dispatch, SetStateAction } from 'react';

export interface TradingViewProps {
  // From useAssets
  assets: Record<string, Asset>
  selectedAssets: { from: string; to: string }
  swapAmounts: { from: string; to: string }
  execSlippage: number
  slippage: number
  priceImpact: number
  loading: boolean
  error: string | null
  
  // Asset actions
  selectAsset: (position: 'from' | 'to', hash: string) => void
  swapAssets: () => void
  setAmount: (position: 'from' | 'to', amount: string) => void
  setSlippage: (slippage: number) => void
  setExecSlippage: (slippage: number) => void
  setPriceImpact: (impact: number) => void
  setLoading: (loading: boolean) => void
  setError: Dispatch<SetStateAction<string>>
  refreshAssets: () => void
  
  // From usePools
  activePools: Map<string, PoolData>
  poolAssets: Map<string, Asset>
  refreshPools: () => void
  
  // Computed values (derived in Trade.tsx)
  hasValidPool: false | PoolData | undefined
  poolReserves: { fromReserve: number; toReserve: number } | null
  
  // From useWallet
  isConnected: boolean
  connecting: boolean
  openConnectModal: () => void
  
  // Swap logic (computed in Trade.tsx)
  swapCalculation: any
  isSwapDisabled: boolean
  
  // UI state
  isSubmitting: boolean
  showSuccess: boolean
  txHash: string
  isProMode: boolean
  
  // Modal state & handlers
  isModalOpen: boolean
  setIsModalOpen: (open: boolean) => void
  modalPosition: 'from' | 'to'
  handleTokenSelect: (position: 'from' | 'to') => void
  handleTokenSelected: (tokenHash: string) => void
  handleAmountChange: (position: 'from' | 'to', value: string) => void
  handleSwap: () => void
}