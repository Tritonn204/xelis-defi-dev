import Decimal from 'decimal.js';

export function adjustByDecimals(raw: bigint, decimals: number): Decimal {
  return new Decimal(raw.toString()).div(new Decimal(10).pow(decimals));
}