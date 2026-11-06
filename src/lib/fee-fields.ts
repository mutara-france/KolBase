import "server-only";
import { db } from "@/lib/db";
import { computedFee, HOUR_FIELDS, hoursOf, parseHours } from "@/lib/fees";
import { eurToCents, str, unitsOrNull, UNITS_INVALID } from "@/lib/form";

/** Conditions proposées à un expert, telles qu'enregistrées sur son lien au dossier. */
export type FeeData = {
  feeCents: number;
  days: number | null;
  prepHours: number | null;
  interventionHours: number | null;
  travelHours: number | null;
  feeLevelId: string | null;
  feeLevelLabel: string | null;
  hourlyCents: number | null;
};

/** Niveaux de la grille de rémunération d'une organisation, du taux le plus élevé au plus bas. */
export const feeLevels = (orgId: string) =>
  db.feeLevel.findMany({ where: { organizationId: orgId }, select: { id: true, label: true, hourlyCents: true }, orderBy: [{ hourlyCents: "desc" }, { label: "asc" }] });

/**
 * Lit les champs d'honoraires d'un formulaire (FeeFields), suffixés pour un expert parmi plusieurs (« fee_<id> »).
 * Honoraires laissés vides avec un niveau et des heures : le calcul de la grille s'applique. Le taux et le libellé du
 * niveau sont figés sur le lien (une grille modifiée ensuite ne change pas une proposition faite).
 * Erreur : clé française à traduire par l'appelant.
 */
export async function readFeeFields(form: FormData, orgId: string, suffix = ""): Promise<{ data: FeeData } | { error: string }> {
  const field = (k: string) => str(form, `${k}${suffix}`);
  const units = unitsOrNull(field("units"));
  if (units === undefined) return { error: UNITS_INVALID };
  const hours: Record<(typeof HOUR_FIELDS)[number], number | null> = { prepHours: null, interventionHours: null, travelHours: null };
  for (const k of HOUR_FIELDS) {
    const h = parseHours(field(k));
    if (h === undefined) return { error: "Heures invalides : un nombre entre 0 et 500 (virgule acceptée)." };
    hours[k] = h;
  }
  const levelId = field("level");
  const level = levelId ? await db.feeLevel.findFirst({ where: { id: levelId, organizationId: orgId }, select: { id: true, label: true, hourlyCents: true } }) : null;
  if (levelId && !level) return { error: "Niveau de rémunération introuvable : actualisez la page." };
  const rawFee = field("fee");
  const fee = rawFee ? eurToCents(rawFee) : computedFee(hoursOf(hours), level?.hourlyCents);
  if (fee === null) return { error: level ? "Indiquez des honoraires, ou le volume horaire pour appliquer la grille." : "Indiquez des honoraires (0 si bénévole)." };
  return {
    data: { feeCents: fee, days: units, ...hours, feeLevelId: level?.id ?? null, feeLevelLabel: level?.label ?? null, hourlyCents: level?.hourlyCents ?? null },
  };
}
