import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode } from 'react'
import { LOCAL_XSWD_WS } from '@xelis/sdk/config.js'
import XSWD from '@xelis/sdk/xswd/websocket.js'
import { type ApplicationData } from '@xelis/sdk/xswd/types.js'
import { objectToHex } from '../utils/data'

interface WalletState {
  isConnected: boolean
  address: string | null
  xelBalance: string | null
  network: string | null
  connecting: boolean
  error: string | null
}

interface WalletContextType extends WalletState {
  connectWallet: () => Promise<void>
  disconnectWallet: () => void
  updateBalance: () => Promise<void>
  getAssets: () => Promise<Map<string, number>>
  getBalance: (hash: string | undefined) => Promise<string>
  buildAndSubmitTransaction: (txData: object) => Promise<object>
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

const initialState: WalletState = {
  isConnected: false,
  address: null,
  xelBalance: null,
  network: null,
  connecting: false,
  error: null
}

type WalletAction = 
  | { type: 'CONNECT_START' }
  | { type: 'CONNECT_SUCCESS'; payload: { address: string; xelBalance: string; network: string } }
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
        xelBalance: action.payload.xelBalance,
        network: action.payload.network,
        connecting: false,
        error: null
      }
    case 'CONNECT_ERROR':
      console.log(action.payload)
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
        xelBalance: action.payload
      }
    default:
      return state
  }
}

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(walletReducer, initialState)
  const xswdRef = useRef<XSWD | null>(null)

  const generateSessionAppId = () => {
    const prefix = '666f726765' // "forge" in hex (10 chars)
    
    // Timestamp in hex (last 8 chars to keep it short but unique enough)
    const timestamp = Date.now().toString(16).slice(-8).padStart(8, '0') // 8 chars
    
    // Random hex for the remaining characters (64 - 10 - 8 = 46 chars)
    const randomHex = Array.from({ length: 23 }, () => 
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    ).join('') // 46 chars
    
    const appId = prefix + timestamp + randomHex
    
    // Validate we have exactly 64 hex chars
    if (appId.length !== 64 || !/^[0-9a-f]{64}$/i.test(appId)) {
      throw new Error(`Invalid app ID generated: ${appId.length} chars`)
    }
    
    return appId
  }

  const connectWallet = async () => {
    dispatch({ type: 'CONNECT_START' })
    try {
      // Create new XSWD instance with application data
      if (!xswdRef.current) {
        xswdRef.current = new XSWD()
      }

      // Connect to the wallet
      await xswdRef.current.connect(LOCAL_XSWD_WS)

      // Create application data
      const applicationData: ApplicationData = {
        id: generateSessionAppId(),
        name: 'XELIS Forge',
        description: 'Deploy, manage, and trade XELIS Assets!',
        permissions: [
          "build_transaction", 
          "get_address", 
          "get_balance", 
          "get_asset", 
          "get_assets", 
          "network_info",
        ]
      }

      await xswdRef.current.authorize(applicationData);
      
      const [address, balanceData, assetData, daemonInfo] = await Promise.all([
        xswdRef.current.wallet.getAddress(),
        xswdRef.current.wallet.getBalance(),
        xswdRef.current.wallet.getAssets(),
        xswdRef.current.daemon.getInfo()
      ])

      console.log({ address, balanceData, assetData, daemonInfo })

      const balance = balanceData ? `${(balanceData / 100000000).toFixed(8)} XEL` : '0 XEL'
      const network = daemonInfo?.network || 'Xelis'

      dispatch({
        type: 'CONNECT_SUCCESS', 
        payload: { 
          address, 
          xelBalance: balance, 
          network 
        } 
      })
    } catch (error: any) {
      dispatch({ type: 'CONNECT_ERROR', payload: error || 'Failed to connect wallet' })
      if (xswdRef.current) {
        try {
          await xswdRef.current.close()
        } catch (e) {
          console.error('Error disconnecting after failed connection:', e)
        }
        xswdRef.current = null
      }
    }
  }

  const disconnectWallet = async () => {
    if (xswdRef.current) {
      try {
        await xswdRef.current.close()
        xswdRef.current = null
      } catch (error) {
        console.error('Error disconnecting wallet:', error)
      }
      xswdRef.current = null
    }
    dispatch({ type: 'DISCONNECT' })
  }

  const updateBalance = async () => {
    if (!xswdRef.current || !state.isConnected) return

    try {
      const balanceData = await xswdRef.current.wallet.getBalance()
      const balance = balanceData ? `${(balanceData / 100000000).toFixed(8)} XEL` : '0 XEL'
      dispatch({ type: 'UPDATE_BALANCE', payload: balance })
    } catch (error) {
      console.error('Error updating xelBalance:', error)
    }
  }

  const getAssets = async () => {
    if (!xswdRef.current || !state.isConnected) return

    try {
      return await xswdRef.current.wallet.getAssets()
    } catch (error) {
      console.error('Error fetching assets:', error)
    }
  }

  const getBalance = async (assetHash?: string) => {
    if (!xswdRef.current || !state.isConnected) return '0'

    try {
      const balanceData = await xswdRef.current.wallet.getBalance(assetHash)
      const assetData = await xswdRef.current.wallet.getAssets({asset: assetHash})
      
      const decimals = assetData?.decimals ?? 8
      return balanceData ? 
        (balanceData / Math.pow(10, decimals)).toFixed(decimals) : 
        '0'
    } catch (error) {
      console.error('Error getting balance:', error)
      return '0'
    }
  }

const buildAndSubmitTransaction = async (txData: object) => {
  if (!xswdRef.current || !state.isConnected) {
    throw new Error('Wallet not connected');
  }
  
  try {
    // Build the transaction
    const txResult = await xswdRef.current.wallet.buildTransaction({
      ...txData
    });
    
    console.log("Transaction built successfully:", txResult)
    // console.log("Hex Data", txResult.tx_as_hex)
    
    // const submitResult = await xswdRef.current.daemon.submitTransaction(txResult.tx_as_hex)
    // console.log("RESULT", submitResult)
    
    return {
      success: !!txResult,
      hash: txResult.hash
    };
  } catch (error: any) {
    console.error('Transaction error:', error);
    throw new Error(error?.message || error || 'Failed to submit transaction');
  }
};

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (xswdRef.current) {
        xswdRef.current.close().catch(console.error)
        xswdRef.current = null
      }
    }
  }, [])

  return (
    <WalletContext.Provider value={{
      ...state,
      connectWallet,
      disconnectWallet,
      updateBalance,
      getAssets,
      getBalance,
      buildAndSubmitTransaction
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