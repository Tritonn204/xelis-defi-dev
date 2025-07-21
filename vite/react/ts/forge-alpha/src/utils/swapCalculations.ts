export const v1 = {
  calculateSwapOutput: (
    amountIn: number,
    reserveIn: number,
    reserveOut: number,
    slippagePercent: number = 0.5
  ): { amountOut: number; amountOutMin: number; priceImpact: number } => {
    if (!amountIn || !reserveIn || !reserveOut || amountIn <= 0) {
      return { amountOut: 0, amountOutMin: 0, priceImpact: 0 };
    }

    // Dev fee: 0.03% (9997/10000)
    const amountInWithDevFee = amountIn * 9997 / 10000;
    
    // LP fee: 0.22% (9978/10000)
    const amountInWithLPFee = amountInWithDevFee * 9978;
    
    // Calculate output amount
    const numerator = amountInWithLPFee * reserveOut;
    const denominator = reserveIn * 10000 + amountInWithLPFee;
    const amountOut = numerator / denominator;
    
    // Calculate minimum output with slippage
    const amountOutMin = amountOut * (1 - slippagePercent / 100);
    
    // Calculate price impact
    const priceBeforeSwap = reserveOut / reserveIn;
    const priceAfterSwap = (reserveOut - amountOut) / (reserveIn + amountIn);
    const priceImpact = ((priceBeforeSwap - priceAfterSwap) / priceBeforeSwap) * 100;
    
    return {
      amountOut,
      amountOutMin,
      priceImpact: Math.abs(priceImpact)
    };
  },

  calculateSwapInput: (
    amountOut: number,
    reserveIn: number,
    reserveOut: number
  ): number => {
    if (!amountOut || !reserveIn || !reserveOut || amountOut <= 0) {
      return 0;
    }
    
    // Reverse calculation from output to input
    const numerator = reserveIn * amountOut * 10000;
    const denominator = (reserveOut - amountOut) * 9978 * 9997 / 10000;
    const amountIn = (numerator / denominator) + 1;
    
    return amountIn;
  }
}