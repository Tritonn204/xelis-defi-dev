import { type AddLiquidityParams } from "./types";
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
export const createAddLiquidityTransaction = (params: AddLiquidityParams): Record<string, any> => {
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