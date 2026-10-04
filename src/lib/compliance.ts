/**
 * Paramètres et règles du dispositif « anti-cadeaux » (articles L.1453-1 et s. CSP).
 * Valeurs par défaut reprises des arrêtés du 7 août 2020 (seuils au-delà desquels une
 * autorisation est requise) : à valider par le service juridique de chaque organisation.
 */
export type ComplianceSettings = {
  remunerationConventionMax: number; // € HT par convention
  remunerationHourlyMax: number; // € HT par heure
  hospitalityNightMax: number; // € TTC par nuitée
  hospitalityMealMax: number; // € TTC par repas
  hospitalityTotalMax: number; // € TTC par événement
  cumulAlert: number; // € HT sur 12 mois, alerte de cumul
  declarationDays: number; // délai de déclaration avant exécution
  authorizationDays: number; // délai de demande d'autorisation avant exécution
};

export const DEFAULT_COMPLIANCE: ComplianceSettings = {
  remunerationConventionMax: 2000,
  remunerationHourlyMax: 200,
  hospitalityNightMax: 150,
  hospitalityMealMax: 50,
  hospitalityTotalMax: 2000,
  cumulAlert: 10000,
  declarationDays: 8,
  authorizationDays: 60,
};

export const SETTING_FIELDS: { key: keyof ComplianceSettings; label: string; unit: string; group: string }[] = [
  { key: "remunerationConventionMax", label: "Rémunération : montant par convention", unit: "€ HT", group: "Seuils d'autorisation" },
  { key: "remunerationHourlyMax", label: "Rémunération : taux horaire", unit: "€ HT / h", group: "Seuils d'autorisation" },
  { key: "hospitalityNightMax", label: "Hospitalité : nuitée", unit: "€ TTC", group: "Seuils d'autorisation" },
  { key: "hospitalityMealMax", label: "Hospitalité : repas", unit: "€ TTC", group: "Seuils d'autorisation" },
  { key: "hospitalityTotalMax", label: "Hospitalité : total par événement", unit: "€ TTC", group: "Seuils d'autorisation" },
  { key: "cumulAlert", label: "Alerte de cumul par expert sur 12 mois", unit: "€ HT", group: "Alertes" },
  { key: "declarationDays", label: "Délai de déclaration avant exécution", unit: "jours", group: "Délais" },
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

export type Regime = "declaration" | "autorisation";
export const REGIME_LABEL: Record<Regime, string> = { declaration: "Déclaration", autorisation: "Autorisation" };

/** Régime d'une rémunération : autorisation au-delà du seuil par convention ou du taux horaire. */
export function remunerationRegime(s: ComplianceSettings, feeCents: number | null, units: number | null, unit: string): { regime: Regime; reason: string } {
  const fee = (feeCents ?? 0) / 100;
  if (fee > s.remunerationConventionMax) return { regime: "autorisation", reason: `${fee.toLocaleString("fr-FR")} € > ${s.remunerationConventionMax.toLocaleString("fr-FR")} € par convention` };
  if (unit === "heure" && units && fee / units > s.remunerationHourlyMax)
    return { regime: "autorisation", reason: `${Math.round(fee / units)} €/h > ${s.remunerationHourlyMax} €/h` };
  return { regime: "declaration", reason: "Sous les seuils d'autorisation" };
}

/** Régime d'une hospitalité : autorisation si nuitée, repas ou total dépassent les seuils. */
export function hospitalityRegime(s: ComplianceSettings, benefits: { catalogId: string; valueCents: number }[]): { regime: Regime; reason: string } {
  const total = benefits.reduce((x, b) => x + b.valueCents, 0) / 100;
  const night = benefits.find((b) => b.catalogId === "nuitee" && b.valueCents / 100 > s.hospitalityNightMax);
  if (night) return { regime: "autorisation", reason: `Nuitée ${night.valueCents / 100} € > ${s.hospitalityNightMax} €` };
  const meal = benefits.find((b) => ["dejeuner", "cocktail"].includes(b.catalogId) && b.valueCents / 100 > s.hospitalityMealMax);
  if (meal) return { regime: "autorisation", reason: `Repas ${meal.valueCents / 100} € > ${s.hospitalityMealMax} €` };
  if (total > s.hospitalityTotalMax) return { regime: "autorisation", reason: `Total ${total} € > ${s.hospitalityTotalMax} €` };
  return { regime: "declaration", reason: "Sous les seuils d'autorisation" };
}
