/**
 * Parameters for adding liquidity to a DEX pair
 * @example
 * ```typescript
 * const params: AddLiquidityParams = {
 *   contract: (hex)"123...",
 *   asset: (hex)"abc...",
 *   amount: 1000000000,
 *   maxGas: 200000000
 * };
 * ```
 */
export interface DepositParams {
  /** 
   * Address of the DEX router contract
   * @example (hex)"1234567890abcdef..."
   */
  contract: string;
  
  /** 
   * Hash identifier of the token
   * @format 64-character hexadecimal string
   * @example (hex)"abc123..."
   */
  asset: string;

  /** 
   * Amount of the first token to deposit into contract (atomic units)
   * @minimum 2
   */
  amount: number;
  
  /** 
   * Maximum gas units to allocate for the transaction
   * @default 200000000
   * @minimum 1000000
   */
  maxGas?: number;
}