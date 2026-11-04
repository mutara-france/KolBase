/**
 * Une définition par indicateur (module pur, testé) : les mêmes règles sur toutes les pages, côté praticien et
 * côté organisation. Collaboration signée et expert engagé : voir src/lib/projects.ts (isSigned, isEngaged).
 */
import { isEngaged, isSigned } from "@/lib/projects";

/**
 * Honoraires d'un praticien : payés ; à percevoir (convention signée, pas encore payée) ; en préparation (le reste :
 * accord de principe, validation, signature en cours, dossier bloqué…), qui n'est pas encore dû.
 */
export function feeTotals(fees: { status: string; feeCents: number; paidAt: Date | null; paidCents: number | null }[]) {
  let paid = 0, due = 0, preparing = 0;
  for (const f of fees) {
    if (f.paidAt) paid += f.paidCents ?? f.feeCents;
    else if (isSigned(f.status)) due += f.feeCents;
    else if (isEngaged(f.status)) preparing += f.feeCents;
  }
  return { paid, due, preparing };
}

/**
 * Absent : inscrit non pointé à un événement passé dont le pointage a été fait (au moins un présent). Ses
 * hospitalités n'ont pas été consommées : ni à déclarer, ni dans ses liens d'intérêts (même règle que le
 * fichier Transparence Santé).
 */
export const isAbsent = (r: { checkedInAt: Date | null }, eventPointed: boolean) => eventPointed && !r.checkedInAt;
/** Présence connue : événement terminé et pointé (au moins un présent). Avant la fin ou sans pointage : les inscrits comptent. */
export const presenceKnown = (ended: boolean, presentCount: number) => ended && presentCount > 0;

/**
 * Hospitalités d'un événement, absents exclus une fois la présence connue : valeur (TTC), bénéficiaires, et effectif
 * (présents après l'événement pointé, inscrits sinon). Même règle pour l'en-tête de l'événement, son bilan et les
 * Statistiques.
 */
export function eventHospitality(regs: { checkedInAt: Date | null; benefits: { valueCents: number }[] }[], ended: boolean) {
  const known = presenceKnown(ended, regs.filter((r) => r.checkedInAt).length);
  const kept = regs.filter((r) => !isAbsent(r, known));
  return {
    known,
    cents: kept.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0),
    beneficiaries: kept.filter((r) => r.benefits.length > 0).length,
    headcount: kept.length,
  };
}
/** Hospitalité à déclarer : pas encore déclarée, et pas celle d'un absent. */
export const toDeclare = (r: { declared: boolean; checkedInAt: Date | null }, eventPointed: boolean) => !r.declared && !isAbsent(r, eventPointed);

/**
 * Experts d'un dossier, même définition dans l'en-tête et le budget : engagés (proposition acceptée) et
 * proposés (réponse attendue, tant que le recrutement est ouvert), avec leurs honoraires.
 */
export function expertSplit<E extends { status: string; feeCents: number | null }>(experts: E[], recruiting: boolean) {
  const engaged = experts.filter((e) => isEngaged(e.status));
  const proposed = recruiting ? experts.filter((e) => e.status === "ATT_EXPERTS") : [];
  const sum = (xs: E[]) => xs.reduce((s, e) => s + (e.feeCents ?? 0), 0);
  return { engaged, proposed, engagedCents: sum(engaged), proposedCents: sum(proposed) };
}

/**
 * Coût d'un devis par personne (en euros TTC). La valeur d'hospitalité et le repère des seuils portent sur le prix par
 * couvert commandé (effectif prévu) ; une fois la présence connue (événement terminé et pointé), le coût par présent est
 * donné à titre d'information, sans alerte réglementaire : l'avantage reçu reste le couvert commandé.
 */
export function costPerHead(ttcCents: number, planned: number | null, present: number, ended: boolean) {
  return {
    perCover: planned && planned > 0 ? ttcCents / planned / 100 : null,
    perPresent: presenceKnown(ended, present) ? ttcCents / present / 100 : null,
  };
}

/** Intervention confirmée : candidature retenue et honoraires proposés acceptés par l'expert. */
export const speakerConfirmed = (app: { status: string }, link: { status: string } | null | undefined) => app.status === "retained" && !!link && isEngaged(link.status);
