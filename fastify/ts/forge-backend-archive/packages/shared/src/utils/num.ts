import Decimal from 'decimal.js';

export function adjustByDecimals(raw: bigint, decimals: number): Decimal {
  return new Decimal(raw.toString()).div(new Decimal(10).pow(decimals));
}

export function toHuman(u64: bigint, decimals: number) {
  return new Decimal(u64.toString()).div(new Decimal(10).pow(decimals));
}