/**
 * Parameters for adding liquidity to a DEX pair
 * @example
 * ```typescript
 * const params: AddLiquidityParams = {
 *   routerContract: (hex)"123...",
 *   token1Hash: (hex)"abc...",
 *   token2Hash: (hex)"def...",
 *   token1Amount: 1000000000,
 *   token2Amount: 2000000000,
 *   maxGas: 200000000
 * };
 * ```
 */
export interface AddLiquidityParams {
  /** 
   * Address of the DEX router contract
   * @example (hex)"1234567890abcdef..."
   */
  routerContract: string;
  
  /** 
   * Hash identifier of the first token in the pair
   * @format 64-character hexadecimal string
   * @example (hex)"abc123..."
   */
  token1Hash: string;
  
  /** 
   * Hash identifier of the second token in the pair
   * @format 64-character hexadecimal string
   * @example (hex)"def456..."
   */
  token2Hash: string;
  
  /** 
   * Amount of the first token to deposit into the liquidity pool
   * @minimum 0
   */
  token1Amount: number;
  
  /** 
   * Amount of the second token to deposit into the liquidity pool
   * @minimum 0
   */
  token2Amount: number;
  
  /** 
   * Maximum gas units to allocate for the transaction
   * @default 200000000
   * @minimum 1000000
   */
  maxGas?: number;
}

/**
 * Parameters for removing liquidity from a DEX pair
 * @description Burns liquidity tokens and receives back the underlying token pair
 * @example
 * ```typescript
 * const params: RemoveLiquidityParams = {
 *   contract: (hex)"789...",
 *   liquidityTokenHash: (hex)"lp123...",
 *   liquidityAmount: 500000000,
 *   maxGas: 200000000
 * };
 * ```
 */
export interface RemoveLiquidityParams {
  /** 
   * Address of the DEX contract
   * @example (hex)"789..."
   */
  contract: string;
  
  /** 
   * Hash of the LP (liquidity provider) token to burn
   * @format 64-character hexadecimal string
   */
  liquidityTokenHash: string;
  
  /** 
   * Amount of liquidity tokens to burn
   * @description This will be exchanged for proportional amounts of the underlying tokens
   * @minimum 1
   */
  liquidityAmount: number | bigint;
  
  /** 
   * Maximum gas units to allocate for the transaction
   * @default 200000000
   * @minimum 1000000
   */
  maxGas?: number;
}

/**
 * Parameters for swapping tokens on a DEX
 * @description Executes a token swap with slippage protection
 * @example
 * ```typescript
 * const params: SwapParams = {
 *   contract: (hex)"swap...",
 *   tokenInHash: (hex)"token1...",
 *   tokenOutHash: (hex)"token2...",
 *   amountIn: 1000n,
 *   amountOutMin: 950n, // 5% slippage tolerance
 *   maxGas: 200000000
 * };
 * ```
 */
export interface SwapParams {
  /** 
   * Address of the DEX contract
   * @example (hex)"swap..."
   */
  contract: string;
  
  /** 
   * Hash of the token being sold/sent
   * @format 64-character hexadecimal string
   * @description The token you're providing for the swap
   */
  tokenInHash: string;
  
  /** 
   * Hash of the token to be received
   * @format 64-character hexadecimal string
   * @description The token you want to receive from the swap
   */
  tokenOutHash: string;
  
  /** 
   * Amount of input tokens to swap
   * @description The exact amount of tokenIn to be sold
   * @minimum 1
   */
  amountIn: number | bigint;
  
  /** 
   * Minimum amount of output tokens to receive
   * @description Protects against slippage. Transaction reverts if output is less than this
   * @minimum 0
   */
  amountOutMin: number | bigint;
  
  /** 
   * Maximum gas units to allocate for the transaction
   * @default 200000000
   * @minimum 1000000
   */
  maxGas?: number;
}