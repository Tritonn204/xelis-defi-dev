import { NATIVE_ASSET_HASH } from '@/contexts/NodeContext';
import { vmParam, createContractInvocation, createContractDeployment, createDeposits } from '@/utils/xvmSerializer';
import type * as types from './types';

/**
 * Creates a transaction to create a new token
 * @param params - Parameters for token creation
 * @returns Transaction data object
 */
export const createTokenTransaction = (params: types.CreateTokenParams): Record<string, any> => {
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
      [NATIVE_ASSET_HASH]: 100000000
    },
    maxGas
  });
};

/**
 * Creates a transaction to mint tokens
 * @param params - Parameters for token minting
 * @returns Transaction data object
 */
export const createMintTokensTransaction = (params: types.MintTokensParams): Record<string, any> => {
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
export const createTransferOwnershipTransaction = (params: types.TransferOwnershipParams): Record<string, any> => {
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
export const createRenounceOwnershipTransaction = (params: types.RenounceOwnershipParams): Record<string, any> => {
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
export const createDeployContractTransaction = (params: types.DeployContractParams): Record<string, any> => {
  const { bytecode, hasConstructor = false, maxGas = 200000000 } = params;

  return createContractDeployment({
    bytecode,
    hasConstructor,
    maxGas
  });
};