export const formatCompactNumber = (input: unknown): string => {
  const value = Number(input);

  if (isNaN(value)) return '--';

  const format = (n: number, suffix: string) => {
    return n.toFixed(2) + suffix;
  };

  if (value >= 1e15) return format(value / 1e15, 'Q');
  if (value >= 1e12) return format(value / 1e12, 'T');
  if (value >= 1e9) return format(value / 1e9, 'B');
  if (value >= 1e6) return format(value / 1e6, 'M');
  if (value >= 1e3) return format(value / 1e3, 'K');

  return value.toFixed(2).toString();
};