"use client";

import { useState } from "react";
import { useLocale, useT } from "@/components/I18nProvider";
import { computedFee, effectiveHourly, type FeeLevelOpt, HOUR_FIELDS, HOUR_LABEL, hoursOf, parseHours } from "@/lib/fees";
import { intlLocale } from "@/lib/i18n";

export type FeeDefaults = { units?: string; fee?: string; level?: string; prepHours?: string; interventionHours?: string; travelHours?: string };

/**
 * Conditions proposées à un expert : unités, niveau de la grille de rémunération, volume horaire (préparation,
 * intervention, déplacement) et honoraires. Avec un niveau et des heures, les honoraires se calculent (modifiables) ;
 * le taux horaire réel est rapproché du seuil d'autorisation de l'organisation.
 * `suffix` distingue les experts d'un même formulaire (« fee_<id> »).
 */
export function FeeFields({ unit, levels, hourlyMax, defaults = {}, suffix = "", compact = false }: { unit: string; levels: FeeLevelOpt[]; hourlyMax: number; defaults?: FeeDefaults; suffix?: string; compact?: boolean }) {
  const t = useT();
  const loc = intlLocale(useLocale());
  const [level, setLevel] = useState(defaults.level ?? "");
  const [hours, setHours] = useState<Record<string, string>>({ prepHours: defaults.prepHours ?? "", interventionHours: defaults.interventionHours ?? "", travelHours: defaults.travelHours ?? "" });
  const [fee, setFee] = useState(defaults.fee ?? "");
  // Honoraires saisis à la main : le calcul ne les remplace plus (choisir un niveau de la grille le rétablit).
  const [manual, setManual] = useState(!!defaults.fee);
  const rate = levels.find((l) => l.id === level)?.hourlyCents ?? null;
  const total = hoursOf(Object.fromEntries(HOUR_FIELDS.map((k) => [k, parseHours(hours[k]) ?? null])));
  const computed = computedFee(total, rate);
  const shownFee = manual || computed == null ? fee : String(computed / 100);
  const feeCents = Math.round(Number(shownFee.replace(/\s/g, "").replace(",", ".")) * 100);
  const hourly = effectiveHourly(Number.isFinite(feeCents) ? feeCents : null, total);
  const eur = (c: number) => (c / 100).toLocaleString(loc, { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  const n = (k: string) => `${k}${suffix}`;
  return (
    <div className={`fee-fields${compact ? " compact" : ""}`}>
      <div className="row">
        <label>{t("Unités ({unit})", { unit: t(unit) })}<input name={n("units")} inputMode="decimal" defaultValue={defaults.units ?? "1"} /></label>
        {levels.length > 0 && (
          <label>{t("Niveau de rémunération")}
            <select name={n("level")} value={level} onChange={(e) => { setLevel(e.target.value); setManual(false); }}>
              <option value="">{t("Hors grille")}</option>
              {levels.map((l) => <option key={l.id} value={l.id}>{l.label} · {eur(l.hourlyCents)}{t(" / h")}</option>)}
            </select>
          </label>
        )}
      </div>
      <fieldset className="hours-row">
        <legend>{t("Volume horaire (heures)")}</legend>
        {HOUR_FIELDS.map((k) => (
          <label key={k}>{t(HOUR_LABEL[k])}<input name={n(k)} inputMode="decimal" value={hours[k]} onChange={(e) => setHours({ ...hours, [k]: e.target.value })} placeholder="0" /></label>
        ))}
      </fieldset>
      <label>{t("Honoraires totaux (€ HT)")}
        <input name={n("fee")} inputMode="decimal" value={shownFee} onChange={(e) => { setFee(e.target.value); setManual(true); }} required={computed == null} />
      </label>
      <p className="hint" aria-live="polite">
        {computed != null && rate != null && total != null && t("Grille : {hours} h × {rate} = {total} HT.", { hours: total.toLocaleString(loc), rate: `${eur(rate)}${t(" / h")}`, total: eur(computed) })}
        {manual && computed != null && feeCents !== computed && <> <button type="button" className="link" onClick={() => { setManual(false); setFee(""); }}>{t("Appliquer la grille")}</button></>}
        {hourly != null && <> {t("Taux horaire réel : {rate} / h.", { rate: eur(Math.round(hourly * 100)) })}</>}
        {hourly != null && hourly > hourlyMax && <strong className="warn-text"> {t("Au-delà de {max} € / h : convention soumise à autorisation.", { max: hourlyMax })}</strong>}
      </p>
    </div>
  );
}
