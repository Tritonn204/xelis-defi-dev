const API_HTTP = import.meta.env.VITE_API_HTTP ?? window.location.origin;

export interface ContractAddresses {
  router: string;
  factory: string;
}

export interface ExplorerConfig {
  url: string;
  api: string;
}

export interface NetworkInfo {
  name: string;
  chainId: string;
}

export interface NetworkConfig {
  contracts: ContractAddresses;
  explorer: ExplorerConfig;
  network: NetworkInfo;
}

interface NetworkConfigCache {
  mainnet?: NetworkConfig;
  testnet?: NetworkConfig;
  stagenet?: NetworkConfig;
}

let configCache: NetworkConfigCache = {};
let fetchPromises: Map<string, Promise<NetworkConfig>> = new Map();

type Network = 'mainnet' | 'testnet' | 'stagenet';

const FALLBACK_CONFIGS: Record<Network, NetworkConfig> = {
  mainnet: {
    contracts: { router: '', factory: '' },
    explorer: {
      url: 'https://explorer.xelis.io',
      api: 'https://api.explorer.xelis.io'
    },
    network: {
      name: 'Mainnet',
      chainId: 'mainnet'
    }
  },

  testnet: {
    contracts: { router: '', factory: '' },
    explorer: {
      url: 'https://testnet-explorer.xelis.io',
      api: 'https://testnet-api.xelis.io'
    },
    network: {
      name: 'Testnet',
      chainId: 'testnet-1'
    }
  },

  stagenet: {
    contracts: { router: '', factory: '' },
    explorer: {
      url: 'https://stagenet-explorer.xelis.io',
      api: 'https://stagenet-api.xelis.io'
    },
    network: {
      name: 'Stagenet',
      chainId: 'stagenet-1'
    }
  }
};

/**
 * Fetches full network configuration from the backend API
 * Returns cached data if available, otherwise fetches from API
 * @param network - 'mainnet' or 'testnet' or 'stagenet'
 */
export async function fetchNetworkConfig(
  network: Network
): Promise<NetworkConfig> {
  // Return cached data if available
  if (configCache[network]) {
    return configCache[network]!;
  }

  // Return in-flight request if one exists
  const existingPromise = fetchPromises.get(network);
  if (existingPromise) {
    return existingPromise;
  }

  const fetchPromise = fetch(`${API_HTTP}/api/config/networks/${network}`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch ${network} config: ${response.statusText}`);
      }

      const data = await response.json();
      const merged = { ...FALLBACK_CONFIGS[network], ...data };
      configCache[network] = merged;
      return merged;
    })
    .catch((error) => {
      console.error(`Error fetching ${network} config:`, error);
      fetchPromises.delete(network);

      // Correct per-network fallback
      return FALLBACK_CONFIGS[network];
    });

  fetchPromises.set(network, fetchPromise);
  return fetchPromise;
}

/**
 * Gets contract addresses for a specific network
 * @param network - 'mainnet' or 'testnet'
 */
export async function getContractAddressesForNetwork(
  network: 'mainnet' | 'testnet'
): Promise<ContractAddresses> {
  const config = await fetchNetworkConfig(network);
  return config.contracts;
}

/**
 * Gets explorer URL for a specific network
 * @param network - 'mainnet' or 'testnet'
 * @returns Explorer URL
 */
export async function getExplorerUrlForNetwork(
  network: 'mainnet' | 'testnet'
): Promise<string> {
  const config = await fetchNetworkConfig(network);
  return config.explorer.url;
}

/**
 * Gets explorer API URL for a specific network
 * @param network - 'mainnet' or 'testnet'
 * @returns Explorer API URL
 */
export async function getExplorerApiForNetwork(
  network: 'mainnet' | 'testnet'
): Promise<string> {
  const config = await fetchNetworkConfig(network);
  return config.explorer.api;
}

/**
 * Gets full network info for a specific network
 * @param network - 'mainnet' or 'testnet'
 */
export async function getNetworkInfo(
  network: 'mainnet' | 'testnet'
): Promise<NetworkInfo> {
  const config = await fetchNetworkConfig(network);
  return config.network;
}

/**
 * Clears the network config cache
 * Useful for forcing a refresh
 */
export function clearConfigCache(network?: 'mainnet' | 'testnet'): void {
  if (network) {
    delete configCache[network];
    fetchPromises.delete(network);
  } else {
    configCache = {};
    fetchPromises.clear();
  }
}

// Legacy compatibility - fetches both networks in old format
export async function fetchContractAddresses() {
  const [mainnetConfig, testnetConfig] = await Promise.all([
    fetchNetworkConfig('mainnet').catch(() => null),
    fetchNetworkConfig('testnet').catch(() => null),
  ]);

  return {
    mainnet: mainnetConfig?.contracts,
    testnet: testnetConfig?.contracts,
    explorer_mainnet: mainnetConfig?.explorer.url,
    explorer_testnet: testnetConfig?.explorer.url,
  };
}

// Alias for backward compatibility
export const clearContractCache = clearConfigCache;
