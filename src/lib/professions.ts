/** Professions proposées à l'inscription, et règles de référencement comme expert. */
export const PROFESSIONS = [
  "Chirurgien-dentiste",
  "Chirurgien-dentiste spécialiste ODF",
  "Chirurgien oral",
  "Médecin stomatologue",
  "Assistant(e) dentaire",
  "Prothésiste dentaire",
  "Étudiant(e) en odontologie",
] as const;

/** Praticiens diplômés : seuls à pouvoir se référencer comme experts et à porter le titre de docteur. */
export const EXPERT_PROFESSIONS: readonly string[] = PROFESSIONS.slice(0, 4);

export const canBeExpert = (profession: string | null | undefined) => !!profession && EXPERT_PROFESSIONS.includes(profession);

/** « Dr » devant le nom des seuls praticiens diplômés. */
export const drPrefix = (profession: string | null | undefined) => (canBeExpert(profession) ? "Dr " : "");

/** Numéro RPPS : 11 chiffres (espaces tolérés à la saisie). */
export const normalizeRpps = (v: string) => v.replace(/\s/g, "");
export const isRpps = (v: string) => /^\d{11}$/.test(v);
