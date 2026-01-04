/**
 * Creates a sparkline symbol using asset hash + quote (hash or 'USD')
 * @param assetHash - The base asset hash (40+ hex chars)
 * @param quoteHashOrUsd - Quote asset hash or 'USD' for oracle pricing
 */
export const createSparklineSymbol = (assetHash: string, quoteHashOrUsd: string = 'XEL'): string => {
  if (!assetHash) return '';
  // Clean hash format (remove 0x prefix if present)
  const cleanHash = assetHash.replace(/^0x/, '').toLowerCase();
  const cleanQuote = quoteHashOrUsd === 'USD' ? 'USD' : quoteHashOrUsd.replace(/^0x/, '').toLowerCase();
  return `${cleanHash}_${cleanQuote}`;
};

/**
 * Creates a USD symbol for oracle pricing
 * @param assetHash - The asset hash
 */
export const createUsdSymbol = (assetHash: string): string => {
  if (!assetHash) return '';
  const cleanHash = assetHash.replace(/^0x/, '').toLowerCase();
  return `${cleanHash}_USD`;
};