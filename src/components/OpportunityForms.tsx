"use client";
import { Megaphone } from "lucide-react";
import { SectionHead } from "@/components/UI";

import { AiDraft } from "@/components/AiDraft";
import { useActionState, useState } from "react";
import { applyToCall, createOpenCall, retainApplication } from "@/lib/opportunity-actions";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { BLOCKED_UNTIL, type Blocked } from "@/lib/billing-plans";
import { useLocale, useT } from "@/components/I18nProvider";
import { intlLocale } from "@/lib/i18n/core";
import { FeeFields } from "@/components/FeeFields";
import type { FeeLevelOpt } from "@/lib/fees";

type CType = { id: string; label: string; category: string; unit: string; fmv: readonly number[] };

type EventOpt = { id: string; label: string; title: string; typeId: string; area: string | null };

/** Opportunité : pour une collaboration, ou pour intervenir à l'un des événements de l'organisation. */
export function NewCallForm({ orgId, types, ai = false, events = [], defaultEventId, blocked = null }: { orgId: string; types: readonly CType[]; ai?: boolean; events?: EventOpt[]; defaultEventId?: string; blocked?: Blocked }) {
  const t = useT();
  const locale = useLocale();
  const [state, action, pending] = useActionState(createOpenCall, undefined);
  const [eventId, setEventId] = useState(defaultEventId ?? "");
  const ev = events.find((e) => e.id === eventId);
  const [typeId, setTypeId] = useState(ev && types.some((tk) => tk.id === ev.typeId) ? ev.typeId : types[0].id);
  const type = types.find((tk) => tk.id === typeId)!;
  const categories = [...new Set(types.map((t) => t.category))];
  const pickEvent = (id: string) => {
    setEventId(id);
    const e = events.find((x) => x.id === id);
    if (e && types.some((t) => t.id === e.typeId)) setTypeId(e.typeId);
  };
  return (
    <ActionForm action={action} className="card form">
      <SectionHead icon={Megaphone} title={t("Nouvelle opportunité")} desc={t("Visible de tous les experts référencés, qui peuvent y candidater. Rattachez-la à un événement si la personne retenue doit y intervenir.")} />
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>{t("Événement concerné")}
        <select name="eventId" value={eventId} onChange={(e) => pickEvent(e.target.value)}>
          <option value="">{t("— aucun : collaboration hors événement (board, étude, rédaction…) —")}</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </label>
      <label>{t("Titre")}<input key={`t-${eventId}`} name="title" required defaultValue={ev ? `Intervenants : ${ev.title}` : ""} placeholder={t("Ex. : Formateur pour deux sessions de travaux pratiques CFAO")} /></label>
      <div className="row">
        <label>{t("Type")}
          <select name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {categories.map((c) => (
              <optgroup key={c} label={t(c)}>{types.filter((ty) => ty.category === c).map((ty) => <option key={ty.id} value={ty.id}>{t(ty.label)}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label>{t("Spécialité recherchée")}<input key={`s-${eventId}`} name="specialty" defaultValue={ev?.area ?? ""} placeholder={t("Parodontologie…")} /></label>
      </div>
      <label>{t("Description")}<textarea name="description" rows={ai ? 6 : 4} placeholder={ev ? t("Thème et format de l'intervention, profil recherché, durée de prise de parole…") : t("Contexte, profil recherché, dates, livrables…")} /></label>
      {ai && <AiDraft kind="appel" target="description" label={t("Rédiger la description avec l'IA")} />}
      <div className="row">
        <label>{t("Places")}<input name="slots" type="number" min={1} max={50} defaultValue={ev ? 1 : undefined} placeholder={t("Sans limite")} /></label>
        <label>{t("Budget min (€ HT)")}<input name="budgetMin" inputMode="decimal" /></label>
        <label>{t("Budget max (€ HT)")}<input name="budgetMax" inputMode="decimal" /></label>
        <label>{t("Date limite")}<input name="deadline" type="date" /></label>
      </div>
      <p className="hint">{t("Repère : {toLocaleString} à {toLocaleString2} € HT par {unit}.", { toLocaleString: type.fmv[0].toLocaleString(intlLocale(locale)), toLocaleString2: type.fmv[1].toLocaleString(intlLocale(locale)), unit: t(type.unit) })}</p>
      <button className="btn" disabled={pending || !!blocked}>{pending ? t("Publication…") : t("Publier l'opportunité")}</button>
      {blocked && <p className="hint">{t("Publication possible {blocked} (voir le bandeau en haut de la page).", { blocked: t(BLOCKED_UNTIL[blocked]) })}</p>}
    </ActionForm>
  );
}

export function ApplyForm({ callId }: { callId: string }) {
  const [state, action, pending] = useActionState(applyToCall, undefined);
  const t = useT();
  if (state?.ok) return <p className="notice ok">{state.ok} {t("L'organisation reviendra vers vous via « Sollicitations » si elle vous retient.")}</p>;
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="callId" value={callId} />
      <label>{t("Votre candidature")}<textarea name="message" rows={5} required minLength={20} placeholder={t("Pourquoi vous, expérience pertinente, disponibilités, conditions…")} /></label>
      <p className="hint">{t("L'organisation verra ce message et votre fiche d'expert.")}</p>
      <button className="btn" disabled={pending}>{pending ? t("Envoi…") : t("Candidater")}</button>
    </form>
  );
}

export function RetainForm({ orgId, applicationId, unit, defaultFee, levels = [], hourlyMax = 200 }: { orgId: string; applicationId: string; unit: string; defaultFee: string; levels?: FeeLevelOpt[]; hourlyMax?: number }) {
  const t = useT();
  const [state, action, pending] = useActionState(retainApplication, undefined);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>{t("Retenir…")}</button>;
  return (
    <form action={action} className="form retain-form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <FeeFields unit={unit} levels={levels} hourlyMax={hourlyMax} defaults={{ fee: defaultFee }} />
      <div className="actions">
        <button className="btn" disabled={pending}>{pending ? "…" : t("Proposer ces honoraires")}</button>
        <button type="button" className="link" onClick={() => setOpen(false)}>{t("Annuler")}</button>
      </div>
    </form>
  );
}
