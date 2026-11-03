/** Pack de services : répartition du prix du pack entre les services compris, au prorata de leur prix (en centimes). */
export function allocate(prices: number[], total: number): number[] {
  const sum = prices.reduce((a, b) => a + b, 0);
  if (prices.length === 0) return [];
  if (sum <= 0) return prices.map((_, i) => (i === prices.length - 1 ? total : 0));
  const parts = prices.map((p) => Math.round((p * total) / sum));
  // L'arrondi est reporté sur le dernier service : la somme est exactement le prix du pack.
  parts[parts.length - 1] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

/** Économie du pack par rapport aux services commandés séparément (centimes, jamais négative). */
export const packSaving = (prices: number[], total: number) => Math.max(prices.reduce((a, b) => a + b, 0) - total, 0);
