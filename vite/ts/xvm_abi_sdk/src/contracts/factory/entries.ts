import { NATIVE_ASSET_HASH } from '@/constants';
import { VMParam, createContractInvocation, createContractDeployment, createDeposits } from '@/utils/xvmSerializer';
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
    maxGas = 50000000,
    icon = ""
  } = params;

  const adjustedSupply = supply * 10 ** decimals;
  const adjustedMaxSupply = maxSupply * 10 ** decimals;

  return createContractInvocation({
    contract,
    entryId: 9,
    parameters: [
      VMParam.string(name),
      VMParam.string(ticker),
      VMParam.u64(adjustedSupply),
      VMParam.u8(decimals),
      VMParam.boolean(mintable),
      VMParam.u64(adjustedMaxSupply),
      VMParam.string(icon)
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
  const { contract, assetHash, mintAmount, maxGas = 50000000 } = params;

  return createContractInvocation({
    contract,
    entryId: 10,
    parameters: [
      VMParam.hash(assetHash),
      VMParam.u64(mintAmount)
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
  const { contract, assetHash, ownerAddress, maxGas = 50000000 } = params;

  return createContractInvocation({
    contract,
    entryId: 11,
    parameters: [
      VMParam.hash(assetHash),
      VMParam.address(ownerAddress)
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
  const { contract, assetHash, maxGas = 50000000 } = params;

  return createContractInvocation({
    contract,
    entryId: 12,
    parameters: [
      VMParam.hash(assetHash)
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
  const { bytecode, hasConstructor = false, maxGas = 50000000 } = params;

  return createContractDeployment({
    bytecode,
    hasConstructor,
    maxGas
  });
};