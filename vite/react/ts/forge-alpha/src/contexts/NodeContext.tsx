import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode } from 'react'
import { TESTNET_NODE_WS, MAINNET_NODE_WS } from '@xelis/sdk/config.js'
import DaemonWS from '@xelis/sdk/daemon/websocket.js'
import * as types from '@xelis/sdk/daemon/types.js'

import { genericTransformer, responseTransformers} from '../utils/types'

type NetworkType = 'mainnet' | 'testnet' | 'custom'

interface NodeConfig {
  url: string
  name: string
}

interface NetworkConfig {
  [key: string]: NodeConfig[] | 'custom'
}

export interface CustomNetworkConfig {
  name: string
  url: string
  contractAddresses?: {
    [key: string]: string // e.g., { "router": "xel1...", "factory": "xel1..." }
  }
}
// Static node configuration
const NETWORK_NODES: NetworkConfig = {
  mainnet: [
    { url: MAINNET_NODE_WS, name: 'Official Mainnet' }
  ],
  testnet: [
    { url: TESTNET_NODE_WS, name: 'Official Testnet' }
  ],
  custom: 'custom'
}

interface NodeState {
  isConnected: boolean
  currentNetwork: NetworkType | null
  currentNode: NodeConfig | null
  networkInfo: types.GetInfoResult | null
  connecting: boolean
  error: string | null
  subscribedEvents: string[]
  customNetworks: Map<string, CustomNetworkConfig>
  networkMismatch: boolean
  detectedNetwork: string | null
}

interface NodeContextType extends NodeState {
  connectToNetwork: (network: NetworkType) => Promise<void>
  connectToCustomNetwork: (config: CustomNetworkConfig) => Promise<void>
  updateCustomNetwork: (networkId: string, config: CustomNetworkConfig) => void
  saveCustomNetwork: (id: string, config: CustomNetworkConfig) => void
  getCustomNetworks: () => CustomNetworkConfig[]

  switchNode: (nodeIndex: number) => Promise<void>
  disconnect: () => void
  deleteCustomNetwork: (networkId: string) => void
  subscribeToNodeEvent: (event: types.RPCEvent, callback: (data: any) => void) => void
  unsubscribeFromNodeEvent: (event: types.RPCEvent) => void
  
  // Network queries
  getInfo: () => Promise<types.GetInfoResult>
  getHeight: () => Promise<number>
  getTopoheight: () => Promise<number>
  
  // Block queries
  getBlockByHash: (params: types.GetBlockByHashParams) => Promise<types.Block>
  getBlockAtTopoheight: (params: types.GetBlockAtTopoheightParams) => Promise<types.Block>
  getTopBlock: (params?: types.GetTopBlockParams) => Promise<types.Block>
  
  // Transaction queries
  getTransaction: (params: types.GetTransactionParams) => Promise<types.TransactionResponse>
  getTransactions: (txHashes: string[]) => Promise<types.TransactionResponse[]>
  getMempool: (params?: types.GetMempoolParams) => Promise<types.GetMempoolResult>
  getEstimatedFeeRates: () => Promise<types.FeeRatesEstimated>
  
  // Account queries
  getBalance: (params: types.GetBalanceParams) => Promise<types.GetBalanceResult>
  getAccountHistory: (params: types.GetAccountHistoryParams) => Promise<types.AccounHistory[]>
  getAccountAssets: (address: string) => Promise<string[]>
  
  // Asset queries
  getAsset: (params: types.GetAssetParams) => Promise<types.AssetData>
  getAssetSupply: (params: types.GetAssetParams) => Promise<any>
  getAssets: (params?: types.GetAssetsParams) => Promise<string[]>
  getContractOutputs: (params: any) => Promise<any>
  
  // Smart contract queries
  getContractData: (params: types.GetContractDataParams) => Promise<types.GetContractDataResult>
  getContractBalance: (params: types.GetContractBalanceParams) => Promise<types.GetContractBalanceResult>
  getContractModule: (params: types.GetContractModuleParams) => Promise<types.GetContractModuleResult>
  getContractAssets: (contract: string) => Promise<string[]>
  
  // Utility
  validateAddress: (params: types.ValidateAddressParams) => Promise<types.ValidateAddressResult>
  generateNetworkId: (config: CustomNetworkConfig) => string
  
  availableNetworks: NetworkType[]
  availableNodes: NodeConfig[] | 'custom'
  awaitTx: (txHash: string, callback: () => void) => void
  recentBlocks: types.Block[]
}

const NodeContext = createContext<NodeContextType | undefined>(undefined)

const dalkNet = {
  url: "ws://136.56.215.96:8080/json_rpc",
  name: "Devnet",
  contractAddresses: {
    "router": "6ec97b2653cc562df255c528f4aa7391c9568f5fec94f26592b50fba632fab1d",
    "factory": "30e8558bb78e565bd6d1c27e44779d1e709a67b10efdd05fb97214eecf57ccf2"
  }
}

const initialState: NodeState = {
  isConnected: false,
  currentNetwork: null,
  currentNode: null,
  networkInfo: null,
  connecting: false,
  error: null,
  subscribedEvents: [],
  customNetworks: new Map<string, CustomNetworkConfig>([
    ["Devnet", dalkNet]
  ]),
  networkMismatch: false,
  detectedNetwork: null
}

type NodeAction = 
  | { type: 'CONNECT_START' }
  | { type: 'CONNECT_SUCCESS'; payload: { network: NetworkType; node: NodeConfig; networkInfo: types.GetInfoResult } }
  | { type: 'CONNECT_ERROR'; payload: string }
  | { type: 'DISCONNECT' }
  | { type: 'UPDATE_NETWORK_INFO'; payload: types.GetInfoResult }
  | { type: 'EVENT_SUBSCRIBED'; payload: string }
  | { type: 'EVENT_UNSUBSCRIBED'; payload: string }
  | { type: 'UPDATE_CUSTOM_NETWORKS'; payload: Map<string, CustomNetworkConfig> }

const nodeReducer = (state: NodeState, action: NodeAction): NodeState => {
  switch (action.type) {
    case 'CONNECT_START':
      return { ...state, connecting: true, error: null }
    case 'CONNECT_SUCCESS':
      return {
        ...state,
        isConnected: true,
        currentNetwork: action.payload.network,
        currentNode: action.payload.node,
        networkInfo: action.payload.networkInfo,
        connecting: false,
        error: null
      }
    case 'CONNECT_ERROR':
      return {
        ...state,
        connecting: false,
        error: action.payload,
        isConnected: false
      }
    case 'DISCONNECT':
      return { ...initialState }
    case 'UPDATE_NETWORK_INFO':
      return {
        ...state,
        networkInfo: action.payload
      }
    case 'UPDATE_CUSTOM_NETWORKS':
      return {
        ...state,
        customNetworks: new Map(action.payload)
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

export const NodeProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(nodeReducer, initialState)
  const daemonRef = useRef<DaemonWS | null>(null)
  const eventCallbacksRef = useRef<Map<string, (data: any) => void>>(new Map())
  const reconnectTimeoutRef = useRef<number | null>(null)
  const customNetworksRef = useRef<Map<string, CustomNetworkConfig>>(new Map())
  const recentBlocksRef = useRef<types.Block[]>([])
  const txWatchQueueRef = useRef<Map<string, () => void>>(new Map())

  // Macro-like method wrapper with proper TypeScript generics
  const createRPCMethodWrapper = <TReturn, TParams extends any[] = []>(
    methodName: string
  ) => {
    return async (...args: TParams): Promise<TReturn> => {
      if (!daemonRef.current?.methods) {
        throw new Error('Not connected to any node')
      }
      
      const method = (daemonRef.current.methods as any)[methodName]
      if (typeof method !== 'function') {
        throw new Error(`Method ${methodName} not available`)
      }
      
      return await method(...args)
    }
  }

  const createContractMethodWrapper = <TReturn, TParams extends any[] = []>(
    methodName: string,
    transformer = genericTransformer
  ) => {
    return async (...args: TParams): Promise<TReturn> => {
      if (!daemonRef.current?.methods) {
        throw new Error('Not connected to any node')
      }
      
      const method = (daemonRef.current.methods as any)[methodName]
      if (typeof method !== 'function') {
        throw new Error(`Method ${methodName} not available`)
      }
      
      const response = await method(...args)
      return transformer(response) as TReturn
    }
  }

  const connectToNetwork = async (network: NetworkType) => {
    dispatch({ type: 'CONNECT_START' })
    
    try {
      // Handle custom networks separately
      if (network === 'custom') {
        throw new Error('Cannot connect to custom network without configuration. Use connectToCustomNetwork() instead.')
      }

      const nodes = NETWORK_NODES[network]
      if (!nodes || typeof nodes === 'string' || nodes.length === 0) {
        throw new Error(`No nodes available for network: ${network}`)
      }

      // Try to connect to the first available node
      const node = nodes[0]
      const daemon = new DaemonWS()
      
      // Connect to WebSocket
      await daemon.connect(node.url)
      
      // Test connection by getting network info
      const networkInfo = await daemon.methods.getInfo()
      
      // Store reference
      daemonRef.current = daemon

      dispatch({
        type: 'CONNECT_SUCCESS',
        payload: { network, node, networkInfo }
      })
    } catch (error: any) {
      dispatch({ 
        type: 'CONNECT_ERROR', 
        payload: error?.message || 'Failed to connect to network' 
      })
      daemonRef.current = null
    }
  }

  const switchNode = async (nodeIndex: number) => {
    if (!state.currentNetwork) return
    
    const nodes = NETWORK_NODES[state.currentNetwork]
    if (!nodes || nodeIndex >= nodes.length) {
      throw new Error('Invalid node index')
    }

    // Disconnect current connection
    if (daemonRef.current) {
      await daemonRef.current.close()
    }

    // Connect to new node
    await connectToNetwork(state.currentNetwork)
  }

  const awaitTx = (txHash: string, callback: () => void) => {
    txWatchQueueRef.current.set(txHash, callback)
  }

  const disconnect = async () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    
    if (daemonRef.current) {
      try {
        await daemonRef.current.close()
      } catch (error) {
        console.error('Error disconnecting:', error)
      }
    }
    
    daemonRef.current = null
    eventCallbacksRef.current.clear()
    dispatch({ type: 'DISCONNECT' })
  }

  const deleteCustomNetwork = (networkId: string) => {
    // Check if we're currently connected to this network BEFORE deleting
    const networkToDelete = customNetworksRef.current.get(networkId)
    const isCurrentlyConnected = state.currentNetwork === 'custom' && 
      state.currentNode?.name === networkToDelete?.name
    
    // Delete the network
    customNetworksRef.current.delete(networkId)
    dispatch({ 
      type: 'UPDATE_CUSTOM_NETWORKS', 
      payload: new Map(customNetworksRef.current) 
    });

    saveCustomNetworksToStorage() // Update storage after deletion
    
    // Disconnect if we were connected to the deleted network
    if (isCurrentlyConnected) {
      disconnect()
    }
  }

  const subscribeToNodeEvent = (event: types.RPCEvent, callback: (data: any) => void) => {
    if (!daemonRef.current) {
      console.warn('Cannot subscribe to event: not connected')
      return
    }

    eventCallbacksRef.current.set(event, callback)
    daemonRef.current.methods.ws.listenEvent(event, callback)
    console.log("subscribed to", event)
    dispatch({ type: 'EVENT_SUBSCRIBED', payload: event })
  }

  const unsubscribeFromNodeEvent = (event: types.RPCEvent) => {
    if (!daemonRef.current) return

    const callback = eventCallbacksRef.current.get(event)
    if (callback) {
      daemonRef.current.off(event, callback)
      eventCallbacksRef.current.delete(event)
      dispatch({ type: 'EVENT_UNSUBSCRIBED', payload: event })
    }
  }

  // Network queries - using the macro-like approach
  const getInfo = createRPCMethodWrapper<types.GetInfoResult>('getInfo')
  const getHeight = createRPCMethodWrapper<number>('getHeight')
  const getTopoheight = createRPCMethodWrapper<number>('getTopoheight')

  // Block queries
  const getBlockByHash = createRPCMethodWrapper<types.Block, [types.GetBlockByHashParams]>('getBlockByHash')
  const getBlockAtTopoheight = createRPCMethodWrapper<types.Block, [types.GetBlockAtTopoheightParams]>('getBlockAtTopoheight')
  const getTopBlock = createRPCMethodWrapper<types.Block, [types.GetTopBlockParams?]>('getTopBlock')

  // Transaction queries
  // const getTransaction = createRPCMethodWrapper<types.TransactionResponse, [types.GetTransactionParams]>('getTransaction')
  const getTransaction = async (params: types.GetTransactionParams) => {
    return await daemonRef.current.dataCall("get_transaction", params)
  }
  const getTransactions = createRPCMethodWrapper<types.TransactionResponse[], [string[]]>('getTransactions')
  const getMempool = createRPCMethodWrapper<types.GetMempoolResult, [types.GetMempoolParams?]>('getMemPool')
  const getEstimatedFeeRates = createRPCMethodWrapper<types.FeeRatesEstimated>('getEstimatedFeeRates')

  // Account queries
  const getBalance = createRPCMethodWrapper<types.GetBalanceResult, [types.GetBalanceParams]>('getBalance')
  const getAccountHistory = createRPCMethodWrapper<types.AccounHistory[], [types.GetAccountHistoryParams]>('getAccountHistory')
  const getAccountAssets = createRPCMethodWrapper<string[], [string]>('getAccountAssets')

  // Asset queries
  const getAsset = async (params: types.GetAssetParams) => {
    return await daemonRef.current.dataCall("get_asset", params)
  }
  const getAssetSupply = async (params: types.GetAssetParams) => {
    return await daemonRef.current.dataCall("get_asset_supply", params)
  }
  const getAssets = createRPCMethodWrapper<string[], [types.GetAssetsParams?]>('getAssets')

  // Smart contract queries
  const getContractData = async (params: types.GetContractDataParams) => {
    const res = await daemonRef.current.dataCall("get_contract_data", params)
    return responseTransformers.contractDataTransformer(res)
  }
  const getContractBalance = async (params: types.GetContractBalanceParams) => {
    const res = await daemonRef.current.dataCall("get_contract_balance", params)
    return res
  }
  const getContractModule = createContractMethodWrapper<types.GetContractModuleResult, [types.GetContractModuleParams]>('getContractModule')
  const getContractAssets = async (contract: string) => {
    const res = await daemonRef.current.dataCall("get_contract_assets", {contract})
    return res
  }
  const getContractOutputs = async (params: any) => {
    const res = await daemonRef.current.dataCall("get_contract_outputs", params)
    return res
  }

  // Utility
  const validateAddress = createRPCMethodWrapper<types.ValidateAddressResult, [types.ValidateAddressParams]>('validateAddress')


  // Auto-connect on mount
  useEffect(() => {
    const savedNetwork = localStorage.getItem('selectedNetwork') as NetworkType
    if (savedNetwork && NETWORK_NODES[savedNetwork]) {
      connectToNetwork(savedNetwork)
    } else {
      connectToNetwork('testnet') // Default to testnet
    }

    return () => {
      disconnect()
    }
  }, [])

  // Save selected network to localStorage
  useEffect(() => {
    if (state.currentNetwork) {
      localStorage.setItem('selectedNetwork', state.currentNetwork)
    }
  }, [state.currentNetwork])

  const handleNewBlock = (data: any) => {
    const blockData = JSON.parse(data.data)?.result
    recentBlocksRef.current = [blockData, ...recentBlocksRef.current].slice(0, 3)

    // Check if any watched txs are in this block
    const seenTxs = blockData.txs_hashes || []

    for (const txHash of seenTxs) {
      const callback = txWatchQueueRef.current.get(txHash)
      if (callback) {
        try {
          callback()
        } catch (err) {
          console.error(`Callback for TX ${txHash} failed:`, err)
        }
        txWatchQueueRef.current.delete(txHash)
      }
    }


    console.log(blockData)
    console.log("Updated recent blocks:", recentBlocksRef.current.map(b => b.hash))
  }

  const handleStableHeight = (data: any) => {
    // TODO
  }

  // Always subscribe to these global events
  useEffect(() => {
    if (daemonRef.current) {
      // Global events that benefit the entire app
      subscribeToNodeEvent(types.RPCEvent.NewBlock, handleNewBlock)
      subscribeToNodeEvent(types.RPCEvent.StableHeightChanged, handleStableHeight)
    }
  }, [state.isConnected])

  // Load custom networks from localStorage on mount:
  useEffect(() => {
    const saved = localStorage.getItem('customNetworks')
    if (saved) {
      try {
        loadCustomNetworksFromStorage()
      } catch (error) {
        console.error('Failed to load custom networks:', error)
      }
    } else {
      const defaultCustomNetworks = new Map([
        ["devnet_default", {
          name: "Devnet",
          url: "ws://136.56.215.96:8080/json_rpc",
          contractAddresses: {}
        }]
      ])
      customNetworksRef.current = defaultCustomNetworks
      saveCustomNetworksToStorage()
    }
  }, [])

  const generateNetworkId = (config: CustomNetworkConfig): string => {
    // Create a base identifier from the URL
    let baseId = `${config.url}`;
    
    // Add contract addresses to the ID if they exist
    if (config.contractAddresses) {
      // Sort the contract keys to ensure consistent ID generation
      const contractKeys = Object.keys(config.contractAddresses).sort();
      
      for (const key of contractKeys) {
        const address = config.contractAddresses[key];
        baseId += `_${key}-${address}`;
      }
    }
    
    // Create a deterministic hash from the baseId
    // This is a simple hash function for demonstration
    let hash = 0;
    for (let i = 0; i < baseId.length; i++) {
      const char = baseId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    // Return a prefixed hash string
    return `custom_${Math.abs(hash).toString(16)}`;
  }

  const sanitizeNetworks = (networks: Map<string, CustomNetworkConfig>): Map<string, CustomNetworkConfig> => {
    const sanitizedNetworks = new Map<string, CustomNetworkConfig>();
    const seenConfigurations = new Set<string>();
    
    // Process each network
    for (const [id, config] of networks.entries()) {
      // Generate a proper ID based on configuration
      const properNetworkId = generateNetworkId(config);
      
      // Create a string representation of the configuration for deduplication
      const configKey = JSON.stringify({
        url: config.url,
        contractAddresses: config.contractAddresses || {}
      });
      
      // Skip if we've already seen this configuration
      if (seenConfigurations.has(configKey)) {
        console.log(`Skipping duplicate network configuration: ${config.name}`);
        continue;
      }
      
      // Add to our seen set and sanitized map
      seenConfigurations.add(configKey);
      sanitizedNetworks.set(properNetworkId, config);
    }
    
    return sanitizedNetworks;
  };

  const setDefaultNetworks = () => {
    const defaultCustomNetworks = new Map([
      ["devnet_default", dalkNet]
    ]);
    
    customNetworksRef.current = defaultCustomNetworks;
    saveCustomNetworksToStorage();
  };

  const loadCustomNetworksFromStorage = () => {
    const saved = localStorage.getItem('customNetworks');
    
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        let networkMap = new Map<string, CustomNetworkConfig>(Object.entries(parsed));
        
        // Sanitize the network map to ensure uniqueness
        networkMap = sanitizeNetworks(networkMap);
        
        // Update references and state
        customNetworksRef.current = networkMap;
        dispatch({ 
          type: 'UPDATE_CUSTOM_NETWORKS', 
          payload: new Map(networkMap) 
        });
        
        // Save the sanitized version back to storage
        saveCustomNetworksToStorage();
        
        console.log(`Loaded ${networkMap.size} custom networks (after sanitization)`);
      } catch (error) {
        console.error('Failed to load custom networks:', error);
        setDefaultNetworks();
      }
    } else {
      setDefaultNetworks();
    }
  };

  const connectToCustomNetwork = async (config: CustomNetworkConfig) => {
    dispatch({ type: 'CONNECT_START' })
    
    try {
      // Create new daemon instance
      const daemon = new DaemonWS()
      
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout after 10 seconds')), 10000)
      })
      
      // Race the connection against the timeout
      await Promise.race([
        daemon.connect(config.url),
        timeoutPromise
      ])
      
      // Test connection by getting network info (also with timeout)
      const networkInfo = await Promise.race([
        daemon.methods.getInfo(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Network info timeout')), 5000)
        )
      ]) as types.GetInfoResult
      
      // Store references
      daemonRef.current = daemon
      
      // Generate a unique ID for this network configuration
      const networkId = generateNetworkId(config);
      
      // Update or add the network
      customNetworksRef.current.set(networkId, config);
      saveCustomNetworksToStorage();

      dispatch({
        type: 'CONNECT_SUCCESS',
        payload: { 
          network: 'custom' as NetworkType, 
          node: { url: config.url, name: config.name }, 
          networkInfo 
        }
      })
    } catch (error: any) {
      dispatch({ 
        type: 'CONNECT_ERROR', 
        payload: error?.message || 'Failed to connect to custom network' 
      })
      daemonRef.current = null
    }
  }

  const updateCustomNetwork = (originalNetworkId: string, config: CustomNetworkConfig) => {
    const newNetworkId = generateNetworkId(config);
    
    if (customNetworksRef.current.has(originalNetworkId)) {
      customNetworksRef.current.delete(originalNetworkId);
    }
    
    customNetworksRef.current.set(newNetworkId, config);
    dispatch({ 
      type: 'UPDATE_CUSTOM_NETWORKS', 
      payload: new Map(customNetworksRef.current) 
    });

    saveCustomNetworksToStorage();
    
    const isCurrentlyConnected = state.currentNetwork === 'custom' && 
      state.currentNode?.name === config.name;
    
    if (isCurrentlyConnected) {
      connectToCustomNetwork(config);
    }
    
    return newNetworkId;
  }

  const saveCustomNetwork = (originalId: string | null, config: CustomNetworkConfig) => {
    const newNetworkId = generateNetworkId(config);
    
    if (originalId && originalId !== newNetworkId && customNetworksRef.current.has(originalId)) {
      customNetworksRef.current.delete(originalId);
    }
    
    customNetworksRef.current.set(newNetworkId, config);
    saveCustomNetworksToStorage();
    
    return newNetworkId;
  }

  const findNetworkByConfig = (config: CustomNetworkConfig): string | null => {
    const networkId = generateNetworkId(config);
    return customNetworksRef.current.has(networkId) ? networkId : null;
  }

  const getCustomNetworks = (): CustomNetworkConfig[] => {
    return Array.from(customNetworksRef.current.values())
  }

  const saveCustomNetworksToStorage = () => {
    const networksObj = Object.fromEntries(customNetworksRef.current)
    localStorage.setItem('customNetworks', JSON.stringify(networksObj))
  }

  const availableNetworks: NetworkType[] = Object.keys(NETWORK_NODES) as NetworkType[]
  const availableNodes: NodeConfig[] | 'custom' = state.currentNetwork ? NETWORK_NODES[state.currentNetwork] : []

  return (
    <NodeContext.Provider value={{
      ...state,
      connectToNetwork,
      connectToCustomNetwork,
      updateCustomNetwork,
      saveCustomNetwork,
      getCustomNetworks,
      switchNode,
      disconnect,
      deleteCustomNetwork,
      subscribeToNodeEvent,
      unsubscribeFromNodeEvent,
      getInfo,
      getHeight,
      getTopoheight,
      getBlockByHash,
      getBlockAtTopoheight,
      getTopBlock,
      getTransaction,
      getTransactions,
      getMempool,
      getEstimatedFeeRates,
      getBalance,
      getAccountHistory,
      getAccountAssets,
      getAsset,
      getAssetSupply,
      getAssets,
      getContractOutputs,
      getContractData,
      getContractBalance,
      getContractModule,
      getContractAssets,
      validateAddress,
      generateNetworkId,
      availableNetworks,
      availableNodes,
      awaitTx,
      recentBlocks: recentBlocksRef.current
    }}>
      {children}
    </NodeContext.Provider>
  )
}

// Native XEL asset hash
export const NATIVE_ASSET_HASH = '0000000000000000000000000000000000000000000000000000000000000000'

export const useNode = (): NodeContextType => {
  const context = useContext(NodeContext)
  if (!context) {
    throw new Error('useNode must be used within a NodeProvider')
  }
  return context
}