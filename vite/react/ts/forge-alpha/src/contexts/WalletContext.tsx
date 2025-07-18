import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react'

interface WalletState {
  isConnected: boolean
  address: string | null
  balance: string | null
  network: string | null
  connecting: boolean
  error: string | null
}

interface WalletContextType extends WalletState {
  connectWallet: () => Promise<void>
  disconnectWallet: () => void
  updateBalance: (balance: string) => void
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

const initialState: WalletState = {
  isConnected: false,
  address: null,
  balance: null,
  network: null,
  connecting: false,
  error: null
}

type WalletAction = 
  | { type: 'CONNECT_START' }
  | { type: 'CONNECT_SUCCESS'; payload: { address: string; balance: string; network: string } }
  | { type: 'CONNECT_ERROR'; payload: string }
  | { type: 'DISCONNECT' }
  | { type: 'UPDATE_BALANCE'; payload: string }

const walletReducer = (state: WalletState, action: WalletAction): WalletState => {
  switch (action.type) {
    case 'CONNECT_START':
      return { ...state, connecting: true, error: null }
    case 'CONNECT_SUCCESS':
      return {
        ...state,
        isConnected: true,
        address: action.payload.address,
        balance: action.payload.balance,
        network: action.payload.network,
        connecting: false,
        error: null
      }
    case 'CONNECT_ERROR':
      return {
        ...state,
        connecting: false,
        error: action.payload
      }
    case 'DISCONNECT':
      return {
        ...initialState
      }
    case 'UPDATE_BALANCE':
      return {
        ...state,
        balance: action.payload
      }
    default:
      return state
  }
}

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(walletReducer, initialState)

  const connectWallet = async () => {
    dispatch({ type: 'CONNECT_START' })
    try {
      // Mock connection logic - replace with actual wallet connection
      const mockAddress = 'xet:nz4vwyzqcg7kth4wrq6n6kjjgj9qtj5j84d3gpyg8v9ljsw0mgaqqzfhlsu'
      const mockBalance = '1.5 XET'
      const mockNetwork = 'Xelis'
      
      dispatch({ 
        type: 'CONNECT_SUCCESS', 
        payload: { 
          address: mockAddress, 
          balance: mockBalance, 
          network: mockNetwork 
        } 
      })
    } catch (error) {
      dispatch({ type: 'CONNECT_ERROR', payload: error.message })
    }
  }

  const disconnectWallet = () => {
    dispatch({ type: 'DISCONNECT' })
  }

  const updateBalance = (newBalance) => {
    dispatch({ type: 'UPDATE_BALANCE', payload: newBalance })
  }

  return (
    <WalletContext.Provider value={{
      ...state,
      connectWallet,
      disconnectWallet,
      updateBalance
    }}>
      {children}
    </WalletContext.Provider>
  )
}

export const useWallet = (): WalletContextType => {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}