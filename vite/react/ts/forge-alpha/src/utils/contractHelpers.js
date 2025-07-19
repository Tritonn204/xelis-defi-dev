/**
 * Creates a transaction to add liquidity to a pool
 * @param {Object} params - Parameters for adding liquidity
 * @param {string} params.routerAddress - Address of the router contract
 * @param {string} params.token1Hash - Hash of the first token
 * @param {string} params.token2Hash - Hash of the second token
 * @param {number} params.token1Amount - Amount of the first token (in smallest units)
 * @param {number} params.token2Amount - Amount of the second token (in smallest units)
 * @param {number} params.maxGas - Maximum gas to use for the transaction
 * @returns {Object} Transaction data object
 */
export const createAddLiquidityTransaction = (params) => {
  const { routerAddress, token1Hash, token2Hash, token1Amount, token2Amount, maxGas = 200000000 } = params;

  // Match the structure from the Dart SDK
  return {
    invoke_contract: {
      contract: routerAddress,
      max_gas: parseInt(maxGas),
      chunk_id: 10,
      parameters: [
        { 
          type: "default", 
          value: { 
            type: "opaque", 
            value: { 
              type: "Hash", 
              value: token1Hash 
            } 
          } 
        },
        { 
          type: "default", 
          value: { 
            type: "opaque", 
            value: { 
              type: "Hash", 
              value: token2Hash 
            } 
          } 
        }
      ],
      deposits: {
        [token1Hash]: { amount: token1Amount },
        [token2Hash]: { amount: token2Amount }
      }
    },
    broadcast: true
  };
};

/**
 * Converts a hex string to a byte array
 * @param {string} hex - Hex string to convert
 * @returns {number[]} Byte array
 */
export const hexToBytes = (hex) => {
  // Remove '0x' prefix if it exists
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  
  // Convert hex string to byte array
  const bytes = []
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.slice(i, i + 2), 16))
  }
  
  return bytes
}

/**
 * Formats an amount from display format to contract format
 * @param {string|number} amount - Amount in display format
 * @param {number} decimals - Number of decimals for the token
 * @returns {number} Amount in smallest units for the contract
 */
export const formatAmountForContract = (amount, decimals) => {
  if (!amount) return 0
  const parsedAmount = parseFloat(amount)
  if (isNaN(parsedAmount)) return 0
  return Math.floor(parsedAmount * Math.pow(10, decimals))
}

/**
 * Formats an amount from contract format to display format
 * @param {number} amount - Amount in smallest units
 * @param {number} decimals - Number of decimals for the token
 * @returns {string} Formatted amount for display
 */
export const formatAmountForDisplay = (amount, decimals) => {
  if (!amount) return '0'
  return (amount / Math.pow(10, decimals)).toFixed(Math.min(decimals, 8))
}