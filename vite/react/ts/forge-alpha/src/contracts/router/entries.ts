import * as types from "./types";
import { vmParam, createContractInvocation } from "@/utils/xvmSerializer";

/**
 * Creates a transaction to add liquidity to a pool
 * @param {Object} params - Parameters for adding liquidity
 * @param {string} params.routerContract - Address of the router contract
 * @param {string} params.token1Hash - Hash of the first token
 * @param {string} params.token2Hash - Hash of the second token
 * @param {number} params.token1Amount - Amount of the first token (in smallest units)
 * @param {number} params.token2Amount - Amount of the second token (in smallest units)
 * @param {number} params.maxGas - Maximum gas to use for the transaction
 * @returns {Object} Transaction data object
 */
export const createAddLiquidityTransaction = (params: types.AddLiquidityParams): Record<string, any> => {
  const { routerContract, token1Hash, token2Hash, token1Amount, token2Amount, maxGas = 200000000 } = params;

  return createContractInvocation({
    contract: routerContract,
    maxGas,
    chunkId: 10,
    parameters: [
      vmParam.hash(token1Hash),
      vmParam.hash(token2Hash)
    ],
    deposits: {
      [token1Hash]: token1Amount,
      [token2Hash]: token2Amount
    }
  })
}

/**
 * Creates a transaction to remove liquidity from a pair
 * @param params - Parameters for liquidity removal
 * @returns Transaction data object
 */
export const createRemoveLiquidityTransaction = (params: types.RemoveLiquidityParams): Record<string, any> => {
  const { 
    contract, 
    liquidityTokenHash, 
    liquidityAmount,
    maxGas = 200000000 
  } = params;

  return createContractInvocation({
    contract,
    chunkId: 11,
    parameters: [
      vmParam.hash(liquidityTokenHash)
    ],
    deposits: {
      [liquidityTokenHash]: liquidityAmount
    },
    maxGas
  });
};

/**
 * Creates a transaction to swap tokens
 * @param params - Parameters for token swap
 * @returns Transaction data object
 */
export const createSwapTransaction = (params: types.SwapParams): Record<string, any> => {
  const { 
    contract, 
    tokenInHash, 
    tokenOutHash, 
    amountIn,
    amountOutMin,
    maxGas = 200000000 
  } = params;

  return createContractInvocation({
    contract,
    chunkId: 12,
    parameters: [
      vmParam.hash(tokenInHash),
      vmParam.hash(tokenOutHash),
      vmParam.u64(amountOutMin)
    ],
    deposits: {
      [tokenInHash]: amountIn
    },
    maxGas
  });
};