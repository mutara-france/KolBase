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

/**
 * Seuils fixés par l'arrêté du 7 août 2020 et délais du dispositif : une organisation peut les rendre plus stricts
 * (seuils plus bas, délais plus longs), jamais plus souples. Les valeurs par défaut sont les valeurs réglementaires.
 */
const LEGAL_CEILINGS: (keyof ComplianceSettings)[] = [
  "remunerationConventionMax", "remunerationHourlyMax", "remunerationHalfDayMax",
  "hospitalityNightMax", "hospitalityMealMax", "hospitalityCollationMax", "hospitalityTotalMax",
];
const LEGAL_FLOORS: (keyof ComplianceSettings)[] = ["declarationDays", "authorizationDays"];

export function complianceSettings(raw: unknown): ComplianceSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_COMPLIANCE };
  for (const f of SETTING_FIELDS) {
    const v = Number(r[f.key]);
    if (!Number.isFinite(v) || v < 0) continue;
    const legal = DEFAULT_COMPLIANCE[f.key];
    out[f.key] = LEGAL_CEILINGS.includes(f.key) ? Math.min(v, legal) : LEGAL_FLOORS.includes(f.key) ? Math.max(v, legal) : v;
  }
  return out;
}

/** Valeur réglementaire qu'un réglage ne peut pas assouplir, avec le sens de la contrainte. */
export const legalBound = (key: keyof ComplianceSettings) =>
  LEGAL_CEILINGS.includes(key) ? { max: DEFAULT_COMPLIANCE[key] } : LEGAL_FLOORS.includes(key) ? { min: DEFAULT_COMPLIANCE[key] } : null;

export type Regime = "declaration" | "autorisation" | "hors_france";
export const REGIME_LABEL: Record<Regime, string> = { declaration: "Déclaration", autorisation: "Autorisation", hors_france: "Hors France" };

/**
 * Motif d'un régime : texte français à traduire à l'affichage (clé du dictionnaire), montants à formater selon la
 * langue (n) et mots à traduire (s). `reason` en est la version française (registre, conventions, exports).
 */
export type RegimeWhy = { key: string; n?: Record<string, number>; s?: Record<string, string> };
export type RegimeResult = { regime: Regime; reason: string; why: RegimeWhy };
const fill = (key: string, v: Record<string, string>) => key.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");
const nums = (loc: string, n: Record<string, number> = {}) =>
  Object.fromEntries(Object.entries(n).map(([k, x]) => [k, x.toLocaleString(loc, { maximumFractionDigits: 2 })]));
const result = (regime: Regime, why: RegimeWhy): RegimeResult => ({ regime, why, reason: fill(why.key, { ...nums("fr-FR", why.n), ...why.s }) });
/** Motif dans la langue d'affichage : t traduit, loc est la locale Intl (fr-FR, en-GB). */
export const regimeReason = (r: { why: RegimeWhy }, t: (key: string, vars?: Record<string, string | number>) => string, loc: string) =>
  t(r.why.key, { ...nums(loc, r.why.n), ...Object.fromEntries(Object.entries(r.why.s ?? {}).map(([k, x]) => [k, t(x)])) });

/** Praticien exerçant hors de France : le dispositif anti-cadeaux français (EPS) ne s'applique pas. */
export function foreignRegime(code: string): RegimeResult {
  return result("hors_france", { key: "Exerce {where} : règles du pays d'exercice", s: { where: country(code).in } });
}

/** Régime d'une rémunération : autorisation au-delà du seuil par convention ou du taux horaire. */
export function remunerationRegime(s: ComplianceSettings, feeCents: number | null, units: number | null, unit: string): RegimeResult {
  const fee = (feeCents ?? 0) / 100;
  if (fee > s.remunerationConventionMax) return result("autorisation", { key: "{fee} € > {max} € par convention", n: { fee, max: s.remunerationConventionMax } });
  // Volume absent ou incohérent : on compte une seule unité, l'hypothèse la plus prudente.
  const known = units != null && Number.isFinite(units) && units > 0;
  const n = known ? units : 1;
  if (unit === "heure" && fee / n > s.remunerationHourlyMax)
    return result("autorisation", { key: known ? "{rate} €/h > {max} €/h" : "{rate} €/h > {max} €/h (volume non renseigné : compté pour 1)", n: { rate: Math.round(fee / n), max: s.remunerationHourlyMax } });
  // Une journée compte deux demi-journées.
  if (unit === "journée" && fee / n > 2 * s.remunerationHalfDayMax)
    return result("autorisation", {
      key: known ? "{rate} € par journée > {max} € par demi-journée" : "{rate} € par journée > {max} € par demi-journée (volume non renseigné : compté pour 1)",
      n: { rate: Math.round(fee / n), max: s.remunerationHalfDayMax },
    });
  return result("declaration", { key: "Sous les seuils d'autorisation" });
}

/**
 * Régime d'un dossier : autorisation dès qu'un expert engagé exerçant en France dépasse un seuil.
 * Si tous les experts engagés exercent hors de France, le dossier sort du dispositif EPS (« hors France »).
 */
export function projectRegime(s: ComplianceSettings, unit: string, experts: { status: string; feeCents: number | null; days: number | null; country?: string | null }[]) {
  // Experts engagés ; les sollicitations sans réponse ne comptent que tant qu'aucun expert n'a accepté (aperçu).
  const live = experts.filter((e) => e.status !== "DECLINE");
  const accepted = live.filter((e) => e.status !== "ATT_EXPERTS");
  const engaged = accepted.length > 0 ? accepted : live;
  const french = engaged.filter((e) => practicesInFrance(e.country));
  if (engaged.length > 0 && french.length === 0) {
    const codes = [...new Set(engaged.map((e) => e.country ?? "XX"))];
    return codes.length === 1 ? foreignRegime(codes[0]) : result("hors_france", { key: "Experts exerçant hors de France : règles de leurs pays d'exercice" });
  }
  const regimes = french.map((e) => remunerationRegime(s, e.feeCents, e.days, unit));
  return regimes.find((r) => r.regime === "autorisation") ?? regimes[0] ?? null;
}

/** Seuils d'hospitalité d'une organisation (€ TTC par personne), transmis aussi au formulaire d'événement. */
export type HospitalityLimits = Pick<ComplianceSettings, "hospitalityNightMax" | "hospitalityMealMax" | "hospitalityCollationMax" | "hospitalityTotalMax" | "authorizationDays" | "declarationDays">;

/** Seuil propre à une prestation du catalogue (€ TTC) ; le transport ne compte que dans le total. */
export function benefitLimit(s: HospitalityLimits, catalogId: string): { max: number; per: string } | null {
  if (catalogId === "nuitee") return { max: s.hospitalityNightMax, per: "par nuitée" };
  if (catalogId === "dejeuner" || catalogId === "cocktail") return { max: s.hospitalityMealMax, per: "par repas" };
  if (catalogId === "cafe") return { max: s.hospitalityCollationMax, per: "par collation" };
  return null;
}

/** Libellé du régime d'une hospitalité (convention, fiche de l'événement, saisie). */

/** Régime d'une hospitalité : autorisation si nuitée, repas ou total dépassent les seuils. Une prestation seule : son seuil et le total. */
export function hospitalityRegime(s: HospitalityLimits, benefits: { catalogId: string; valueCents: number }[]): RegimeResult {
  const total = benefits.reduce((x, b) => x + b.valueCents, 0) / 100;
  const night = benefits.find((b) => b.catalogId === "nuitee" && b.valueCents / 100 > s.hospitalityNightMax);
  if (night) return result("autorisation", { key: "Nuitée {value} € > {max} €", n: { value: night.valueCents / 100, max: s.hospitalityNightMax } });
  const meal = benefits.find((b) => ["dejeuner", "cocktail"].includes(b.catalogId) && b.valueCents / 100 > s.hospitalityMealMax);
  if (meal) return result("autorisation", { key: "Repas {value} € > {max} €", n: { value: meal.valueCents / 100, max: s.hospitalityMealMax } });
  const snack = benefits.find((b) => b.catalogId === "cafe" && b.valueCents / 100 > s.hospitalityCollationMax);
  if (snack) return result("autorisation", { key: "Collation {value} € > {max} €", n: { value: snack.valueCents / 100, max: s.hospitalityCollationMax } });
  if (total > s.hospitalityTotalMax) return result("autorisation", { key: "Total {value} € > {max} €", n: { value: total, max: s.hospitalityTotalMax } });
  return result("declaration", { key: "Sous les seuils d'autorisation" });
}
