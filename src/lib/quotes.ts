/** Devis détaillés : lignes (chacune avec son taux de TVA), coût par participant et repère des seuils d'hospitalité. */
import type { ComplianceSettings } from "@/lib/compliance";

/** Ligne de devis : quantité, prix unitaire HT et taux de TVA de la ligne (repas 10 %, alcool 20 %…). */
export type QuoteLine = { label: string; qty: number; unitCents: number; vatBp?: number };

export const VAT_OPTIONS = [
  { bp: 2000, label: "20 %" },
  { bp: 1000, label: "10 % (restauration, transport, hébergement)" },
  { bp: 550, label: "5,5 %" },
  { bp: 0, label: "0 % (exonéré ou non assujetti)" },
] as const;
export const isVatBp = (n: number) => VAT_OPTIONS.some((v) => v.bp === n);
/** Taux proposé par défaut : 10 % pour la restauration, l'hébergement et le transport de personnes, 20 % sinon. */
export const defaultVatBp = (category: string) => (["restauration", "hebergement", "transport"].includes(category) ? 1000 : 2000);
export const vatLabel = (bp: number) => `${(bp / 100).toLocaleString("fr-FR")} %`;

export const MAX_LINES = 40;

/** Lignes enregistrées (JSON) relues sans confiance : seules les lignes bien formées sont gardées (taux invalide ignoré). */
export function readLines(raw: unknown): QuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is QuoteLine => !!l && typeof l === "object" && typeof (l as QuoteLine).label === "string" && Number.isFinite((l as QuoteLine).qty) && Number.isInteger((l as QuoteLine).unitCents))
    .slice(0, MAX_LINES)
    .map((l) => ({ label: l.label, qty: l.qty, unitCents: l.unitCents, ...(typeof l.vatBp === "number" && isVatBp(l.vatBp) ? { vatBp: l.vatBp } : {}) }));
}

export const lineTotal = (l: QuoteLine) => Math.round(l.qty * l.unitCents);
export const linesTotal = (lines: QuoteLine[]) => lines.reduce((s, l) => s + lineTotal(l), 0);
export const withVat = (htCents: number, vatBp: number) => Math.round((htCents * (10000 + vatBp)) / 10000);
/** Taux d'une ligne : le sien, sinon celui du devis (lignes antérieures au taux par ligne). */
export const lineVat = (l: QuoteLine, quoteVatBp: number) => (typeof l.vatBp === "number" && isVatBp(l.vatBp) ? l.vatBp : quoteVatBp);
/** Total TTC de lignes : somme des lignes, chacune à son taux. */
export const linesTtc = (lines: QuoteLine[], quoteVatBp: number) => lines.reduce((s, l) => s + withVat(lineTotal(l), lineVat(l, quoteVatBp)), 0);
/**
 * Taux enregistré sur le devis : unique si toutes les lignes ont le même ; sinon celui du plus gros montant HT. Ne sert
 * qu'aux lignes sans taux et aux devis au montant global.
 */
export function mainVat(lines: QuoteLine[], fallback: number) {
  const by = new Map<number, number>();
  for (const l of lines) by.set(lineVat(l, fallback), (by.get(lineVat(l, fallback)) ?? 0) + lineTotal(l));
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}
/** Total TTC d'un devis : enregistré (somme des lignes à leur taux), sinon montant HT au taux du devis. */
export const quoteTtc = (q: { amountCents: number; vatBp: number; ttcCents?: number | null }) => q.ttcCents ?? withVat(q.amountCents, q.vatBp);
/** Taux affichés d'un devis : « 10 % », ou « 10 % et 20 % » quand les lignes ont des taux différents. */
export function quoteVatLabel(q: { vatBp: number; lines?: unknown }) {
  const lines = readLines(q.lines);
  const rates = [...new Set(lines.length ? lines.map((l) => lineVat(l, q.vatBp)) : [q.vatBp])].sort((a, b) => a - b);
  return rates.map(vatLabel).join(" et ");
}

/** Base du coût par personne d'un devis : le couvert commandé (restauration), sinon le participant prévu. */
export const perHeadLabel = (category: string) => (category === "restauration" ? "par couvert commandé" : "par participant prévu");

/**
 * Coût TTC par participant et repère réglementaire : pour la restauration, il est comparé au seuil d'un repas,
 * pour l'hébergement à celui d'une nuitée (seuils d'autorisation de l'arrêté du 7 août 2020, paramètres de l'organisation).
 * C'est un ordre de grandeur pour décider, pas un calcul d'avantage par bénéficiaire.
 */
export function perParticipant(category: string, ttcCents: number, headcount: number | null, s: ComplianceSettings) {
  if (!headcount || headcount <= 0) return null;
  const each = ttcCents / headcount / 100;
  // `of` : « d'un repas », « d'une nuitée » (accord du déterminant).
  const limit = category === "restauration" ? { max: s.hospitalityMealMax, what: "repas", of: "d'un repas" } : category === "hebergement" ? { max: s.hospitalityNightMax, what: "nuitée", of: "d'une nuitée" } : null;
  return { each, limit, over: !!limit && each > limit.max };
}
