import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNode, NATIVE_ASSET_HASH } from '@/contexts/NodeContext';
import { useWallet } from '@/contexts/WalletContext';
import { type Asset } from '@/contexts/AssetContext';
import Decimal from 'decimal.js';
import { vmParam } from '@/utils/xvmSerializer';
import { genericTransformer } from '@/utils/types';
import { getForgeMetaForAssets } from '@/utils/getForgeMeta';

export interface PoolData {
  name: string
  lpAsset: string,
  tickers: [string, string]
  names: [string, string]
  hashes: [string, string]
  locked: [string, string]
  userShare: string | undefined
  totalLpSupply: BigInt
  userPool: boolean,
  userTracked: boolean
}

const XEL_PRICE_URL = 'https://api.coinpaprika.com/v1/tickers/xel-xelis?quotes=USD,EUR,BTC'

interface PoolContextType {
  activePools: Map<string, PoolData>;
  poolAssets: Map<string, Asset>;
  setActivePools: React.Dispatch<React.SetStateAction<Map<string, PoolData>>>;
  loadingPools: boolean;
  poolsError: string | null;
  refreshPools: () => void;
  routerContract?: string;
}

const PoolContext = createContext<PoolContextType | undefined>(undefined);

export const PoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [poolAssets, setPoolAssets] = useState<Map<string, Asset>>(new Map());
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
    getRawBalance,
    ownedAssets,
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

  // Get factory contract address
  const getFactoryContract = () => {
    if (currentNetwork === 'custom' && currentNode) {
      const networkConfig = Array.from(customNetworks.values())
        .find(network => network.name === currentNode.name)
      
      return networkConfig?.contractAddresses?.factory
    }
    return undefined
  }

  const routerContract = getRouterContract();
  const factoryContract = getFactoryContract();

  const loadPools = async () => {
    if (!routerContract) {
      setActivePools(new Map());
      return;
    }

    setLoadingPools(true);
    setPoolsError(null);

    try {
      const assetMetaMap = new Map<string, Asset>();
      const assetList = await getContractAssets(routerContract);

      const tokenHashes = new Set<string>();
      for (const id of assetList) {
        if (id === NATIVE_ASSET_HASH) continue;
        try {
          const data = await getContractData({ contract: routerContract, key: vmParam.hash(id) });
          if (data?.data?.type === 'object' && data.data.value[1]?.type === 'map') {
            const lpMap = data.data.value[1].value;
            Object.keys(lpMap).forEach(hash => tokenHashes.add(hash));
          }
        } catch(err: any) {
          continue;
        }
      }

      const forgeMetaMap = factoryContract
        ? await getForgeMetaForAssets(factoryContract, Array.from(tokenHashes), getContractData)
        : {};

      const pools = new Map<string, PoolData>();

      for (const id of assetList) {
        if (id === NATIVE_ASSET_HASH) continue;

        console.log("pre call")
        let data: any = {}
        try {
          data = await getContractData({
            contract: routerContract,
            key: vmParam.hash(id),
          });
        } catch(err: any) {
          continue;
        }

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

          const forgeDataA = forgeMetaMap[tokenA];
          const forgeDataB = forgeMetaMap[tokenB];

          assetMetaMap.set(tokenA, {
            hash: tokenA,
            ticker: symbolA,
            name: dataA.name,
            balance: '0',
            price: 0,
            isForge: !!forgeDataA,
            mintable: false, // not relevant
            logo: forgeDataA?.[4]?.value,
            decimals: dataA.decimals,
          });

          assetMetaMap.set(tokenB, {
            hash: tokenB,
            ticker: symbolB,
            name: dataB.name,
            balance: '0',
            price: 0,
            isForge: !!forgeDataB,
            mintable: false,  // not relevant
            logo: forgeDataB?.[4]?.value,
            decimals: dataB.decimals,
          });

          let totalA = lpMap[tokenA];
          let totalB = lpMap[tokenB];

          totalA = totalA / BigInt(10 ** dataA.decimals);
          totalB = totalB / BigInt(10 ** dataB.decimals);

          const lpTotal: BigInt = (await getAssetSupply({ asset: id })).data;
          let userShare: string | undefined = undefined;
          let userLp: BigInt | undefined = undefined;

          if (isConnected) {
            try {
              userLp = BigInt(await getRawBalance(id));
              userShare = new Decimal(userLp.toString()).div(lpTotal.toString()).mul(100).toFixed(3).toString();
            } catch (err) {
              console.error('Error getting user LP balance:', err);
            }
          }

          const poolData: PoolData = {
            name: `${symbolA} - ${symbolB}`,
            lpAsset: id,
            tickers: [symbolA, symbolB],
            names: [dataA.name, dataB.name],
            hashes: [tokenA, tokenB],
            locked: [totalA.toString(), totalB.toString()],
            userShare,
            userPool: !!ownedAssets?.get(id),
            userTracked: !!userLp,
            totalLpSupply: lpTotal
          };

          if (poolData.userShare) {
            console.log(`User owns ${poolData.name}, userTracked = ${poolData.userTracked}`)
          } else {
            console.log(`User does NOT own ${poolData.name}`)
          }

          pools.set(poolKey, poolData);
        }
      }

      setPoolAssets(new Map(assetMetaMap))
      setActivePools(new Map(pools));
    } catch (error: any) {
      console.error('Error loading pools:', error.message || error);
      setPoolsError(error.message || 'Failed to load pools');
    } finally {
      setLoadingPools(false);
    }
  };

  // Load pools when router contract is available or connection status changes
  useEffect(() => {
    loadPools();
  }, [routerContract, isConnected, currentNetwork, currentNode, ownedAssets]);

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
      routerContract,
      poolAssets
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