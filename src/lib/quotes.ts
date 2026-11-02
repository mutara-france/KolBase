/** Devis détaillés : lignes, TVA, coût par participant et repère des seuils d'hospitalité. */
import type { ComplianceSettings } from "@/lib/compliance";

export type QuoteLine = { label: string; qty: number; unitCents: number };

export const VAT_OPTIONS = [
  { bp: 2000, label: "20 %" },
  { bp: 1000, label: "10 % (restauration, transport, hébergement)" },
  { bp: 550, label: "5,5 %" },
  { bp: 0, label: "0 % (exonéré ou non assujetti)" },
] as const;
export const isVatBp = (n: number) => VAT_OPTIONS.some((v) => v.bp === n);
export const vatLabel = (bp: number) => `${(bp / 100).toLocaleString("fr-FR")} %`;

export const MAX_LINES = 40;

/** Lignes enregistrées (JSON) relues sans confiance : seules les lignes bien formées sont gardées. */
export function readLines(raw: unknown): QuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is QuoteLine => !!l && typeof l === "object" && typeof (l as QuoteLine).label === "string" && Number.isFinite((l as QuoteLine).qty) && Number.isInteger((l as QuoteLine).unitCents))
    .slice(0, MAX_LINES);
}

export const lineTotal = (l: QuoteLine) => Math.round(l.qty * l.unitCents);
export const linesTotal = (lines: QuoteLine[]) => lines.reduce((s, l) => s + lineTotal(l), 0);
export const withVat = (htCents: number, vatBp: number) => Math.round((htCents * (10000 + vatBp)) / 10000);

/**
 * Coût TTC par participant et repère réglementaire : pour la restauration, il est comparé au seuil d'un repas,
 * pour l'hébergement à celui d'une nuitée (seuils d'autorisation de l'arrêté du 7 août 2020, paramètres de l'organisation).
 * C'est un ordre de grandeur pour décider, pas un calcul d'avantage par bénéficiaire.
 */
export function perParticipant(category: string, ttcCents: number, headcount: number | null, s: ComplianceSettings) {
  if (!headcount || headcount <= 0) return null;
  const each = ttcCents / headcount / 100;
  const limit = category === "restauration" ? { max: s.hospitalityMealMax, what: "repas" } : category === "hebergement" ? { max: s.hospitalityNightMax, what: "nuitée" } : null;
  return { each, limit, over: !!limit && each > limit.max };
}
