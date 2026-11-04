"use client";

import { useActionState, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { submitProposal } from "@/lib/proposal-actions";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { Avatar } from "@/components/Avatar";
import { useLocale, useT } from "@/components/I18nProvider";
import { intlLocale } from "@/lib/i18n/core";
import { normalize } from "@/lib/search";

type CType = { id: string; label: string; category: string; unit: string; fmv: readonly number[] };
export type RecipientOrg = { id: string; name: string; kind: string; detail: string; logo: string | null; pending: boolean };

/**
 * Projet proposé par l'expert : la fiche (objectif, public, calendrier, honoraires souhaités face aux repères),
 * une pièce jointe si le stockage est configuré, puis une à cinq organisations destinataires.
 */
export function ProposalForm({ orgs, types, preselected, defaultFee, defaultArea, upload, max }: {
  orgs: RecipientOrg[]; types: readonly CType[]; preselected: string[]; defaultFee: string; defaultArea: string; upload: boolean; max: number;
}) {
  const [state, action, pending] = useActionState(submitProposal, undefined);
  const t = useT();
  const locale = useLocale();
  const num = (n: number) => n.toLocaleString(intlLocale(locale), { maximumFractionDigits: 0 });
  const [typeId, setTypeId] = useState(types[0].id);
  const [fee, setFee] = useState(defaultFee);
  const [units, setUnits] = useState("1");
  const [selected, setSelected] = useState<string[]>(preselected.filter((id) => orgs.some((o) => o.id === id && !o.pending)).slice(0, max));
  const [query, setQuery] = useState("");
  const type = types.find((x) => x.id === typeId)!;
  // Honoraires unitaires face à la fourchette de marché du type (même contrôle que côté organisation).
  const perUnit = (() => {
    const f = Number(fee.replace(/\s/g, "").replace(",", "."));
    const u = Number(units.replace(",", "."));
    return fee && Number.isFinite(f) && u > 0 ? f / u : null;
  })();
  const fmv = perUnit == null ? null : perUnit > type.fmv[1] ? "above" : perUnit < type.fmv[0] ? "below" : "ok";
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return orgs.filter((o) => !q || normalize(`${o.name} ${o.kind} ${o.detail}`).includes(q) || selected.includes(o.id));
  }, [orgs, query, selected]);
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id].slice(0, max) : s.filter((x) => x !== id)));

  return (
    <ActionForm action={action} className="card form proposal-form">
      <Notice state={state} />
      <fieldset className="stack-sm">
        <legend>{t("Le projet")}</legend>
        <label>{t("Titre")}<input name="title" required maxLength={160} placeholder={t("Ex. : Étude clinique sur la maintenance implantaire")} /></label>
        <div className="row">
          <label>{t("Type")}
            <select name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {types.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
            </select>
          </label>
          <label>{t("Domaine")}<input name="therapeuticArea" defaultValue={defaultArea} maxLength={120} /></label>
        </div>
        <label>{t("Objectif et contenu")}
          <textarea name="description" rows={6} required minLength={30} maxLength={6000} placeholder={t("Ce que vous proposez, pourquoi, ce que l'organisation y gagne, vos résultats ou cas cliniques…")} />
        </label>
        <label><span>{t("Public visé et format")} <span className="optional">({t("facultatif")})</span></span>
          <textarea name="audience" rows={2} maxLength={2000} placeholder={t("Ex. : omnipraticiens, webinaire de 60 minutes suivi de questions")} />
        </label>
        <label><span>{t("Calendrier envisagé")} <span className="optional">({t("facultatif")})</span></span>
          <input name="schedule" maxLength={1000} placeholder={t("Ex. : premier semestre 2027, trois sessions")} />
        </label>
      </fieldset>

      <fieldset className="stack-sm">
        <legend>{t("Honoraires souhaités")}</legend>
        <div className="row">
          <label>{t("Volume ({unit})", { unit: t(type.unit) })}<input name="units" inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} /></label>
          <label>{t("Honoraires souhaités (€ HT, total)")}<input name="fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
        </div>
        <p className={`hint${fmv === "above" ? " warn-text" : ""}`} role="status">
          {t("Référence : {min} à {max} € HT par {unit}.", { min: num(type.fmv[0]), max: num(type.fmv[1]), unit: t(type.unit) })}{" "}
          {fmv === "above" && t("Votre demande dépasse ce repère : l'organisation devra justifier ce montant auprès de sa conformité.")}
          {fmv === "below" && t("Votre demande est sous ce repère.")}
        </p>
      </fieldset>

      {upload && (
        <label><span>{t("Pièce jointe")} <span className="optional">({t("facultatif")})</span></span>
          <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.pptx" />
          <span className="hint">{t("Protocole, programme, présentation : PDF, image ou document bureautique, 10 Mo au maximum. Chaque organisation la reçoit avec sa copie.")}</span>
        </label>
      )}

      <fieldset className="stack-sm">
        <legend>{t("Organisations destinataires ({n}/{max})", { n: selected.length, max })}</legend>
        <p className="hint" style={{ margin: 0 }}>{t("Chaque organisation reçoit sa propre copie, sans savoir à qui d'autre vous l'avez envoyée.")}</p>
        <label className="org-search">
          <Search size={15} aria-hidden />
          <span className="sr-only">{t("Rechercher une organisation")}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Rechercher une organisation…")} />
        </label>
        {orgs.length === 0 && <p className="muted">{t("Aucune organisation ne reçoit encore de propositions.")}</p>}
        <ul className="org-pick" aria-label={t("Organisations")}>
          {visible.map((o) => {
            const checked = selected.includes(o.id);
            const disabled = o.pending || (!checked && selected.length >= max);
            return (
              <li key={o.id}>
                <label className={`org-option${checked ? " on" : ""}${o.pending ? " off" : ""}`}>
                  <input type="checkbox" name="orgId" value={o.id} checked={checked} disabled={disabled} onChange={(e) => toggle(o.id, e.target.checked)} />
                  <Avatar name={o.name} size={32} square src={o.logo} />
                  <span className="grow">
                    <strong>{o.name}</strong>
                    <span className="text-xs muted">{o.pending ? t("Une proposition y attend déjà une réponse") : [o.kind, o.detail].filter(Boolean).join(" · ")}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <label className="check text-sm">
        <input type="checkbox" name="attest" value="1" required />
        <span>{t("Je propose une prestation réelle (formation, intervention, étude, conseil…), rémunérée à sa juste valeur, et non le financement d'une inscription, d'un voyage ou d'une hospitalité.")}</span>
      </label>
      <button className="btn" disabled={pending || selected.length === 0}>
        {pending ? t("Envoi…") : selected.length > 1 ? t("Envoyer à {n} organisations", { n: selected.length }) : t("Envoyer la proposition")}
      </button>
    </ActionForm>
  );
}
