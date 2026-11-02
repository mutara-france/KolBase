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
/** Clé de Luhn (dernier chiffre), comme pour le SIREN. */
export function luhnOk(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
/** Numéro RPPS : 11 chiffres dont le dernier est une clé de Luhn (Agence du numérique en santé). */
export const isRpps = (v: string) => /^\d{11}$/.test(v) && luhnOk(v);
/** Complète un numéro par sa clé de Luhn (numéros fictifs de démonstration). */
export function withLuhn(base: string) {
  for (let k = 0; k <= 9; k++) if (luhnOk(base + k)) return base + k;
  return base + "0";
}
