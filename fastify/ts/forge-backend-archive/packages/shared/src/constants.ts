export const MINUTE = 60_000;
export const NATIVE_ASSET_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

// Virtual USD asset for cross-router/oracle use.
// Hash is the fixed (precomputed) SHA-256 of "forge:virtual:v1:USD".
export const VIRTUAL_USD = {
  hashHex: 'e9782212becc29641594f1ef64e036e4496ed15446990e051d2e0a92d2e024ac',
  ticker: 'USD',
  decimals: 2,
} as const;