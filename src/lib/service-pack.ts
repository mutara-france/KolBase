/** Durée d'une mise à la une sur l'accueil (jours, à partir de sa réalisation). */
export const FEATURE_DAYS = 7;

/** Mise à la une réalisée : en cours jusqu'à la fin de sa durée, sinon null (terminée, ou autre service). */
export function featuredUntil(o: { status: string; doneAt: Date | null; offer: { kind: string } }, now = new Date()) {
  if (o.offer.kind !== "une" || o.status !== "realisee" || !o.doneAt) return null;
  const until = new Date(o.doneAt.getTime() + FEATURE_DAYS * 86400e3);
  return until > now ? until : null;
}

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

/** Commande d'un service, réduite à ce qui sert au regroupement par pack. */
type Groupable = { packLabel: string | null; orderedById: string; createdAt: Date };
/** Deux services d'un même pack sont commandés ensemble (une transaction) : quelques secondes d'écart au plus. */
const SAME_ORDER_MS = 5000;
const samePack = (a: Groupable, b: Groupable) =>
  !!a.packLabel && a.packLabel === b.packLabel && a.orderedById === b.orderedById && Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) <= SAME_ORDER_MS;

/** Commandes regroupées par pack (même pack, même auteur, passées ensemble) ; les autres restent seules, dans l'ordre. */
export function groupOrders<T extends Groupable>(orders: T[]): { pack: string | null; orders: T[] }[] {
  const groups: { pack: string | null; orders: T[] }[] = [];
  for (const o of orders) {
    const g = o.packLabel ? groups.find((x) => samePack(x.orders[0], o)) : undefined;
    if (g) g.orders.push(o);
    else groups.push({ pack: o.packLabel, orders: [o] });
  }
  return groups;
}

/** Mise à la une réalisée et encore affichée sur l'accueil : réalisée pour l'avancement du pack, qui reste « en cours ». */
const FEATURED = "a_la_une";
/** Statut d'une commande pour l'avancement d'un pack : FEATURED pour une mise à la une en cours. */
export const packItemStatus = (o: { status: string; doneAt: Date | null; offer: { kind: string } }, now = new Date()) => (featuredUntil(o, now) ? FEATURED : o.status);

/**
 * Statut d'ensemble d'un pack : celui de tous ses services s'il est commun, sinon « en cours » avec le nombre de
 * services réalisés (les services annulés ou refusés ne comptent pas). Une mise à la une en cours compte comme
 * réalisée ; le pack reste « en cours » jusqu'à sa fin.
 */
export function packStatus(statuses: string[]): { status: string; done: number; total: number } {
  const live = statuses.filter((s) => s !== "annulee" && s !== "refusee");
  const done = live.filter((s) => s === "realisee" || s === FEATURED).length;
  if (new Set(statuses).size === 1 && statuses[0] !== FEATURED) return { status: statuses[0], done, total: live.length };
  return { status: live.length === 0 ? "annulee" : done === live.length && !live.includes(FEATURED) ? "realisee" : "en_cours", done, total: live.length };
}
