// Simple hash function to generate color from string
export const stringToColor = (str: string) => {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  
  // Convert to RGB
  const r = (hash >> 16) & 0xFF
  const g = (hash >> 8) & 0xFF
  const b = hash & 0xFF
  
  // Ensure colors are bright enough
  const minBrightness = 80
  const adjustedR = Math.max(minBrightness, r)
  const adjustedG = Math.max(minBrightness, g)
  const adjustedB = Math.max(minBrightness, b)
  
  return `rgb(${adjustedR}, ${adjustedG}, ${adjustedB})`
}

/**
 * Converts a hex string to a byte array
 * @param {string} hex - Hex string to convert
 * @returns {number[]} Byte array
 */
export const hexToBytes = (hex: string) => {
  // Remove '0x' prefix if it exists
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  
  // Convert hex string to byte array
  const bytes = []
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.slice(i, i + 2), 16))
  }
  
  return bytes
}