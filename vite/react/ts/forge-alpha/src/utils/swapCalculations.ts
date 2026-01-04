export const v1 = {
calculateSwapOutput: (
  amountIn: number,
  reserveIn: number,
  reserveOut: number,
  slippagePercent: number = 0.5
): {
  amountOut: number
  amountOutMin: number
  priceImpact: number
  executionSlippage: number
} => {
  if (!amountIn || !reserveIn || !reserveOut || amountIn <= 0) {
    return {
      amountOut: 0,
      amountOutMin: 0,
      priceImpact: 0,
      executionSlippage: 0
    }
  }

  // Total fee: 0.25% LP + 0.03% dev + 0.02% special = 0.30%
  const FEE_MULTIPLIER = 0.997

  const getAmountOut = (amtIn: number, rIn: number, rOut: number) => {
    const amtInAfterFees = amtIn * FEE_MULTIPLIER
    const numerator = amtInAfterFees * rOut
    const denominator = rIn + amtInAfterFees
    return numerator / denominator
  }

  // Main trade output
  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut)
  const amountOutMin = amountOut * (1 - slippagePercent / 100)

  // Execution price (avg fill) and "spot" ratio (no fee)
  const spotPriceBefore = reserveOut / reserveIn
  const executionPrice = amountOut / amountIn

  // Post-trade reserves (fees remain in pool in the input reserve)
  const newReserveIn = reserveIn + amountIn
  const newReserveOut = reserveOut - amountOut

  // execution slippage vs pre-trade spot ratio
  const executionSlippage = (1 - executionPrice / spotPriceBefore) * 100

  // --- Price impact as "1 whole unit quote" delta (matches candle if candle is built that way) ---
  // If you're working in raw units, this is 1 "base unit". If you truly mean "1 whole token",
  // pass raw amounts into this function such that 1 token == 10^decimals.
  const UNIT_IN = 1

  const quoteBefore = getAmountOut(UNIT_IN, reserveIn, reserveOut) / UNIT_IN
  const quoteAfter = getAmountOut(UNIT_IN, newReserveIn, newReserveOut) / UNIT_IN

  const priceImpact = (1 - quoteAfter / quoteBefore) * 100

  return {
    amountOut,
    amountOutMin,
    executionSlippage: Math.abs(executionSlippage),
    priceImpact: Math.abs(priceImpact)
  }
},

  calculateSwapInput: (
    amountOut: number,
    reserveIn: number,
    reserveOut: number
  ): number => {
    if (!amountOut || !reserveIn || !reserveOut || amountOut <= 0) {
      return 0
    }

    const FEE_MULTIPLIER = 0.997

    // Rearranged constant product formula
    const numerator = reserveIn * amountOut
    const denominator = (reserveOut - amountOut) * FEE_MULTIPLIER

    // +1 to avoid rounding dust underestimation
    return Math.floor(numerator / denominator) + 1
  }
}
