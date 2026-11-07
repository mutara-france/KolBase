/**
 * Validation des événements par la conformité avant publication (organisations qui l'exigent : par défaut les
 * industriels, soumis au dispositif anti-cadeaux) : lieu, date, programme, hospitalités. Une fois validé, un changement
 * de date, de lieu, de format ou d'hospitalités renvoie l'événement à la conformité.
 */

export type ReviewStatus = "submitted" | "approved" | "changes";
export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  submitted: "En attente de la conformité",
  approved: "Validé par la conformité",
  changes: "Modifications demandées",
};
export const REVIEW_TONE: Record<ReviewStatus, string> = { submitted: "wait", approved: "ok", changes: "bad" };

/** L'événement doit-il être validé par la conformité avant sa publication ? (jamais une réunion interne) */
export const needsReview = (org: { eventReview: boolean }, ev: { internal: boolean }) => org.eventReview && !ev.internal;

/** Publication possible au regard de la validation (les autres conditions, dossier et abonnement, sont à part). */
export const reviewAllowsPublish = (org: { eventReview: boolean }, ev: { internal: boolean; reviewStatus: string | null }) =>
  !needsReview(org, ev) || ev.reviewStatus === "approved";

export const EVENT_NOT_APPROVED = "La conformité valide l'événement (lieu, date, programme, hospitalités) avant sa publication : soumettez-le-lui depuis la fiche de l'événement.";

/** Changements qui renvoient un événement validé à la conformité (« lieu », « date », « format », « hospitalités »). */
export const REVIEWED_CHANGES = ["date", "lieu", "format", "hospitalités"] as const;
