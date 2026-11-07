"use client";
import { Coins, SlidersHorizontal } from "lucide-react";
import { SectionHead } from "@/components/UI";

import { useActionState } from "react";
import { addFeeLevel, removeFeeLevel, updateComplianceSettings } from "@/lib/compliance-actions";
import { Notice } from "@/components/AuthForms";
import type { ComplianceSettings } from "@/lib/compliance";
import { useLocale, useT } from "@/components/I18nProvider";
import { intlLocale } from "@/lib/i18n/core";

type Field = { key: keyof ComplianceSettings; label: string; unit: string; group: string; legal?: { min?: number; max?: number } | null };

export function ComplianceSettingsForm({ orgId, settings, fields, canEdit }: { orgId: string; settings: ComplianceSettings; fields: Field[]; canEdit: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateComplianceSettings, undefined);
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <form action={action} className="card form">
      <SectionHead icon={SlidersHorizontal} title={t("Paramètres de conformité")} />
      <p className="muted">
        {t("Valeurs par défaut reprises des arrêtés du 7 août 2020 (seuils au-delà desquels une autorisation est requise). Votre organisation peut les rendre plus strictes (seuils plus bas, délais plus longs), jamais plus souples.")}
      </p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      {groups.map((g) => (
        <fieldset key={g} className="stack">
          <legend><strong>{t(g)}</strong></legend>
          {g === "Délais internes" && <p className="hint">{t("Propres à votre organisation, sans valeur réglementaire : échéances affichées dans les dossiers et les actions à faire, relance quotidienne d'un examen en retard. 0 désactive le délai.")}</p>}
          {fields.filter((f) => f.group === g).map((f) => (
            <label key={f.key}>
              {t(f.label)} <span className="muted">({t(f.unit)})</span>
              <input
                name={f.key} type="number" step="any" defaultValue={settings[f.key]} required disabled={!canEdit}
                min={f.legal?.min ?? 0} max={f.legal?.max}
              />
              {f.legal && <span className="hint">{f.legal.max != null ? t("Plafond réglementaire : {max} {unit}.", { max: f.legal.max, unit: t(f.unit) }) : t("Minimum réglementaire : {min} {unit}.", { min: f.legal.min, unit: t(f.unit) })}</span>}
            </label>
          ))}
        </fieldset>
      ))}
      {canEdit && <button className="btn" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer")}</button>}
    </form>
  );
}

/**
 * Grille de rémunération : niveaux (libellé, taux horaire HT) proposés à la saisie des honoraires d'un expert, avec
 * son volume horaire (préparation, intervention, déplacement). Le taux réel est rapproché du seuil horaire.
 */
export function FeeGridForm({ orgId, levels, hourlyMax }: { orgId: string; levels: { id: string; label: string; hourlyCents: number }[]; hourlyMax: number }) {
  const t = useT();
  const loc = intlLocale(useLocale());
  const [state, action, pending] = useActionState(addFeeLevel, undefined);
  const eur = (c: number) => (c / 100).toLocaleString(loc, { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  return (
    <section className="card stack" id="grille">
      <div>
        <SectionHead icon={Coins} title={t("Grille de rémunération")} desc={t("Taux horaires HT par niveau d'expert ou d'activité. À la sollicitation, l'équipe Projets choisit un niveau et indique le volume horaire (préparation, intervention, déplacement) : les honoraires se calculent, et le taux réel est comparé au seuil de {max} € / h.", { max: hourlyMax })} />
      </div>
      {levels.length === 0 ? <p className="muted">{t("Aucun niveau : les honoraires se saisissent librement.")}</p> : (
        <ul className="fee-levels">
          {levels.map((l) => (
            <li key={l.id}>
              <span className="grow"><strong>{l.label}</strong></span>
              <span className={l.hourlyCents / 100 > hourlyMax ? "warn-text" : ""}>{eur(l.hourlyCents)}{t(" / h")}</span>
              <form action={removeFeeLevel}>
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="levelId" value={l.id} />
                <button className="link danger text-xs" aria-label={t("Retirer le niveau {label}", { label: l.label })}>{t("Retirer")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={action} className="form">
        <Notice state={state} />
        <input type="hidden" name="orgId" value={orgId} />
        <div className="row">
          <label>{t("Niveau")}<input name="label" maxLength={80} placeholder={t("Expert national, formateur, investigateur…")} required /></label>
          <label className="short">{t("Taux horaire (€ HT)")}<input name="hourly" inputMode="decimal" required /></label>
        </div>
        <button className="btn ghost small" disabled={pending}>{pending ? t("Enregistrement…") : t("Ajouter le niveau")}</button>
      </form>
      <p className="hint">{t("Retirer un niveau ne modifie pas les propositions déjà faites : elles gardent leur taux.")}</p>
    </section>
  );
}
