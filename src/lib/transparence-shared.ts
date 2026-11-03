/** Transparence Santé : libellés de la plateforme et semestres de déclaration (module pur). */

/** Objet de convention (libellés Transparence Santé) selon le type de collaboration. */
export const CONVENTION_OBJECT: Record<string, string> = {
  advisory: "Contrat de conseil / d'expertise autre que scientifique",
  "comite-sci": "Contrat d'expert scientifique",
  interview: "Contrat de conseil / d'expertise autre que scientifique",
  "test-produit": "Contrat d'évaluation scientifique",
  symposium: "Contrat d'intervenant à une manifestation",
  pleniere: "Contrat d'intervenant à une manifestation",
  "table-ronde": "Contrat d'intervenant à une manifestation",
  webinaire: "Contrat d'intervenant à une manifestation",
  "live-surgery": "Contrat d'intervenant à une manifestation",
  "travaux-pratiques": "Formation",
  dpc: "Formation",
  redaction: "Contrat d'expert scientifique",
  relecture: "Contrat d'évaluation scientifique",
  podcast: "Contrat d'interview",
  "cas-clinique": "Contrat d'expert scientifique",
  investigateur: "Contrat de recherche scientifique",
  observationnelle: "Contrat de recherche scientifique",
  registre: "Contrat de recherche scientifique",
  partenariat: "Partenariat",
};
export const HOSPITALITY_CONVENTION = "Contrat de participation à une manifestation";

/** Nature d'avantage (libellés Transparence Santé) selon la prestation d'hospitalité. */
export const BENEFIT_NATURE: Record<string, string> = {
  cafe: "Hospitalité - collation",
  dejeuner: "Hospitalité - restauration",
  cocktail: "Hospitalité - restauration",
  nuitee: "Hospitalité - hébergement",
  transport: "Frais de transport",
};

export const COLUMNS = [
  "Action", "Déclaration", "Identifiant unique", "Convention liée", "Date de signature / versement", "Date de fin",
  "Objet convention / nature avantage", "Autre", "Montant des conventions / avantages / rémunération", "Information convention",
  "Type identifiant professionnel", "N° identifiant", "Profession", "Identité / Nom", "Prénom", "Structure d'exercice / de rattachement",
  "Adresse", "Code postal", "Ville", "Pays",
] as const;

/** Seuil de déclaration des avantages et rémunérations (en euros, TTC pour les avantages). */
export const THRESHOLD_EUR = 10;

export type Semester = { year: number; half: 1 | 2 };
export const semesterOf = (d: Date): Semester => ({ year: d.getFullYear(), half: d.getMonth() < 6 ? 1 : 2 });
export const semesterKey = (s: Semester) => `${s.year}-S${s.half}`;
export const parseSemester = (raw: string | null | undefined): Semester | null => {
  const m = /^(\d{4})-S([12])$/.exec(raw ?? "");
  return m ? { year: Number(m[1]), half: Number(m[2]) as 1 | 2 } : null;
};
export const semesterRange = (s: Semester) => ({ gte: new Date(s.year, s.half === 1 ? 0 : 6, 1), lt: s.half === 1 ? new Date(s.year, 6, 1) : new Date(s.year + 1, 0, 1) });
export const semesterLabel = (s: Semester) => `${s.half === 1 ? "1er" : "2e"} semestre ${s.year}`;
/** Les quatre derniers semestres, le plus récent d'abord. */
export const recentSemesters = (now = new Date()) => {
  const out: Semester[] = [];
  let s = semesterOf(now);
  for (let i = 0; i < 4; i++) {
    out.push(s);
    s = s.half === 2 ? { year: s.year, half: 1 } : { year: s.year - 1, half: 2 };
  }
  return out;
};
