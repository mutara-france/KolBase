"use client";

import { AiDraft } from "@/components/AiDraft";
import { ExpertSuggestions } from "@/components/ExpertSuggestions";
import { useActionState, useMemo, useState } from "react";
import { createProject, postMessage, respondToSolicitation } from "@/lib/project-actions";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { BLOCKED_UNTIL, type Blocked } from "@/lib/billing-plans";
import { useLocale, useT } from "@/components/I18nProvider";
import { intlLocale } from "@/lib/i18n/core";
import { FeeFields } from "@/components/FeeFields";
import type { FeeLevelOpt } from "@/lib/fees";

type CType = { id: string; label: string; category: string; unit: string; fmv: readonly number[] };
type Expert = { id: string; name: string; detail: string; dayRateCents: number | null };

export function NewProjectForm({ orgId, types, experts, preselected, ai = false, blocked = null, levels = [], hourlyMax = 200 }: { orgId: string; types: readonly CType[]; experts: Expert[]; preselected: string[]; ai?: boolean; blocked?: Blocked; levels?: FeeLevelOpt[]; hourlyMax?: number }) {
  const t = useT();
  const locale = useLocale();
  const [state, action, pending] = useActionState(createProject, undefined);
  const [typeId, setTypeId] = useState(types[0].id);
  const [selected, setSelected] = useState<string[]>(preselected);
  const [filter, setFilter] = useState("");
  const [extra, setExtra] = useState<Expert[]>([]);
  const all = useMemo(() => [...experts, ...extra.filter((x) => !experts.some((e) => e.id === x.id))], [experts, extra]);
  const type = types.find((t) => t.id === typeId)!;
  const visible = useMemo(
    () => experts.filter((e) => !filter || `${e.name} ${e.detail}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 30),
    [experts, filter],
  );
  const categories = [...new Set(types.map((t) => t.category))];

  return (
    <ActionForm action={action} className="card form">
      <h1>{t("Nouveau dossier")}</h1>
      <p className="muted">{t("Sollicitez un ou plusieurs experts. Chacun reçoit la proposition dans son espace et y répond.")}</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>{t("Titre du dossier")}<input name="title" required placeholder={t("Ex. : Board implantologie — printemps")} /></label>
      <div className="row">
        <label>{t("Type de collaboration")}
          <select name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {categories.map((c) => (
              <optgroup key={c} label={t(c)}>{types.filter((ty) => ty.category === c).map((ty) => <option key={ty.id} value={ty.id}>{t(ty.label)}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label>{t("Domaine thérapeutique")}<input name="therapeuticArea" /></label>
      </div>
      <p className="hint">{t("Repère indicatif KolBase (non réglementaire) : {toLocaleString} à {toLocaleString2} € HT par {unit}. La juste contrepartie reste à documenter par votre organisation.", { toLocaleString: type.fmv[0].toLocaleString(intlLocale(locale)), toLocaleString2: type.fmv[1].toLocaleString(intlLocale(locale)), unit: t(type.unit) })}</p>
      <label>{t("Objet et déroulé")}<textarea name="description" rows={ai ? 6 : 4} placeholder={t("Contexte, livrables attendus, dates…")} /></label>
      {ai && <AiDraft kind="objet" target="description" label={t("Rédiger l'objet avec l'IA")} />}

      <fieldset>
        <legend>{t("Experts sollicités")}</legend>
        <ExpertSuggestions
          orgId={orgId}
          selected={selected}
          onAdd={(e) => {
            setExtra((xs) => (xs.some((x) => x.id === e.id) ? xs : [...xs, e]));
            setSelected((sel) => (sel.includes(e.id) ? sel : [...sel, e.id]));
          }}
        />
        <input className="filter" placeholder={t("Filtrer par nom, spécialité, ville…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="expert-pick">
          {visible.map((e) => (
            <label key={e.id} className="check">
              <input
                type="checkbox"
                checked={selected.includes(e.id)}
                onChange={(ev) => setSelected(ev.target.checked ? [...selected, e.id] : selected.filter((x) => x !== e.id))}
              />
              <span><strong>{e.name}</strong> <span className="muted">{e.detail}</span></span>
            </label>
          ))}
          {visible.length === 0 && <p className="muted">{t("Aucun expert référencé ne correspond.")}</p>}
        </div>
      </fieldset>

      {selected.length > 0 && (
        <fieldset>
          <legend>{t("Conditions proposées")}</legend>
          {selected.map((id) => {
            const e = all.find((x) => x.id === id);
            if (!e) return null;
            return (
              <div key={id} className="fee-block">
                <input type="hidden" name="expertId" value={id} />
                <strong>{e.name}</strong>
                <FeeFields unit={type.unit} levels={levels} hourlyMax={hourlyMax} suffix={`_${id}`} defaults={{ fee: e.dayRateCents != null ? String(e.dayRateCents / 100) : "" }} />
              </div>
            );
          })}
        </fieldset>
      )}
      <label>{t("Message d'accompagnement")}<textarea name="message" rows={3} placeholder={t("Message envoyé à chaque expert sollicité")} /></label>
      <button className="btn" disabled={pending || !!blocked}>{pending ? t("Envoi…") : t("Envoyer les sollicitations")}</button>
      {blocked && <p className="hint">{t("Envoi possible {blocked} (voir le bandeau en haut de la page).", { blocked: t(BLOCKED_UNTIL[blocked]) })}</p>}
    </ActionForm>
  );
}

export function MessageForm({ linkId }: { linkId: string }) {
  const [state, action, pending] = useActionState(postMessage, undefined);
  const t = useT();
  return (
    <form action={action} className="stack-sm" key={state?.ok ? Date.now() : "msg"}>
      {state?.error && <Notice state={state} />}
      <div className="composer">
        <textarea name="body" rows={2} placeholder={t("Votre message…")} aria-label={t("Votre message…")} required />
        <input type="hidden" name="linkId" value={linkId} />
        <button className="btn small" disabled={pending}>{pending ? t("Envoi…") : t("Envoyer")}</button>
      </div>
    </form>
  );
}

/**
 * Réponse de l'expert : accord de principe, autres honoraires (montant obligatoire, la sollicitation reste ouverte)
 * ou déclin. Le message est facultatif ; l'indice dit ce qui se passe pour chaque réponse.
 */
export function RespondForm({ linkId }: { linkId: string }) {
  const [state, action, pending] = useActionState(respondToSolicitation, undefined);
  const t = useT();
  if (state?.ok) return <p className="notice ok">{state.ok}</p>;
  return (
    <ActionForm action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="linkId" value={linkId} />
      <label>{t("Message (facultatif)")}<textarea name="note" rows={2} placeholder={t("Disponibilités, conditions, questions…")} /></label>
      <label>{t("Autres honoraires (€ HT, total pour la prestation)")}<input name="desiredFee" inputMode="decimal" placeholder={t("Seulement pour « Proposer d'autres honoraires »")} /></label>
      <div className="actions">
        <button className="btn" name="answer" value="accept" disabled={pending}>{t("Donner mon accord de principe")}</button>
        <button className="btn secondary" name="answer" value="counter" disabled={pending}>{t("Proposer d'autres honoraires")}</button>
        <button className="btn ghost" name="answer" value="decline" disabled={pending}>{t("Décliner")}</button>
      </div>
      <ul className="hint stack-sm">
        <li>{t("Accord de principe : il n'engage pas encore ; la convention vous sera soumise après validation par la conformité.")}</li>
        <li>{t("Proposer d'autres honoraires : la sollicitation reste ouverte ; l'organisation peut accepter votre montant ou vous renvoyer une proposition.")}</li>
        <li>{t("Décliner : la sollicitation est close et l'organisation est prévenue.")}</li>
      </ul>
    </ActionForm>
  );
}
