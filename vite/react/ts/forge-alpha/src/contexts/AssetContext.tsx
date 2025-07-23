import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { useNode, NATIVE_ASSET_HASH } from '@/contexts/NodeContext'

export interface Asset {
  symbol: string
  name: string
  balance: string
  price: number
  isForge: boolean
  mintable: boolean
  logo: string | undefined
  hash: string
  decimals: number
}

interface AssetState {
  assets: Record<string, Asset>
  selectedAssets: {
    from: string
    to: string
  }
  swapAmounts: {
    from: string
    to: string
  }
  slippage: number
  priceImpact: number
  loading: boolean
  error: string | null
}

interface AssetContextType extends AssetState {
  setAssetBalance: (symbol: string, balance: string) => void
  selectAsset: (position: 'from' | 'to', symbol: string) => void
  swapAssets: () => void
  setAmount: (position: 'from' | 'to', amount: string) => void
  setSlippage: (slippage: number) => void
  setPriceImpact: (impact: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  refreshAssets: () => void
}

const AssetContext = createContext<AssetContextType | undefined>(undefined)

const initialState: AssetState = {
  assets: {},
  selectedAssets: {
    from: '',
    to: ''
  },
  swapAmounts: {
    from: '',
    to: ''
  },
  slippage: 0.5,
  priceImpact: 0,
  loading: false,
  error: null
}

type AssetAction =
  | { type: 'SET_ASSETS'; payload: Record<string, Asset> }
  | { type: 'SET_ASSET_BALANCE'; payload: { symbol: string; balance: string } }
  | { type: 'SELECT_ASSET'; payload: { position: 'from' | 'to'; symbol: string } }
  | { type: 'SWAP_ASSETS' }
  | { type: 'SET_AMOUNT'; payload: { position: 'from' | 'to'; amount: string } }
  | { type: 'SET_SLIPPAGE'; payload: number }
  | { type: 'SET_PRICE_IMPACT'; payload: number }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }

const assetReducer = (state: AssetState, action: AssetAction): AssetState => {
  switch (action.type) {
    case 'SET_ASSETS':
      return {
        ...state,
        assets: action.payload
      }
    case 'SET_ASSET_BALANCE':
      return {
        ...state,
        assets: {
          ...state.assets,
          [action.payload.symbol]: {
            ...state.assets[action.payload.symbol],
            balance: action.payload.balance
          }
        }
      }
    case 'SELECT_ASSET':
      return {
        ...state,
        selectedAssets: {
          ...state.selectedAssets,
          [action.payload.position]: action.payload.symbol
        }
      }
    case 'SWAP_ASSETS':
      return {
        ...state,
        selectedAssets: {
          from: state.selectedAssets.to,
          to: state.selectedAssets.from
        },
        swapAmounts: {
          from: state.swapAmounts.to,
          to: state.swapAmounts.from
        }
      }
    case 'SET_AMOUNT':
      return {
        ...state,
        swapAmounts: {
          ...state.swapAmounts,
          [action.payload.position]: action.payload.amount
        }
      }
    case 'SET_SLIPPAGE':
      return {
        ...state,
        slippage: action.payload
      }
    case 'SET_PRICE_IMPACT':
      return {
        ...state,
        priceImpact: action.payload
      }
    case 'SET_LOADING':
      return {
        ...state,
        loading: action.payload
      }
    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        loading: false
      }
    default:
      return state
  }
}

export const AssetProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(assetReducer, initialState)
  
  const { 
    isConnected, 
    address, 
    xelBalance,
    getAssets,
    getBalance,
    getRawBalance 
  } = useWallet()
  
  const { 
    getAsset,
    getAssetSupply 
  } = useNode()

  // Load assets when wallet is connected
  useEffect(() => {
    if (isConnected && address) {
      loadWalletAssets()
    }
  }, [isConnected, address, xelBalance])

  const loadWalletAssets = async () => {
    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'SET_ERROR', payload: null })
    
    try {
      const assetData = await getAssets() as Record<string, any>
      const assets: Record<string, Asset> = assetData

      assets[NATIVE_ASSET_HASH].logo = '/assets/xel-logo.png';
      console.log("ASSETS", assets)
      
      dispatch({ type: 'SET_ASSETS', payload: assets })
      
      const assetKeys = Object.keys(assets)
      if (!state.selectedAssets.from && assetKeys.length > 0) {
        dispatch({ 
          type: 'SELECT_ASSET', 
          payload: { position: 'from', symbol: NATIVE_ASSET_HASH } 
        })
      }
      if (!state.selectedAssets.to && assetKeys.length > 1) {
        const secondAsset = assetKeys.find(key => key !== NATIVE_ASSET_HASH)
        if (secondAsset) {
          dispatch({ 
            type: 'SELECT_ASSET', 
            payload: { position: 'to', symbol: secondAsset } 
          })
        }
      }
    } catch (error: any) {
      console.error('Error loading assets:', error)
      dispatch({ 
        type: 'SET_ERROR', 
        payload: `Failed to load assets: ${error.message || 'Unknown error'}` 
      })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const setAssets = (assets: Record<string, Asset>) => {
    dispatch({ type: 'SET_ASSETS', payload: assets })
  }

  const setAssetBalance = (symbol: string, balance: string) => {
    dispatch({ type: 'SET_ASSET_BALANCE', payload: { symbol, balance } })
  }

  const selectAsset = (position: 'from' | 'to', symbol: string) => {
    dispatch({ type: 'SELECT_ASSET', payload: { position, symbol } })
  }

  const swapAssets = () => {
    dispatch({ type: 'SWAP_ASSETS' })
  }

  const setAmount = (position: 'from' | 'to', amount: string) => {
    dispatch({ type: 'SET_AMOUNT', payload: { position, amount } })
  }

  const setSlippage = (slippage: number) => {
    dispatch({ type: 'SET_SLIPPAGE', payload: slippage })
  }

  const setPriceImpact = (impact: number) => {
    dispatch({ type: 'SET_PRICE_IMPACT', payload: impact })
  }

  const setLoading = (loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: loading })
  }

  const setError = (error: string | null) => {
    dispatch({ type: 'SET_ERROR', payload: error })
  }

  const refreshAssets = () => {
    if (isConnected && address) {
      loadWalletAssets()
    }
  }

  return (
    <AssetContext.Provider value={{
      ...state,
      setAssetBalance,
      selectAsset,
      swapAssets,
      setAmount,
      setSlippage,
      setPriceImpact,
      setLoading,
      setError,
      refreshAssets
    }}>
      {children}
    </AssetContext.Provider>
  )
}

export const useAssets = (): AssetContextType => {
  const context = useContext(AssetContext)
  if (!context) {
    throw new Error('useAssets must be used within a AssetProvider')
  }
  return context
}