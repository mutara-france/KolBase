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

/** Collaborations qui réunissent des participants (réunion, intervention, formation) : elles ont une logistique. */
const MEETING_TYPES = new Set(["advisory", "comite-sci", "symposium", "pleniere", "table-ronde", "webinaire", "travaux-pratiques", "dpc", "live-surgery"]);
export const needsMeeting = (typeId: string) => MEETING_TYPES.has(typeId);

/** Qui doit agir, selon l'étape du dossier (listes et tableaux de bord). */
export const NEXT_ACTOR: Record<ProjectStatus, { who: string; what: string } | null> = {
  ATT_EXPERTS: { who: "Experts", what: "réponse aux sollicitations" },
  ATT_IND: { who: "Projets", what: "examiner la proposition de l'expert" },
  ACCORD: { who: "Projets", what: "soumettre à la conformité" },
  EN_VALID: { who: "Conformité", what: "valider ou bloquer" },
  BLOQUE: { who: "Projets", what: "corriger et reprendre" },
  VALIDE: { who: "Projets", what: "démarche EPS puis signature" },
  ORDRE: { who: "Ordre", what: "réponse à la demande d'autorisation" },
  REFUS_ORDRE: { who: "Projets", what: "revoir ou abandonner" },
  SIGNATURE: { who: "Signataires", what: "signature des conventions" },
  SIGNE: { who: "Projets", what: "clôturer après la prestation" },
  TERMINE: null,
  DECLINE: null,
};

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

/** Libellés vus par l'expert sollicité (de son point de vue) : sa réponse est attendue, pas « les experts ». */
export const EXPERT_STATUS_LABEL: Partial<Record<ProjectStatus, string>> = { ATT_EXPERTS: "Votre réponse est attendue" };
export const statusLabel = (status: ProjectStatus, viewer: "organisation" | "expert" = "organisation") =>
  (viewer === "expert" ? EXPERT_STATUS_LABEL[status] : undefined) ?? STATUS_LABEL[status];
/** Frise vue par l'expert : l'étape de la sollicitation, toujours franchie quand la frise s'affiche (il est engagé). */
export const pipelineLabel = (status: ProjectStatus, viewer: "organisation" | "expert" = "organisation") =>
  viewer === "expert" && status === "ATT_EXPERTS" ? "Sollicitation reçue" : statusLabel(status, viewer);

/**
 * État d'une sollicitation vu par l'expert :
 * - attente : sa réponse est attendue (recrutement ouvert) ;
 * - contre : il a proposé d'autres honoraires, l'organisation doit répondre (la sollicitation reste ouverte) ;
 * - clos : restée sans réponse, le dossier a été soumis à la conformité (recrutement clos) ;
 * - abandonne : dossier abandonné par l'organisation (motif) ; refuse : sa proposition spontanée déclinée ;
 * - decline : il a décliné ; engage : il a accepté, le dossier suit son cours.
 */
export type ExpertLinkState = "attente" | "contre" | "clos" | "abandonne" | "refuse" | "decline" | "engage";
export function expertLinkState(
  link: { status: ProjectStatus | string; desiredFeeCents: number | null; respondedAt: Date | null },
  project: { status: ProjectStatus | string; abandonNote: string | null; origin: string | null },
): ExpertLinkState {
  const proposal = project.origin === PROPOSAL_ORIGIN;
  if (project.status === "DECLINE" && project.abandonNote) return "abandonne";
  if (link.status === "DECLINE" && link.respondedAt && !proposal) return "decline";
  if (project.status === "DECLINE") return proposal ? "refuse" : "abandonne";
  if (link.status === "DECLINE") return "decline";
  if (link.status === "ATT_EXPERTS") return !recruitmentOpen(project.status) ? "clos" : link.desiredFeeCents != null ? "contre" : "attente";
  return "engage";
}
export const EXPERT_LINK_LABEL: Record<Exclude<ExpertLinkState, "engage">, string> = {
  attente: "Votre réponse est attendue",
  contre: "Contre-proposition envoyée",
  clos: "Recrutement clos",
  abandonne: "Abandonné par l'organisation",
  refuse: "Proposition déclinée",
  decline: "Décliné",
};
/** Sollicitation qui attend la réponse de l'expert (compteurs du menu, de l'accueil et de la liste). */
export const awaitingExpert = (link: { status: ProjectStatus | string; desiredFeeCents: number | null }, projectStatus: ProjectStatus | string) =>
  link.status === "ATT_EXPERTS" && link.desiredFeeCents == null && recruitmentOpen(projectStatus);
/** Mention portée sur la réponse d'un expert retiré des dossiers à la suppression de son compte. */
export const ACCOUNT_DELETED = "Compte supprimé";
/** Origine d'un dossier ouvert par la proposition spontanée d'un expert. */
export const PROPOSAL_ORIGIN = "Proposition de l'expert";

export const STATUS_TONE: Record<ProjectStatus, "wait" | "ok" | "bad" | "done"> = {
  ATT_EXPERTS: "wait", ATT_IND: "wait", ACCORD: "ok", EN_VALID: "wait", BLOQUE: "bad", VALIDE: "ok",
  ORDRE: "wait", REFUS_ORDRE: "bad", SIGNATURE: "wait", SIGNE: "ok", TERMINE: "done", DECLINE: "done",
};

/**
 * Une définition par indicateur :
 * - collaboration (comptée, citée, déclarée) : convention signée, puis prestation terminée ;
 * - expert engagé : il a accepté la proposition (accord de principe et au-delà), hors abandon ;
 * - expert proposé : sollicité, sa réponse est attendue.
 */
export const SIGNED_STATUSES: ProjectStatus[] = ["SIGNE", "TERMINE"];
export const isSigned = (status: ProjectStatus | string) => (SIGNED_STATUSES as string[]).includes(status);
export const isEngaged = (status: ProjectStatus | string) => status !== "ATT_EXPERTS" && status !== "DECLINE";

/**
 * Liens d'intérêts d'un expert suggéré, sans jamais nommer d'autre organisation : les dossiers des autres
 * organisations sont confidentiels et les liens déclarés par l'expert servent à sa propre diapositive.
 * `otherCompanies` : entreprises distinctes avec un dossier signé récent ; `declared` : liens déclarés en cours.
 */
export function interestWarning(otherCompanies: number, declared: number) {
  const parts = [
    otherCompanies === 1 ? "collaboration récente avec une autre entreprise" : otherCompanies > 1 ? `collaborations récentes avec ${otherCompanies} autres entreprises` : null,
    declared ? `${declared} lien${declared > 1 ? "s" : ""} déclaré${declared > 1 ? "s" : ""} par l'expert` : null,
  ].filter(Boolean);
  return parts.length ? `Liens d'intérêts : ${parts.join(" ; ")}` : null;
}

/** Étapes affichées dans la frise du dossier. */
export const PIPELINE: ProjectStatus[] = ["ATT_EXPERTS", "ACCORD", "EN_VALID", "VALIDE", "SIGNATURE", "SIGNE", "TERMINE"];

/**
 * Rôles :
 * - Projets (et Administrateur) : annuaire, sollicitations, opportunités, dossiers, événements, prestataires ;
 * - Conformité (et Administrateur) : lecture des dossiers, validation, relecture des supports, déclarations ;
 * - Agence mandatée : seulement les événements confiés à son agence.
 * Les décisions sensibles suivent en plus le contrôle à quatre yeux (lib/four-eyes).
 */
export const SOURCING_ROLES: OrgRole[] = ["ADMIN", "PROJETS"];
export const PROJECT_ROLES: OrgRole[] = ["ADMIN", "PROJETS"];
export const PROJECT_VIEW_ROLES: OrgRole[] = [...PROJECT_ROLES, "CONFORMITE"];

/** Transitions possibles : qui peut faire quoi, depuis quel statut. */
/**
 * Phase de recrutement : un expert sollicité peut encore accepter. Une fois le dossier soumis à la conformité,
 * le recrutement est clos ; un expert resté sans réponse doit être sollicité de nouveau (nouveau dossier).
 */
export const RECRUITING_STATUSES: ProjectStatus[] = ["ATT_EXPERTS", "ACCORD"];
export const recruitmentOpen = (status: ProjectStatus | string) => (RECRUITING_STATUSES as string[]).includes(status);
/**
 * Dossier modifiable (objet, conditions de chaque expert, ajout d'un expert) : pendant le recrutement.
 * Bloqué par la conformité, validé, en autorisation ou en signature : « Reprendre le dossier » ou « Retour en
 * accord de principe » le remet d'abord en accord de principe (il repassera par la conformité).
 */
export const projectEditable = recruitmentOpen;
/** Conditions d'un expert modifiées (unités, honoraires) : la proposition lui est renvoyée. */
export const termsChanged = (before: { feeCents: number | null; days: number | null }, after: { feeCents: number | null; days: number | null }) =>
  before.feeCents !== after.feeCents || (before.days ?? null) !== (after.days ?? null);

export const TRANSITIONS = {
  accept_proposal: { from: ["ATT_IND"], to: "ACCORD", roles: "project", label: "Accepter la proposition" },
  decline_proposal: { from: ["ATT_IND"], to: "DECLINE", roles: "project", label: "Décliner la proposition" },
  submit: { from: ["ACCORD"], to: "EN_VALID", roles: "project", label: "Soumettre à la conformité" },
  validate: { from: ["EN_VALID"], to: "VALIDE", roles: "compliance", label: "Valider" },
  block: { from: ["EN_VALID"], to: "BLOQUE", roles: "compliance", label: "Bloquer" },
  revise: { from: ["BLOQUE"], to: "ACCORD", roles: "project", label: "Reprendre le dossier" },
  // Revenir en arrière pour modifier les conditions : le dossier repassera par la conformité.
  back_to_accord: { from: ["VALIDE", "ORDRE", "REFUS_ORDRE", "SIGNATURE"], to: "ACCORD", roles: "project", label: "Retour en accord de principe" },
  ordre: { from: ["VALIDE"], to: "ORDRE", roles: "project", label: "Demander l'autorisation à l'Ordre" },
  declaration: { from: ["VALIDE"], to: "SIGNATURE", roles: "project", label: "Déclaration simple → signature" },
  // Experts exerçant tous hors de France : pas de démarche EPS, les règles du pays d'exercice s'appliquent.
  hors_france: { from: ["VALIDE"], to: "SIGNATURE", roles: "project", label: "Hors France : obligations du pays vérifiées → signature" },
  ordre_ok: { from: ["ORDRE"], to: "SIGNATURE", roles: "project", label: "Autorisation obtenue" },
  ordre_ko: { from: ["ORDRE"], to: "REFUS_ORDRE", roles: "project", label: "Autorisation refusée" },
  signed: { from: ["SIGNATURE"], to: "SIGNE", roles: "project", label: "Convention signée" },
  done: { from: ["SIGNE"], to: "TERMINE", roles: "project", label: "Prestation réalisée" },
  abandon: { from: ["ATT_EXPERTS", "ACCORD", "BLOQUE", "VALIDE", "ORDRE", "REFUS_ORDRE", "SIGNATURE"], to: "DECLINE", roles: "project", label: "Abandonner le dossier" },
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
export const REVIEW_ROLES: OrgRole[] = ["ADMIN", "CONFORMITE"];

/** E-mails à l'expert lors des étapes du dossier qui le concernent (voir notifyExpertNotice). */
export type ExpertNotice = "abandon" | "retour_accord" | "signature" | "signe" | "recrutement_clos";
/**
 * Qui prévenir, et de quoi, quand le dossier change d'étape : experts engagés (accord donné), sollicités restés sans
 * réponse (dont une contre-proposition ou une offre renvoyée), ou tous. Passage en signature : seulement quand la
 * convention se dépose à la main (la signature électronique écrit déjà à l'expert).
 */
export function expertNotices(key: TransitionKey, eSignature: boolean): { notice: ExpertNotice; who: "engages" | "sollicites" | "tous" }[] {
  switch (key) {
    case "abandon": return [{ notice: "abandon", who: "tous" }];
    case "back_to_accord": return [{ notice: "retour_accord", who: "engages" }];
    case "declaration": case "hors_france": case "ordre_ok": return eSignature ? [] : [{ notice: "signature", who: "engages" }];
    case "signed": return [{ notice: "signe", who: "engages" }];
    case "submit": return [{ notice: "recrutement_clos", who: "sollicites" }];
    default: return [];
  }
}

/** Appel à candidatures complet : toutes ses places pourvues (candidatures retenues). */
export const callFull = (c: { slots: number | null; _count: { applications: number } }) => c.slots != null && c._count.applications >= c.slots;
