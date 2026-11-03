/** Bilan d'un service : éléments affichés (organisateur, équipe KolBase, e-mail). Pur, testable. */
export type ReportStats = { clicks: number; registrations: number; recipients: number | null; since: number | null };
export type ReportPart = { key: string; n: number };

const pick = (n: number, one: string, many: string): ReportPart => ({ key: n > 1 ? many : one, n });

/** Chiffres clés dans l'ordre de lecture ; les clés sont des gabarits « {n} … » (singulier ou pluriel). */
export function reportParts(s: ReportStats, kind: string): ReportPart[] {
  const parts: ReportPart[] = [];
  if (kind === "newsletter" && s.recipients != null) parts.push(pick(s.recipients, "{n} destinataire", "{n} destinataires"));
  parts.push(pick(s.clicks, "{n} visiteur du lien", "{n} visiteurs du lien"));
  parts.push(pick(s.registrations, "{n} inscription par ce lien", "{n} inscriptions par ce lien"));
  return parts;
}

/** Version française en une ligne (équipe KolBase, e-mails). */
export const reportLine = (s: ReportStats, kind: string) => reportParts(s, kind).map((p) => p.key.replace("{n}", p.n.toLocaleString("fr-FR"))).join(" · ");

/** Taux de conversion visiteurs → inscriptions, en pourcentage entier (null sans visiteur). */
export const conversion = (s: ReportStats) => (s.clicks > 0 ? Math.round((s.registrations / s.clicks) * 100) : null);
