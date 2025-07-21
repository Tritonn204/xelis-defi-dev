import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNode, NATIVE_ASSET_HASH } from '@/contexts/NodeContext';
import { useWallet } from '@/contexts/WalletContext';
import Decimal from 'decimal.js';

export interface PoolData {
  name: string
  tvl: number
  tickers: [string, string]
  names: [string, string]
  hashes: [string, string]
  locked: [string, string]
  userShare: string | undefined
  totalLpSupply: BigInt
}

interface PoolContextType {
  activePools: Map<string, PoolData>;
  setActivePools: React.Dispatch<React.SetStateAction<Map<string, PoolData>>>;
  loadingPools: boolean;
  poolsError: string | null;
  refreshPools: () => void;
  routerContract?: string;
}

const PoolContext = createContext<PoolContextType | undefined>(undefined);

export const PoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activePools, setActivePools] = useState<Map<string, PoolData>>(new Map());
  const [loadingPools, setLoadingPools] = useState(false);
  const [poolsError, setPoolsError] = useState<string | null>(null);
  
  const { 
    currentNetwork, 
    currentNode, 
    customNetworks,
    getContractData,
    getContractAssets,
    getAsset,
    getAssetSupply,
  } = useNode();
  
  const { 
    isConnected,
    getRawBalance 
  } = useWallet();

  // Get router contract address
  const getRouterContract = () => {
    if (currentNetwork === 'custom' && currentNode) {
      const networkConfig = Array.from(customNetworks.values())
        .find(network => network.name === currentNode.name)
      
      return networkConfig?.contractAddresses?.router
    }
    return undefined
  }

  const routerContract = getRouterContract();

  const loadPools = async () => {
    if (!routerContract) {
      setActivePools(new Map());
      return;
    }

    setLoadingPools(true);
    setPoolsError(null);

    try {
      const assetList = await getContractAssets(routerContract);
      const pools = new Map<string, PoolData>();

      for (const id of assetList) {
        if (id === NATIVE_ASSET_HASH) continue;

        const data = await getContractData({
          contract: routerContract,
          key: {
            type: "default",
            value: {
              type: "opaque",
              value: { type: "Hash", value: id },
            },
          },
        });

        if (
          data?.data.type === "object" &&
          data?.data.value.length === 2 &&
          data?.data.value[1].type === "map"
        ) {
          const lpMap = data.data.value[1].value;
          const [tokenA, tokenB] = Object.keys(lpMap);
          const poolKey = `${tokenA}_${tokenB}`;

          const dataA = await getAsset({ asset: tokenA });
          const dataB = await getAsset({ asset: tokenB });
          const symbolA = dataA.ticker;
          const symbolB = dataB.ticker;

          let totalA = lpMap[tokenA];
          let totalB = lpMap[tokenB];

          totalA = totalA / BigInt(10 ** dataA.decimals);
          totalB = totalB / BigInt(10 ** dataB.decimals);

          const lpTotal: BigInt = (await getAssetSupply({ asset: id })).data;
          let userShare: string | undefined = undefined;

          if (isConnected) {
            try {
              const myLp: BigInt = BigInt(await getRawBalance(id));
              userShare = new Decimal(myLp.toString()).div(lpTotal.toString()).mul(100).toFixed(3).toString();
            } catch (err) {
              console.error('Error getting user LP balance:', err);
            }
          }

          const poolData: PoolData = {
            name: `${symbolA} - ${symbolB}`,
            tvl: 0,
            tickers: [symbolA, symbolB],
            names: [dataA.name, dataB.name],
            hashes: [tokenA, tokenB],
            locked: [totalA.toString(), totalB.toString()],
            userShare,
            totalLpSupply: lpTotal
          };

          pools.set(poolKey, poolData);
        }
      }

      setActivePools(pools);
    } catch (error: any) {
      console.error('Error loading pools:', error);
      setPoolsError(error.message || 'Failed to load pools');
    } finally {
      setLoadingPools(false);
    }
  };

  // Load pools when router contract is available or connection status changes
  useEffect(() => {
    loadPools();
  }, [routerContract, isConnected, currentNetwork, currentNode]);

  const refreshPools = () => {
    loadPools();
  };

  return (
    <PoolContext.Provider value={{ 
      activePools, 
      setActivePools,
      loadingPools,
      poolsError,
      refreshPools,
      routerContract
    }}>
      {children}
    </PoolContext.Provider>
  );
};

export const usePools = () => {
  const context = useContext(PoolContext);
  if (!context) {
    throw new Error('usePools must be used within a PoolProvider');
  }
  return context;
};