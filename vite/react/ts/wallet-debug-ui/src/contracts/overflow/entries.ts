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
export const createUnsafeRefund = (params: types.DepositParams): Record<string, any> => {
  const { contract, asset, amount, maxGas = 200000000 } = params;

  return createContractInvocation({
    contract,
    maxGas,
    chunkId: 1,
    parameters: [
      vmParam.hash(asset),
    ],
    deposits: {
      [asset]: amount,
    }
  })
}

export const createSafeRefund = (params: types.DepositParams): Record<string, any> => {
  const { contract, asset, amount, maxGas = 200000000 } = params;

  return createContractInvocation({
    contract,
    maxGas,
    chunkId: 2,
    parameters: [
      vmParam.hash(asset),
    ],
    deposits: {
      [asset]: amount,
    }
  })
}