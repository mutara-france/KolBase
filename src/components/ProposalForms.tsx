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
import { DEFAULT_IP_POLICY, defaultTopic, TOPICS } from "@/lib/routing";

type CType = { id: string; label: string; category: string; unit: string; fmv: readonly number[] };
export type RecipientOrg = { id: string; name: string; kind: string; detail: string; logo: string | null; pending: boolean; brands?: string[] };

/**
 * Projet proposé par l'expert : la fiche (objectif, public, calendrier, honoraires souhaités face aux repères),
 * une pièce jointe si le stockage est configuré, puis une à cinq organisations destinataires.
 */
export function ProposalForm({ orgs, types, preselected, defaultFee, defaultArea, upload, max, defaultTopic: topic0 }: {
  orgs: RecipientOrg[]; types: readonly CType[]; preselected: string[]; defaultFee: string; defaultArea: string; upload: boolean; max: number; defaultTopic?: string;
}) {
  const [state, action, pending] = useActionState(submitProposal, undefined);
  const t = useT();
  const locale = useLocale();
  const num = (n: number) => n.toLocaleString(intlLocale(locale), { maximumFractionDigits: 0 });
  const [typeId, setTypeId] = useState(types[0].id);
  // Sujet : suit le type de collaboration tant que l'expert ne l'a pas choisi lui-même.
  const [topicPicked, setTopicPicked] = useState<string | null>(topic0 ?? null);
  const topic = topicPicked ?? defaultTopic(types.find((x) => x.id === typeId)!.category);
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
  // Marques des organisations choisies (groupes) : la proposition va à l'entité de la marque concernée.
  const brands = [...new Set(orgs.filter((o) => selected.includes(o.id)).flatMap((o) => o.brands ?? []))];

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
        <label><span>{t("Besoins logistiques")} <span className="optional">({t("facultatif")})</span></span>
          <textarea name="logistics" rows={3} maxLength={2000} placeholder={t("Ex. : salle de 60 places à Lyon, vidéoprojecteur et micros, pause café et déjeuner, captation vidéo")} />
          <span className="hint">{t("L'organisation qui accepte votre projet organise et prend en charge la logistique : vos besoins lui servent de point de départ pour l'événement et les demandes de devis aux prestataires.")}</span>
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

      <fieldset className="stack-sm">
        <legend>{t("Sujet et interlocuteur")}</legend>
        <div className="row">
          <label>{t("Sujet")}
            <select name="topic" value={topic} onChange={(e) => setTopicPicked(e.target.value)}>
              {TOPICS.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
            </select>
          </label>
          {brands.length > 0 && (
            <label>{t("Marque concernée")}
              <select name="brand" defaultValue="">
                <option value="">{t("— toutes —")}</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          )}
        </div>
        <p className="hint" style={{ margin: 0 }}>{t("Chaque organisation transmet votre proposition à la personne en charge de ce sujet ; pour un groupe, à l'entité de votre pays.")}</p>
        {topic === "innovation" && (
          <div className="notice stack-xs">
            <p className="text-sm">{t(DEFAULT_IP_POLICY)}</p>
            <label className="check text-sm"><input type="checkbox" name="ipAck" value="1" required /> {t("J'ai pris connaissance de ces conditions : ma proposition ne contient pas d'information confidentielle.")}</label>
            <label className="check text-sm"><input type="checkbox" name="nda" value="1" /> {t("Je demande un accord de confidentialité avant de détailler mon idée.")}</label>
          </div>
        )}
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
