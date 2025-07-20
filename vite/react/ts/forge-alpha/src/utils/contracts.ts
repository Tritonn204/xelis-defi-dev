/**
 * Formats an amount from display format to contract format
 * @param {string|number} amount - Amount in display format
 * @param {number} decimals - Number of decimals for the token
 * @returns {number} Amount in smallest units for the contract
 */
export const formatAmountForContract = (amount: string|number, decimals: number) => {
  if (!amount) return 0
  const parsedAmount = parseFloat(amount as string)
  if (isNaN(parsedAmount)) return 0
  return Math.floor(parsedAmount * Math.pow(10, decimals))
}

/**
 * Formats an amount from contract format to display format
 * @param {number} amount - Amount in smallest units
 * @param {number} decimals - Number of decimals for the token
 * @returns {string} Formatted amount for display
 */
export const formatAmountForDisplay = (amount: number, decimals: number) => {
  if (!amount) return '0'
  return (amount / Math.pow(10, decimals)).toFixed(Math.min(decimals, 8))
}

export const getExitCodeFromOutputs = (
  outputs: Array<{ exit_code: number | null }>
): number | null => {
  for (const output of outputs) {
    if (typeof output === 'object' && 'exit_code' in output && output.exit_code !== null) {
      return output.exit_code
    }
  }
  return null
}