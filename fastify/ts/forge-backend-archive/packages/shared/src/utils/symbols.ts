export const pairSymbol = (baseTicker: string, quoteTicker: string) =>
  `${baseTicker}_${quoteTicker}`.toUpperCase();

export const parsePairSymbol = (s: string) => {
  const [base, quote] = String(s).toUpperCase().split('_');
  if (!base || !quote) throw new Error('symbol must be BASE_QUOTE (e.g., XEL_TNN)');
  return { base, quote };
};