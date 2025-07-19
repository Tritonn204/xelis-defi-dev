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