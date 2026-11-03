/**
 * Limitation des alertes d'erreur (module pur, testé) : une alerte par erreur identique toutes les 30 minutes,
 * et au plus 10 alertes par heure en tout, pour ne pas noyer les administrateurs lors d'une panne.
 */
export const SAME_ERROR_MS = 30 * 60 * 1000;
export const MAX_PER_HOUR = 10;

export function createThrottle() {
  const last = new Map<string, number>();
  const sent: number[] = [];
  return (key: string, now = Date.now()) => {
    while (sent.length && sent[0] <= now - 3600_000) sent.shift();
    if ((last.get(key) ?? -Infinity) > now - SAME_ERROR_MS || sent.length >= MAX_PER_HOUR) return false;
    last.set(key, now);
    sent.push(now);
    return true;
  };
}
