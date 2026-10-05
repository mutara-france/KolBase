import type { OrgRole, ProjectStatus } from "@/generated/prisma/client";

/** Types de collaboration et fourchettes de juste contrepartie (€ HT par unité), repris du prototype. */
export const COLLAB_TYPES = [
  { id: "advisory", label: "Comité consultatif", category: "Conseil et expertise", unit: "journée", fmv: [1200, 3000] },
  { id: "comite-sci", label: "Comité scientifique", category: "Conseil et expertise", unit: "séance", fmv: [700, 2200] },
  { id: "interview", label: "Consultation ponctuelle", category: "Conseil et expertise", unit: "heure", fmv: [150, 500] },
  { id: "test-produit", label: "Évaluation clinique de produit", category: "Conseil et expertise", unit: "protocole", fmv: [800, 4000] },
  { id: "symposium", label: "Symposium de congrès", category: "Interventions et enseignement", unit: "intervention", fmv: [1200, 3500] },
  { id: "pleniere", label: "Conférence plénière", category: "Interventions et enseignement", unit: "intervention", fmv: [1000, 3000] },
  { id: "table-ronde", label: "Table ronde", category: "Interventions et enseignement", unit: "intervention", fmv: [600, 1800] },
  { id: "webinaire", label: "Webinaire", category: "Interventions et enseignement", unit: "session", fmv: [500, 1800] },
  { id: "travaux-pratiques", label: "Travaux pratiques sur simulateur", category: "Interventions et enseignement", unit: "session", fmv: [900, 2600] },
  { id: "dpc", label: "Formation DPC", category: "Interventions et enseignement", unit: "journée", fmv: [900, 2400] },
  { id: "live-surgery", label: "Chirurgie en direct", category: "Interventions et enseignement", unit: "intervention", fmv: [1500, 4500] },
  { id: "redaction", label: "Rédaction scientifique", category: "Production de contenu", unit: "document", fmv: [600, 2800] },
  { id: "relecture", label: "Relecture scientifique", category: "Production de contenu", unit: "document", fmv: [250, 1000] },
  { id: "podcast", label: "Podcast ou capsule vidéo", category: "Production de contenu", unit: "épisode", fmv: [350, 1400] },
  { id: "cas-clinique", label: "Documentation de cas cliniques", category: "Production de contenu", unit: "cas", fmv: [300, 1500] },
  { id: "investigateur", label: "Investigateur d'étude clinique", category: "Recherche et essais", unit: "patient inclus", fmv: [300, 2000] },
  { id: "observationnelle", label: "Étude observationnelle", category: "Recherche et essais", unit: "patient inclus", fmv: [120, 700] },
  { id: "registre", label: "Participation à un registre", category: "Recherche et essais", unit: "cas documenté", fmv: [60, 350] },
  { id: "partenariat", label: "Partenariat de recherche", category: "Recherche et essais", unit: "projet", fmv: [8000, 90000] },
] as const;

export const collabType = (id: string) => COLLAB_TYPES.find((t) => t.id === id);

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  ATT_EXPERTS: "En attente des experts",
  ATT_IND: "En attente de l'organisation",
  ACCORD: "Accord de principe",
  EN_VALID: "En validation conformité",
  BLOQUE: "Bloqué par la conformité",
  VALIDE: "Validé par la conformité",
  ORDRE: "Autorisation de l'Ordre en cours",
  REFUS_ORDRE: "Autorisation refusée",
  SIGNATURE: "En signature",
  SIGNE: "Signé",
  TERMINE: "Terminé",
  DECLINE: "Décliné / abandonné",
};

export const STATUS_TONE: Record<ProjectStatus, "wait" | "ok" | "bad" | "done"> = {
  ATT_EXPERTS: "wait", ATT_IND: "wait", ACCORD: "ok", EN_VALID: "wait", BLOQUE: "bad", VALIDE: "ok",
  ORDRE: "wait", REFUS_ORDRE: "bad", SIGNATURE: "wait", SIGNE: "ok", TERMINE: "done", DECLINE: "done",
};

/** Étapes affichées dans la frise du dossier. */
export const PIPELINE: ProjectStatus[] = ["ATT_EXPERTS", "ACCORD", "EN_VALID", "VALIDE", "SIGNATURE", "SIGNE", "TERMINE"];

/**
 * Rôles (repris du prototype) :
 * - sourcing (annuaire, sollicitations, opportunités) : Éducation, Cumul, Admin ;
 * - pilotage des dossiers : sourcing + Événements ;
 * - lecture des dossiers : pilotage + Conformité ;
 * - la Relecture ne voit que les supports à relire ; le Prestataire mandaté, que les événements confiés.
 */
export const SOURCING_ROLES: OrgRole[] = ["ADMIN", "EDUCATION", "CUMUL"];
export const PROJECT_ROLES: OrgRole[] = ["ADMIN", "EDUCATION", "EVENEMENTS", "CUMUL"];
export const PROJECT_VIEW_ROLES: OrgRole[] = [...PROJECT_ROLES, "CONFORMITE"];

/** Transitions possibles : qui peut faire quoi, depuis quel statut. */
export const TRANSITIONS = {
  accept_proposal: { from: ["ATT_IND"], to: "ACCORD", roles: "project", label: "Accepter la proposition" },
  decline_proposal: { from: ["ATT_IND"], to: "DECLINE", roles: "project", label: "Décliner la proposition" },
  submit: { from: ["ACCORD"], to: "EN_VALID", roles: "project", label: "Soumettre à la conformité" },
  validate: { from: ["EN_VALID"], to: "VALIDE", roles: "compliance", label: "Valider" },
  block: { from: ["EN_VALID"], to: "BLOQUE", roles: "compliance", label: "Bloquer" },
  revise: { from: ["BLOQUE"], to: "ACCORD", roles: "project", label: "Reprendre le dossier" },
  ordre: { from: ["VALIDE"], to: "ORDRE", roles: "project", label: "Demander l'autorisation à l'Ordre" },
  declaration: { from: ["VALIDE"], to: "SIGNATURE", roles: "project", label: "Déclaration simple → signature" },
  ordre_ok: { from: ["ORDRE"], to: "SIGNATURE", roles: "project", label: "Autorisation obtenue" },
  ordre_ko: { from: ["ORDRE"], to: "REFUS_ORDRE", roles: "project", label: "Autorisation refusée" },
  signed: { from: ["SIGNATURE"], to: "SIGNE", roles: "project", label: "Convention signée" },
  done: { from: ["SIGNE"], to: "TERMINE", roles: "project", label: "Prestation réalisée" },
  abandon: { from: ["ATT_EXPERTS", "ACCORD", "BLOQUE", "VALIDE", "REFUS_ORDRE"], to: "DECLINE", roles: "project", label: "Abandonner le dossier" },
} as const satisfies Record<string, { from: ProjectStatus[]; to: ProjectStatus; roles: "project" | "compliance"; label: string }>;

export type TransitionKey = keyof typeof TRANSITIONS;

/** Contrôle de juste contrepartie : honoraire unitaire comparé à la fourchette du type. */
export function fmvCheck(typeId: string, feeCents: number | null, units: number | null) {
  const t = collabType(typeId);
  if (!t || feeCents == null || !units) return null;
  const perUnit = feeCents / 100 / units;
  const [min, max] = t.fmv;
  return { perUnit, min, max, unit: t.unit, verdict: perUnit < min ? "below" : perUnit > max ? "above" : "ok" } as const;
}

export const MATERIAL_KINDS = { diaporama: "Diaporama", article: "Article / texte", video: "Vidéo", programme: "Programme", autre: "Autre" } as const;
export const MATERIAL_STATUS = { submitted: "En relecture", approved: "Approuvé", changes: "Modifications demandées" } as const;
export const REVIEW_ROLES: OrgRole[] = ["ADMIN", "RELECTURE", "CONFORMITE"];

/** Seuil d'alerte de cumul annuel de rémunérations d'un même expert par une même organisation (€ HT). */
export const CUMUL_ALERT_EUR = 10000;
