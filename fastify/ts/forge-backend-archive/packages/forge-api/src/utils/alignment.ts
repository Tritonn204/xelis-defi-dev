export function alignTimeRange(
  fromMs: number,
  toMs: number,
  resolution: string
): { alignedFrom: number; alignedTo: number; chunkSize: number } {
  
  const CHUNK_CONFIGS = {
    '1': {
      size: 7 * 86400000,         // 7 days chunk
      align: 86400000,            // Align to day boundaries ✅ (smaller than chunk)
      maxBars: 10080,
    },
    '5': {
      size: 14 * 86400000,        // 14 days chunk (reduced for better size)
      align: 86400000,            // Align to day boundaries ✅
      maxBars: 4032,
    },
    '15': {
      size: 30 * 86400000,        // 30 days chunk (reduced from 90)
      align: 86400000,            // Align to day boundaries ✅
      maxBars: 2880,
    },
    '60': {
      size: 90 * 86400000,        // 90 days chunk (reduced from 365)
      align: 86400000,            // Align to day boundaries ✅ (NOT month!)
      maxBars: 2160,
    },
    '240': {
      size: 365 * 86400000,       // 1 year chunk (reduced from 3 years)
      align: 86400000 * 7,        // Align to week boundaries ✅ (NOT month!)
      maxBars: 2190,
    },
    '1D': {
      size: 365 * 86400000,       // 1 year chunk (reduced from 5 years)
      align: 86400000 * 30,       // Align to month boundaries ✅ (smaller than chunk)
      maxBars: 365,
    },
    '1W': {
      size: 730 * 86400000,       // 2 years chunk
      align: 86400000 * 30,       // Align to month boundaries ✅
      maxBars: 104,
    },
    '1M': {
      size: 1825 * 86400000,      // 5 years chunk
      align: 86400000 * 365,      // Align to year boundaries ✅
      maxBars: 60,
    },
  };

  const config = CHUNK_CONFIGS[resolution as keyof typeof CHUNK_CONFIGS] || CHUNK_CONFIGS['1'];
  
  // Align start to boundary
  const alignedFrom = Math.floor(fromMs / config.align) * config.align;
  
  // Calculate aligned end, but cap at chunk size
  let alignedTo = Math.ceil(toMs / config.align) * config.align;
  
  // CRITICAL: Never exceed chunk size from aligned start
  alignedTo = Math.min(alignedTo, alignedFrom + config.size);
  
  // Also ensure we don't go past current time
  alignedTo = Math.min(alignedTo, Date.now());

  return { alignedFrom, alignedTo, chunkSize: config.size };
}