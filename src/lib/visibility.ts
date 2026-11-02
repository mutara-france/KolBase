/** Visibilité des profils, champ par champ (reprise du prototype). */
export type VisLevel = "public" | "industriels" | "masque";
export type ProjVisLevel = "nominatif" | "agrege" | "masque";
/**
 * Qui regarde :
 * - public : visiteur non connecté ;
 * - connecte : compte connecté sans organisation cliente (praticien, prestataire…) ;
 * - membre : niveau « industriels » accessible (fiche expert : voir kolViewer ; page d'organisation : tout compte connecté) ;
 * - proprietaire : le praticien lui-même, ou un membre de l'organisation.
 */
export type Viewer = "public" | "connecte" | "membre" | "proprietaire";

export const VISIBILITY_LEVELS: { id: VisLevel; label: string; hint: string }[] = [
  { id: "public", label: "Public", hint: "visible sans connexion" },
  { id: "industriels", label: "Membres connectés", hint: "réservé aux comptes connectés" },
  { id: "masque", label: "Masqué", hint: "visible de vous seul" },
];
/** Sur une fiche expert, le niveau intermédiaire est réservé aux organisations (et non à tout compte connecté). */
export const KOL_VISIBILITY_LEVELS: typeof VISIBILITY_LEVELS = [
  VISIBILITY_LEVELS[0],
  { id: "industriels", label: "Organisations", hint: "réservé aux membres des organisations inscrites (industriels, sociétés savantes…)" },
  VISIBILITY_LEVELS[2],
];
export const PROJECT_VISIBILITY_LEVELS: { id: ProjVisLevel; label: string; hint: string }[] = [
  { id: "nominatif", label: "Détail nominatif", hint: "noms des partenaires et intitulés" },
  { id: "agrege", label: "Agrégé", hint: "nombres seulement" },
  { id: "masque", label: "Masqué", hint: "rien n'est affiché" },
];

export const KOL_VIS_FIELDS = [
  { key: "contact", label: "Lieu d'exercice et coordonnées", desc: "Cabinet ou service, ville, langues." },
  { key: "publications", label: "Publications", desc: "Titres, revues et mots-clés." },
  { key: "tarif", label: "Tarif indicatif", desc: "Votre tarif journalier indicatif." },
  { key: "structures", label: "Structures juridiques", desc: "Sociétés, associations et fonctions déclarées." },
  { key: "historique", label: "Statistiques d'activité", desc: "Délai de réponse, volume de collaborations." },
] as const;
export const COMPANY_VIS_FIELDS = [
  { key: "areas", label: "Aires d'intervention", desc: "Spécialités dans lesquelles vous collaborez." },
  { key: "policy", label: "Politique de conformité", desc: "Vos règles de contractualisation." },
  { key: "contact", label: "Contact partenariats", desc: "Adresse de prise de contact." },
  { key: "projets", label: "Appels ouverts", desc: "Vos opportunités publiées." },
  { key: "equipe", label: "Délais de réponse", desc: "Réactivité moyenne de vos équipes." },
] as const;

export type KolVisibility = Record<(typeof KOL_VIS_FIELDS)[number]["key"], VisLevel> & { projets: ProjVisLevel };
export type CompanyVisibility = Record<(typeof COMPANY_VIS_FIELDS)[number]["key"], VisLevel>;

export const DEFAULT_KOL_VISIBILITY: KolVisibility = { contact: "public", tarif: "industriels", publications: "public", structures: "industriels", projets: "nominatif", historique: "public" };
export const DEFAULT_COMPANY_VISIBILITY: CompanyVisibility = { areas: "public", policy: "public", contact: "industriels", projets: "public", equipe: "industriels" };

const isLevel = (v: unknown): v is VisLevel => v === "public" || v === "industriels" || v === "masque";
const isProj = (v: unknown): v is ProjVisLevel => v === "nominatif" || v === "agrege" || v === "masque";

export function kolVisibility(raw: unknown): KolVisibility {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_KOL_VISIBILITY };
  for (const f of KOL_VIS_FIELDS) if (isLevel(r[f.key])) out[f.key] = r[f.key] as VisLevel;
  if (isProj(r.projets)) out.projets = r.projets;
  return out;
}
export function companyVisibility(raw: unknown): CompanyVisibility {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_COMPANY_VISIBILITY };
  for (const f of COMPANY_VIS_FIELDS) if (isLevel(r[f.key])) out[f.key] = r[f.key] as VisLevel;
  return out;
}

type ViewerUser = { practitioner?: { id: string } | null; memberships: { organization: { kind: string } }[] } | null;

/**
 * Visiteur d'une fiche expert. Le niveau « industriels » est réservé aux membres d'une organisation cliente
 * (hors prestataires) : l'inscription étant libre, « tout compte connecté » reviendrait à rendre l'information publique.
 */
export function kolViewer(user: ViewerUser, practitionerId: string): Viewer {
  if (!user) return "public";
  if (user.practitioner?.id === practitionerId) return "proprietaire";
  return user.memberships.some((m) => m.organization.kind !== "PRESTATAIRE") ? "membre" : "connecte";
}

export function canSee(level: VisLevel, viewer: Viewer) {
  if (viewer === "proprietaire") return true;
  if (level === "public") return true;
  if (level === "industriels") return viewer === "membre";
  return false;
}
