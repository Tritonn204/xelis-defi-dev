export interface AddLiquidityParams {
  routerContract: string;
  token1Hash: string;
  token2Hash: string;
  token1Amount: number;
  token2Amount: number;
  maxGas?: number;
}