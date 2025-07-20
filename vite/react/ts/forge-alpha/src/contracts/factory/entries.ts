import { vmParam, createContractInvocation, createContractDeployment } from '@/utils/xvmSerializer';

// Define the token contract interface types
export interface CreateTokenParams {
  contract: string;
  name: string;
  ticker: string;
  decimals: number;
  supply: number;
  mintable: boolean;
  maxSupply: number;
  maxGas?: number;
}

export interface MintTokensParams {
  contract: string;
  assetHash: string;
  mintAmount: number;
  maxGas?: number;
}

export interface TransferOwnershipParams {
  contract: string;
  assetHash: string;
  ownerAddress: string;
  maxGas?: number;
}

export interface RenounceOwnershipParams {
  contract: string;
  assetHash: string;
  maxGas?: number;
}

export interface DeployContractParams {
  bytecode: string;
  hasConstructor?: boolean;
  maxGas?: number;
}

/**
 * Creates a transaction to create a new token
 * @param params - Parameters for token creation
 * @returns Transaction data object
 */
export const createTokenTransaction = (params: CreateTokenParams): Record<string, any> => {
  const { 
    contract, 
    name, 
    ticker, 
    decimals, 
    supply, 
    mintable, 
    maxSupply, 
    maxGas = 200000000 
  } = params;

  const adjustedSupply = supply * 10 ** decimals;
  const adjustedMaxSupply = maxSupply * 10 ** decimals;

  return createContractInvocation({
    contract,
    chunkId: 2,
    parameters: [
      vmParam.string(name),
      vmParam.string(ticker),
      vmParam.u64(adjustedSupply),
      vmParam.u8(decimals),
      vmParam.boolean(mintable),
      vmParam.u64(adjustedMaxSupply)
    ],
    deposits: {
      "0000000000000000000000000000000000000000000000000000000000000000": 100000000 // 1XEL Forge fee
    },
    maxGas
  });
};

/**
 * Creates a transaction to mint tokens
 * @param params - Parameters for token minting
 * @returns Transaction data object
 */
export const createMintTokensTransaction = (params: MintTokensParams): Record<string, any> => {
  const { contract, assetHash, mintAmount, maxGas = 200000000 } = params;

  return createContractInvocation({
    contract,
    chunkId: 3,
    parameters: [
      vmParam.hash(assetHash),
      vmParam.u64(mintAmount)
    ],
    maxGas
  });
};

/**
 * Creates a transaction to transfer token ownership
 * @param params - Parameters for ownership transfer
 * @returns Transaction data object
 */
export const createTransferOwnershipTransaction = (params: TransferOwnershipParams): Record<string, any> => {
  const { contract, assetHash, ownerAddress, maxGas = 200000000 } = params;

  return createContractInvocation({
    contract,
    chunkId: 4,
    parameters: [
      vmParam.hash(assetHash),
      vmParam.address(ownerAddress)
    ],
    maxGas
  });
};

/**
 * Creates a transaction to renounce token ownership
 * @param params - Parameters for ownership renouncement
 * @returns Transaction data object
 */
export const createRenounceOwnershipTransaction = (params: RenounceOwnershipParams): Record<string, any> => {
  const { contract, assetHash, maxGas = 200000000 } = params;

  return createContractInvocation({
    contract,
    chunkId: 5,
    parameters: [
      vmParam.hash(assetHash)
    ],
    maxGas
  });
};

/**
 * Creates a transaction to deploy a contract
 * @param params - Parameters for contract deployment
 * @returns Transaction data object
 */
export const createDeployContractTransaction = (params: DeployContractParams): Record<string, any> => {
  const { bytecode, hasConstructor = false, maxGas = 200000000 } = params;

  return createContractDeployment({
    bytecode,
    hasConstructor,
    maxGas
  });
};