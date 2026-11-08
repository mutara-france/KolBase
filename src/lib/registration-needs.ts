/**
 * Besoins déclarés à l'inscription : régime alimentaire, allergies, accessibilité ou adaptation (handicap). Tous
 * facultatifs. Une allergie ou un besoin lié à un handicap est une donnée de santé, un régime « halal » ou « casher »
 * révèle une conviction religieuse (RGPD, article 9) : ils ne sont enregistrés qu'avec l'accord explicite de la
 * personne, servent à préparer l'événement (organisateur, agence mandatée, lieu et traiteur, sans les noms pour ces
 * derniers) et sont effacés 30 jours après la fin de l'événement.
 */

export const DIETS = [
  { id: "vegetarien", label: "Végétarien" },
  { id: "vegetalien", label: "Végétalien" },
  { id: "sans-porc", label: "Sans porc" },
  { id: "halal", label: "Halal" },
  { id: "casher", label: "Casher" },
  { id: "sans-gluten", label: "Sans gluten" },
  { id: "sans-lactose", label: "Sans lactose" },
] as const;

export const dietLabel = (id: string | null | undefined) => DIETS.find((d) => d.id === id)?.label ?? null;

/** Conservation des besoins après la fin de l'événement. */
export const NEEDS_RETENTION_DAYS = 30;

export type Needs = { diet: string | null; allergies: string | null; needs: string | null };
export type NeedsResult = Needs & { error?: string };

const clip = (v: FormDataEntryValue | null, n: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, n) || null;

/** Lecture du formulaire : un besoin renseigné exige la case d'accord. */
export function readNeeds(form: FormData): NeedsResult {
  const rawDiet = String(form.get("diet") ?? "");
  const diet = DIETS.some((d) => d.id === rawDiet) ? rawDiet : null;
  const allergies = clip(form.get("allergies"), 300);
  const needs = clip(form.get("needs"), 500);
  if ((diet || allergies || needs) && form.get("needsConsent") !== "1")
    return { diet: null, allergies: null, needs: null, error: "Cochez l'accord pour transmettre vos besoins à l'organisateur, ou laissez ces champs vides." };
  return { diet, allergies, needs };
}

export const hasNeeds = (r: Partial<Needs>) => !!(r.diet || r.allergies || r.needs);

/** Synthèse sans les noms (à transmettre au lieu et au traiteur) : régimes comptés, allergies, besoins d'accessibilité. */
export function needsSummary(regs: Partial<Needs>[]) {
  const diets = DIETS.map((d) => ({ ...d, count: regs.filter((r) => r.diet === d.id).length })).filter((d) => d.count > 0);
  const allergies = regs.map((r) => r.allergies).filter((a): a is string => !!a);
  const needs = regs.map((r) => r.needs).filter((n): n is string => !!n);
  return { diets, allergies, needs, total: regs.filter(hasNeeds).length };
}
