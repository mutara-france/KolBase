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

/** Effectif du coût par participant d'un devis : après l'événement pointé, les présents ; avant, l'effectif prévu. */
export function costHeadcount(planned: number | null, present: number, eventPast: boolean): { n: number | null; per: "présent" | "participant" } {
  return eventPast && present > 0 ? { n: present, per: "présent" } : { n: planned, per: "participant" };
}

/** Intervention confirmée : candidature retenue et honoraires proposés acceptés par l'expert. */
export const speakerConfirmed = (app: { status: string }, link: { status: string } | null | undefined) => app.status === "retained" && !!link && isEngaged(link.status);
