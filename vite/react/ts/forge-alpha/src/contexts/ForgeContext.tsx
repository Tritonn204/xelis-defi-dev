import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { NETWORK_NODES, NodeConfig, useNode } from './NodeContext';
import { create_typed_contract, TypedContract, type ABI } from '@/utils/TypedContract'; // Adjust this import path
import factoryABI from '@/contracts/factory.abi.json';
import routerABI from '@/contracts/router.abi.json';
import { ApplicationData } from '@xelis/sdk/xswd/types';
import { createHash } from "crypto"

interface ForgeContextType {
  factory?: TypedContract<ABI>;
  router?: TypedContract<ABI>;
  isProMode: boolean;
  toggleProMode: () => void;
  setProMode: (value: boolean) => void;
}

// Intend to deprecate
export const generateSessionAppId = () => {
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

const generateAppId = (): string => {
  const prefix = "666f726765" // "forge" in hex (10 chars)
  const source = "XELIS Forge|https://www.xelisforge.app"

  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  // Convert to unsigned 32-bit hex
  const baseHex = (hash >>> 0).toString(16).padStart(8, "0")

  // Expand deterministically to required length
  const remainingLength = 64 - prefix.length
  const repeatedHex = baseHex.repeat(
    Math.ceil(remainingLength / baseHex.length)
  )

  const appId = prefix + repeatedHex.slice(0, remainingLength)

  if (appId.length !== 64 || !/^[0-9a-f]{64}$/i.test(appId)) {
    throw new Error(`Invalid app ID generated: ${appId.length} chars`)
  }

  return appId
}

export const forgeAppData: ApplicationData = {
  id: generateAppId(),
  name: 'XELIS Forge',
  url: "https://www.xelisforge.app",
  description: 'Deploy, manage, and trade XELIS Assets!',
  permissions: [
    "build_transaction",
    "get_address",
    "get_balance",
    "get_asset",
    "get_assets",
    "track_asset",
    "untrack_asset",
    "is_asset_tracked",
    "network_info",
    "clear_tx_cache",
  ],
}

const ForgeContext = createContext<ForgeContextType | undefined>(undefined);

export const ForgeProvider = ({ children }: { children: ReactNode }) => {
  const { currentNetwork, currentNode, customNetworks } = useNode();

  const [factory, setFactory] = useState<TypedContract<ABI>>();
  const [router, setRouter] = useState<TypedContract<ABI>>();
  const [isProMode, setIsProMode] = useState(() => {
    try {
      return localStorage.getItem('trade-pro-mode') === 'true'
    } catch {
      return false
    }
  });

  const toggleProMode = () => {
    const newMode = !isProMode
    setIsProMode(newMode)
    try {
      localStorage.setItem('trade-pro-mode', String(newMode))
    } catch {
      console.warn('Failed to save pro mode preference to localStorage')
    }
  }

  // Clear contracts immediately when network or node URL changes to prevent stale data
  const currentNodeUrl = currentNode?.url;
  useEffect(() => {
    setFactory(undefined);
    setRouter(undefined);
  }, [currentNetwork, currentNodeUrl]);

  useEffect(() => {
    if (!currentNode || !currentNetwork) return;

    // For mainnet/testnet, use currentNode.contractAddresses (dynamically fetched from API)
    // For custom networks, look up in customNetworks map
    const contractAddresses = currentNetwork === 'custom'
      ? Array.from(customNetworks.values())
          .find(network => network.name === currentNode.name)?.contractAddresses
      : currentNode.contractAddresses;

    const factoryAddr = contractAddresses?.factory;
    const routerAddr = contractAddresses?.router;

    if (factoryAddr) {
      setFactory(create_typed_contract(factoryAddr, factoryABI as ABI));
    } else {
      setFactory(undefined);
    }

    if (routerAddr) {
      setRouter(create_typed_contract(routerAddr, routerABI as ABI));
    } else {
      setRouter(undefined);
    }
  }, [currentNetwork, currentNode, customNetworks]);

  return (
    <ForgeContext.Provider value={{ 
      factory, 
      router,
      isProMode,
      toggleProMode,
      setProMode: setIsProMode
    }}>
      {children}
    </ForgeContext.Provider>
  );
};

export const useForge = (): ForgeContextType => {
  const context = useContext(ForgeContext);
  if (!context) {
    throw new Error('useForge must be used within a ForgeProvider');
  }
  return context;
};
