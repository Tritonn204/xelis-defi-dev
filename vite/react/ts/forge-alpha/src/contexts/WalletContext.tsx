import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode, useState } from 'react'
import { LOCAL_XSWD_WS } from '@xelis/sdk/config'
import XSWD from '@xelis/sdk/xswd/websocket'
import { type ApplicationData } from '@xelis/sdk/xswd/types'
import { type RelayerQRData, ConnectModal, type ConnectModalTheme } from '@xelis/xswd-connect'

import * as types from '@xelis/sdk/wallet/types'
import { NATIVE_ASSET_HASH, useNode } from './NodeContext'
import { getForgeMetaForAssets } from '@/utils/getForgeMeta'
import { Asset } from './AssetContext'
import { responseTransformers } from '@/utils/types'

import e_vert from '@/assets/e_vert_wh.png'
import { forgeAppData } from './ForgeContext'

export type ConnectionMode = 'direct' | 'relayed'

interface WalletState {
  isConnected: boolean
  address: string | null
  xelBalance: string | null
  network: string | null
  connecting: boolean
  error: string | null
  subscribedEvents: string[]
  qrData: RelayerQRData | null
  connectionMode: ConnectionMode | null
}

interface WalletContextType extends WalletState {
  connectWallet: (mode?: ConnectionMode, socket?: any) => Promise<void>
  openConnectModal: () => void
  disconnectWallet: () => void
  updateBalance: () => Promise<void>
  getAssets: () => Promise<{ [key: string]: types.Asset } | undefined>
  getBalance: (hash?: string) => Promise<string>
  getRawBalance: (hash?: string) => Promise<number | "0">
  clearTxCache: () => Promise<void>
  buildAndSubmitTransaction: (txData: object) => Promise<object>
  buildTransaction: (txData: object) => Promise<Record<string, any>>
  submitTransaction: (txData: object) => Promise<object>
  subscribeToWalletEvent: (event: types.RPCEvent, callback: (data: any) => void) => void
  unsubscribeFromWalletEvent: (event: types.RPCEvent) => void
  trackAsset: (params: {asset: string}) => Promise<any>
  untrackAsset: (params: {asset: string}) => Promise<any>
  isAssetTracked: (params: {asset: string}) => Promise<any>
  //
  ownedAssets: Map<string, types.Asset> | undefined;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

const initialState: WalletState = {
  isConnected: false,
  address: null,
  xelBalance: null,
  network: null,
  connecting: false,
  error: null,
  subscribedEvents: [],
  qrData: null,
  connectionMode: null,
}

type WalletAction =
  | { type: 'CONNECT_START'; payload?: { mode: ConnectionMode } }
  | { type: 'CONNECT_SUCCESS'; payload: { address: string; xelBalance: string; network: string; mode: ConnectionMode } }
  | { type: 'CONNECT_ERROR'; payload: string }
  | { type: 'DISCONNECT' }
  | { type: 'UPDATE_BALANCE'; payload: string }
  | { type: 'EVENT_SUBSCRIBED'; payload: string }
  | { type: 'SET_QR_DATA'; payload: RelayerQRData | null }
  | { type: 'EVENT_UNSUBSCRIBED'; payload: string }

const walletReducer = (state: WalletState, action: WalletAction): WalletState => {
  switch (action.type) {
    case 'CONNECT_START':
      return {
        ...state,
        connecting: true,
        error: null,
        connectionMode: action.payload?.mode || null
      }
    case 'CONNECT_SUCCESS':
      return {
        ...state,
        isConnected: true,
        address: action.payload.address,
        xelBalance: action.payload.xelBalance,
        network: action.payload.network,
        connectionMode: action.payload.mode,
        connecting: false,
        error: null,
        qrData: null
      }
    case 'CONNECT_ERROR':
      console.log(action.payload)
      return {
        ...state,
        connecting: false,
        error: action.payload,
        qrData: null
      }
    case 'SET_QR_DATA':
      return {
        ...state,
        qrData: action.payload
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
    case 'EVENT_SUBSCRIBED':
      return {
        ...state,
        subscribedEvents: [...state.subscribedEvents, action.payload]
      }
    case 'EVENT_UNSUBSCRIBED':
      return {
        ...state,
        subscribedEvents: state.subscribedEvents.filter(event => event !== action.payload)
      }
    default:
      return state
  }
}

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [ownedAssets, setOwnedAssets] = useState<Map<string, types.Asset> | undefined>(new Map());
  const [state, dispatch] = useReducer(walletReducer, initialState)
  const [showConnectModal, setShowConnectModal] = useState(false)
  const xswdRef = useRef<XSWD | null>(null)
  const eventCallbacksRef = useRef<Map<string, (data: any, err?: Error) => void>>(new Map())

  const {
    currentNetwork,
    currentNode,
    customNetworks,
    getContractData
  } = useNode()

  const getFactoryContract = () => {
    if (currentNetwork === 'custom' && currentNode) {
      const networkConfig = Array.from(customNetworks.values())
        .find(network => network.name === currentNode.name)
      
      return networkConfig?.contractAddresses?.factory
    }
    return undefined
  }

  const connectWallet = async (mode: ConnectionMode = 'direct', clientOrUrl?: any) => {
    console.log('[WalletContext] connectWallet called, mode:', mode)
    dispatch({ type: 'CONNECT_START', payload: { mode } })
    try {
      // Create or use XSWD instance
      if (!xswdRef.current) {
        console.log('[WalletContext] Setting up XSWD instance')
        if (mode === 'relayed') {
          // Use the RelayClient provided by xswd-connect (already has .daemon, .wallet, etc.)
          if (!clientOrUrl) {
            throw new Error('RelayClient required for relayed connection')
          }
          console.log('[WalletContext] Using RelayClient from xswd-connect')
          xswdRef.current = clientOrUrl
        } else {
          // Direct connection (local WebSocket)
          console.log('[WalletContext] Creating direct WebSocket XSWD connection')
          xswdRef.current = new XSWD(LOCAL_XSWD_WS)
        }
      } else {
        console.log('[WalletContext] Reusing existing XSWD instance')
      }

      // Barrier: Wait for socket to open before proceeding
      console.log('[WalletContext] Checking socket readyState...')
      await new Promise<void>((resolve, reject) => {
        const socket = xswdRef.current!.socket

        console.log('[WalletContext] Socket readyState:', socket.readyState, 'WebSocket.OPEN:', WebSocket.OPEN)
        // If already open, resolve immediately
        if (socket.readyState === WebSocket.OPEN) {
          console.log('[WalletContext] Socket already open, resolving immediately')
          resolve()
          return
        }

        console.log('[WalletContext] Socket not open, waiting for open event...')

        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'))
        }, mode === 'relayed' ? 130000 : 10000) // Longer timeout for relayed

        socket.addEventListener('open', () => {
          clearTimeout(timeout)
          resolve()
        }, { once: true })

        socket.addEventListener('error', () => {
          clearTimeout(timeout)
          const errorMsg = mode === 'relayed'
            ? 'Failed to connect to XSWD relay server'
            : 'Could not connect to local XSWD server - is it running?'
          reject(new Error(errorMsg))
        }, { once: true })
      })

      console.log("AFTER OPEN")

      // For relayed connections, authorization already happened when wallet scanned QR
      // The QR code contains app_data and wallet authorizes during scan
      if (mode !== 'relayed') {
        console.log("PRE AUTH");
        await xswdRef.current.authorize(forgeAppData);
        console.log("AFTER AUTH");
      } else {
        console.log("SKIPPING AUTH - already authorized via QR code scan");
      }

      await xswdRef.current.dataCall(
        'xswd.prefetch_permissions',
        {
          reason: "XELIS Forge recommends auto-allowing all permissions listed here for a smooth experience. Access lasts for one XSWD session.",
          permissions: [
            "get_address",
            "get_balance",
            "get_asset",
            "get_assets",
            "is_asset_tracked",
            "network_info",
            "clear_tx_cache",
            "track_asset",
            "untrack_asset"
          ]
        }
      );

      console.log("POST PERMISSION");

      const [address, balanceData, assetData, daemonInfo] = await Promise.all([
        xswdRef.current.wallet.getAddress(),
        xswdRef.current.wallet.getBalance(NATIVE_ASSET_HASH),
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
          network,
          mode
        }
      })

      xswdRef.current.socket.addEventListener('close', () => {
        console.warn('XSWD connection closed');
        dispatch({ type: 'DISCONNECT' });
        xswdRef.current = null;
      });
    } catch (error: any) {
      dispatch({ type: 'CONNECT_ERROR', payload: error?.message || error || 'Failed to connect wallet' })
      if (xswdRef.current) {
        try {
          xswdRef.current.socket.close()
        } catch (e) {
          console.error('Error disconnecting after failed connection:', e)
        }
        xswdRef.current = null
      }
      // Re-throw so calling code can handle the error (e.g., show in modal)
      throw error instanceof Error ? error : new Error(error?.message || error || 'Failed to connect to local wallet')
    }
  }

  const disconnectWallet = async () => {
    if (xswdRef.current) {
      try {
        xswdRef.current.socket.close()
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
      const balanceData = await xswdRef.current.wallet.getBalance( NATIVE_ASSET_HASH )
      const balance = balanceData ? `${(balanceData / 100000000).toFixed(8)} XEL` : '0 XEL'
      dispatch({ type: 'UPDATE_BALANCE', payload: balance })
    } catch (error) {
      console.error('Error updating xelBalance:', error)
    }
  }

  const getAssets = async () => {
    if (!xswdRef.current || !state.isConnected) return;

    try {
      const rawAssets = await xswdRef.current.wallet.getAssets() as any;
      const assetMap = new Map<string, types.Asset>(
        rawAssets.map(({asset, data}: any) => [asset, data])
      );

      const assetHashes = [...assetMap.keys()];

      const factoryContract = getFactoryContract();
      let forgeMetaMap: Record<string, any> = {};

      if (factoryContract && getContractData && assetHashes.length) {
        forgeMetaMap = await getForgeMetaForAssets(
          factoryContract,
          assetHashes,
          getContractData
        );
      }

      for (const hash of assetHashes) {
        const asset = assetMap.get(hash);
        if (!asset) continue;

        const meta = forgeMetaMap[hash];

        assetMap.set(hash, {
          ...asset,
          isForge: !!meta,
          mintable: meta?.[2]?.value,
          logo: meta?.[4]?.value,
        } as types.Asset & { isForge?: boolean; mintable?: boolean; logo?: string });
      }

      setOwnedAssets(assetMap);

      const enrichedAssets = Object.fromEntries(assetMap.entries());
      return enrichedAssets as Record<
        string,
        types.Asset & { isForge?: boolean; mintable?: boolean; logo?: string }
      >;
    } catch (error) {
      console.error("Error fetching enriched assets:", error);
    }
  };

  const getBalance = async (assetHash?: string) => {
    if (!xswdRef.current || !state.isConnected) return '0'

    console.log("ASSET HASH:", assetHash);

    try {
      const balanceData = await xswdRef.current.wallet.getBalance(assetHash || NATIVE_ASSET_HASH)
      const assetData = await xswdRef.current.wallet.getAsset({asset: assetHash || NATIVE_ASSET_HASH})
      
      const decimals = assetData?.decimals ?? 8
      return balanceData ? 
        (balanceData / Math.pow(10, decimals)).toFixed(decimals) : 
        '0'
    } catch (error) {
      console.error('Error getting balance:', error)
      return '0'
    }
  }

  const getRawBalance = async (assetHash?: string) => {
    if (!xswdRef.current || !state.isConnected) return '0'

    try {
      return await xswdRef.current.wallet.getBalance(assetHash || NATIVE_ASSET_HASH) || 0
    } catch (error) {
      console.error('Error getting balance:', error)
      return '0'
    }
  }

  const clearTxCache = async () => {
    await xswdRef.current?.wallet.clearTxCache()
  }

  const buildAndSubmitTransaction = async (txData: object) => {
    if (!xswdRef.current || !state.isConnected) {
      throw new Error('Wallet not connected');
    }
    
    try {
      const txResult = await xswdRef.current.wallet.buildTransaction({
        ...txData,
        broadcast: true
      } as types.BuildTransactionParams);
                  
      return {
        success: !!txResult,
        hash: txResult.hash
      };
    } catch (error: any) {
      throw new Error(error?.message || error || 'Failed to build+submit transaction');
    }
  };

  const buildTransaction = async (txData: object) => {
    if (!xswdRef.current || !state.isConnected) {
      throw new Error('Wallet not connected');
    }
    
    try {
      const txResult = await xswdRef.current.wallet.buildTransaction({
        ...txData,
        broadcast: false,
        tx_as_hex: true
      });
      
      return txResult
    } catch (error: any) {
      throw new Error(error?.message || error || 'Failed to build transaction');
    }
  };

  const submitTransaction = async (txData: any) => {
    if (!xswdRef.current || !state.isConnected) {
      throw new Error('Wallet not connected');
    }
    
    try {
      const submitResult = await xswdRef.current.daemon.submitTransaction(txData.tx_as_hex)
      
      return {
        success: !!submitResult,
        hash: txData.hash
      };
    } catch (error: any) {
      throw new Error(error?.message || error || 'Failed to submit transaction');
    }
  };

  const subscribeToWalletEvent = (event: types.RPCEvent, callback: (data: any, err?: Error) => void) => {
    if (!xswdRef.current) {
      console.warn('Cannot subscribe to event: not connected')
      return
    }

    eventCallbacksRef.current.set(event, callback)
    xswdRef.current.wallet.addListener(event, null, callback)
    console.log("subscribed to", event)
    dispatch({ type: 'EVENT_SUBSCRIBED', payload: event })
  }

  const unsubscribeFromWalletEvent = (event: types.RPCEvent) => {
    if (!xswdRef.current) return

    const callback = eventCallbacksRef.current.get(event)
    if (callback) {
      xswdRef.current.wallet.removeListener(event, null, callback)
      eventCallbacksRef.current.delete(event)
      dispatch({ type: 'EVENT_UNSUBSCRIBED', payload: event })
    }
  }

  const trackAsset = async (params: {asset: string}) => {
    const res: any = await xswdRef.current?.wallet.dataCall("track_asset", params)
    if (res === true) {
      await getAssets()
    }
    return res
  }

  const untrackAsset = async (params: {asset: string}) => {
    const res: any = await xswdRef.current?.wallet.dataCall("untrack_asset", params)
    if (res === true) {
      await getAssets()
    }
    return res
  }

  const isAssetTracked = async (params: {asset: string}) => {
    const res: any = await xswdRef.current?.wallet?.dataCall("is_asset_tracked", params)
    return res
  }

  useEffect(() => {
    let heartbeatInterval: NodeJS.Timeout;

    const getInfoWithTimeout = async (timeoutMs = 5000) => {
      if (!xswdRef.current) throw new Error("XSWD not initialized");

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("getInfo timed out")), timeoutMs)
      );

      const infoCall = xswdRef.current.daemon.getInfo();

      return Promise.race([infoCall, timeout]);
    };

    const heartbeatCheck = async () => {
      if (!xswdRef.current || !state.isConnected) return;

      try {
        await getInfoWithTimeout(30000);
      } catch (error) {
        console.warn("Heartbeat failed. Disconnecting wallet:", error);
        dispatch({ type: 'DISCONNECT' });

        try {
          if (xswdRef.current?.socket) {
            xswdRef.current.socket.close();
          }
        } catch (e) {
          console.error("Error closing xswd during heartbeat cleanup:", e);
        }

        xswdRef.current = null;
      }
    };

    if (state.isConnected) {
      heartbeatInterval = setInterval(heartbeatCheck, 30000); // 30s interval
    }

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    };
  }, [state.isConnected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (xswdRef.current) {
        xswdRef.current.socket.close()
        xswdRef.current = null
      }
    }
  }, [])

  // Connect modal handlers
  const openConnectModal = () => {
    setShowConnectModal(true)
  }

  const handleDirectConnect = async () => {
    try {
      await connectWallet('direct')
      setShowConnectModal(false)
    } catch (error) {
      // Re-throw so ConnectModal can show error state
      throw error
    }
  }

  const handleRelayedConnect = async (connection: any) => {
    try {
      // Use the RelayClient provided by xswd-connect
      // It already wraps the TunneledWebSocket with full XSWD functionality
      await connectWallet('relayed', connection.client)
      setShowConnectModal(false)
    } catch (error) {
      // Re-throw so ConnectModal can show error state
      throw error
    }
  }

  // Forge theme for XSWD Connect modal
  const xswdTheme: ConnectModalTheme = {
    primaryColor: '#FF6B35', // forge-orange
    backgroundColor: '#090909ff', // dark background
    textColor: '#FFFFFF',
    secondaryTextColor: '#9CA3AF',
    outlineColor: '#FF6B3540', // forge-orange at 25% opacity
    qrCenterBackgroundColor: '#000000', // forge-orange background behind logo
  }

  // XSWD application data for Forge (must match direct connection applicationData)

  return (
    <WalletContext.Provider value={{
      ...state,
      connectWallet,
      openConnectModal,
      disconnectWallet,
      updateBalance,
      getAssets,
      getBalance,
      getRawBalance,
      clearTxCache,
      buildAndSubmitTransaction,
      buildTransaction,
      submitTransaction,
      subscribeToWalletEvent,
      unsubscribeFromWalletEvent,
      ownedAssets,
      trackAsset,
      untrackAsset,
      isAssetTracked
    }}>
      {children}

      {/* Universal Connect Modal */}
      <ConnectModal
        relayerUrl="wss://xswd.neptuun.xyz/ws"
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onDirectConnect={handleDirectConnect}
        onRelayedConnect={handleRelayedConnect}
        appData={forgeAppData}
        theme={xswdTheme}
        appName="XELIS Forge"
        appIcon={e_vert}
      />
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