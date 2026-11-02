/**
 * Paramètres et règles du dispositif « anti-cadeaux » (articles L.1453-1 et s. CSP).
 * Valeurs par défaut reprises de l'arrêté du 7 août 2020 fixant les seuils au-delà desquels une
 * convention est soumise à autorisation : rémunération 200 € par heure dans la limite de 800 € par
 * demi-journée et de 2 000 € par convention ; hospitalité 150 € par nuitée, 50 € par repas, 15 € par
 * collation et 2 000 € au total (transport compris). À valider par le service juridique de chaque
 * organisation (notamment HT / TTC). Le dépassement d'un seul seuil soumet toute la convention à autorisation.
 */
import { country, practicesInFrance } from "@/lib/countries";

export type ComplianceSettings = {
  remunerationConventionMax: number; // € HT par convention
  remunerationHourlyMax: number; // € HT par heure
  remunerationHalfDayMax: number; // € HT par demi-journée
  hospitalityNightMax: number; // € TTC par nuitée
  hospitalityMealMax: number; // € TTC par repas
  hospitalityCollationMax: number; // € TTC par collation
  hospitalityTotalMax: number; // € TTC par événement
  cumulAlert: number; // € HT sur 12 mois, alerte de cumul
  declarationDays: number; // délai de déclaration avant exécution (jours ouvrables)
  authorizationDays: number; // délai de demande d'autorisation avant exécution
};

export const DEFAULT_COMPLIANCE: ComplianceSettings = {
  remunerationConventionMax: 2000,
  remunerationHourlyMax: 200,
  remunerationHalfDayMax: 800,
  hospitalityNightMax: 150,
  hospitalityMealMax: 50,
  hospitalityCollationMax: 15,
  hospitalityTotalMax: 2000,
  cumulAlert: 10000,
  declarationDays: 8,
  authorizationDays: 60,
};

export const SETTING_FIELDS: { key: keyof ComplianceSettings; label: string; unit: string; group: string }[] = [
  { key: "remunerationConventionMax", label: "Rémunération : montant par convention", unit: "€ HT", group: "Seuils d'autorisation" },
  { key: "remunerationHourlyMax", label: "Rémunération : taux horaire", unit: "€ HT / h", group: "Seuils d'autorisation" },
  { key: "remunerationHalfDayMax", label: "Rémunération : par demi-journée", unit: "€ HT", group: "Seuils d'autorisation" },
  { key: "hospitalityNightMax", label: "Hospitalité : nuitée", unit: "€ TTC", group: "Seuils d'autorisation" },
  { key: "hospitalityMealMax", label: "Hospitalité : repas", unit: "€ TTC", group: "Seuils d'autorisation" },
  { key: "hospitalityCollationMax", label: "Hospitalité : collation (pause café…)", unit: "€ TTC", group: "Seuils d'autorisation" },
  { key: "hospitalityTotalMax", label: "Hospitalité : total par événement", unit: "€ TTC", group: "Seuils d'autorisation" },
  { key: "cumulAlert", label: "Alerte de cumul par expert sur 12 mois", unit: "€ HT", group: "Alertes" },
  { key: "declarationDays", label: "Délai de déclaration avant exécution", unit: "jours ouvrables", group: "Délais" },
  { key: "authorizationDays", label: "Délai de demande d'autorisation avant exécution", unit: "jours", group: "Délais" },
];

export function complianceSettings(raw: unknown): ComplianceSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_COMPLIANCE };
  for (const f of SETTING_FIELDS) {
    const v = Number(r[f.key]);
    if (Number.isFinite(v) && v >= 0) out[f.key] = v;
  }
  return out;
}

export type Regime = "declaration" | "autorisation" | "hors_france";
export const REGIME_LABEL: Record<Regime, string> = { declaration: "Déclaration", autorisation: "Autorisation", hors_france: "Hors France" };

/** Praticien exerçant hors de France : le dispositif anti-cadeaux français (EPS) ne s'applique pas. */
export function foreignRegime(code: string): { regime: Regime; reason: string } {
  return { regime: "hors_france", reason: `Exerce ${country(code).in} : règles du pays d'exercice` };
}

/** Régime d'une rémunération : autorisation au-delà du seuil par convention ou du taux horaire. */
export function remunerationRegime(s: ComplianceSettings, feeCents: number | null, units: number | null, unit: string): { regime: Regime; reason: string } {
  const fee = (feeCents ?? 0) / 100;
  if (fee > s.remunerationConventionMax) return { regime: "autorisation", reason: `${fee.toLocaleString("fr-FR")} € > ${s.remunerationConventionMax.toLocaleString("fr-FR")} € par convention` };
  // Volume absent ou incohérent : on compte une seule unité, l'hypothèse la plus prudente.
  const known = units != null && Number.isFinite(units) && units > 0;
  const n = known ? units : 1;
  const unknown = known ? "" : " (volume non renseigné : compté pour 1)";
  if (unit === "heure" && fee / n > s.remunerationHourlyMax)
    return { regime: "autorisation", reason: `${Math.round(fee / n)} €/h > ${s.remunerationHourlyMax} €/h${unknown}` };
  // Une journée compte deux demi-journées.
  if (unit === "journée" && fee / n > 2 * s.remunerationHalfDayMax)
    return { regime: "autorisation", reason: `${Math.round(fee / n).toLocaleString("fr-FR")} € par journée > ${s.remunerationHalfDayMax} € par demi-journée${unknown}` };
  return { regime: "declaration", reason: "Sous les seuils d'autorisation" };
}

/**
 * Régime d'un dossier : autorisation dès qu'un expert engagé exerçant en France dépasse un seuil.
 * Si tous les experts engagés exercent hors de France, le dossier sort du dispositif EPS (« hors France »).
 */
export function projectRegime(s: ComplianceSettings, unit: string, experts: { status: string; feeCents: number | null; days: number | null; country?: string | null }[]) {
  const engaged = experts.filter((e) => e.status !== "DECLINE");
  const french = engaged.filter((e) => practicesInFrance(e.country));
  if (engaged.length > 0 && french.length === 0) {
    const codes = [...new Set(engaged.map((e) => e.country ?? "XX"))];
    return codes.length === 1 ? foreignRegime(codes[0]) : { regime: "hors_france" as Regime, reason: "Experts exerçant hors de France : règles de leurs pays d'exercice" };
  }
  const regimes = french.map((e) => remunerationRegime(s, e.feeCents, e.days, unit));
  return regimes.find((r) => r.regime === "autorisation") ?? regimes[0] ?? null;
}

/** Régime d'une hospitalité : autorisation si nuitée, repas ou total dépassent les seuils. */
export function hospitalityRegime(s: ComplianceSettings, benefits: { catalogId: string; valueCents: number }[]): { regime: Regime; reason: string } {
  const total = benefits.reduce((x, b) => x + b.valueCents, 0) / 100;
  const night = benefits.find((b) => b.catalogId === "nuitee" && b.valueCents / 100 > s.hospitalityNightMax);
  if (night) return { regime: "autorisation", reason: `Nuitée ${night.valueCents / 100} € > ${s.hospitalityNightMax} €` };
  const meal = benefits.find((b) => ["dejeuner", "cocktail"].includes(b.catalogId) && b.valueCents / 100 > s.hospitalityMealMax);
  if (meal) return { regime: "autorisation", reason: `Repas ${meal.valueCents / 100} € > ${s.hospitalityMealMax} €` };
  const snack = benefits.find((b) => b.catalogId === "cafe" && b.valueCents / 100 > s.hospitalityCollationMax);
  if (snack) return { regime: "autorisation", reason: `Collation ${snack.valueCents / 100} € > ${s.hospitalityCollationMax} €` };
  if (total > s.hospitalityTotalMax) return { regime: "autorisation", reason: `Total ${total} € > ${s.hospitalityTotalMax} €` };
  return { regime: "declaration", reason: "Sous les seuils d'autorisation" };
}
