"use client";

import { AiDraft } from "@/components/AiDraft";
import { useActionState, useState } from "react";
import { applyToCall, createOpenCall, retainApplication } from "@/lib/opportunity-actions";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useT } from "@/components/I18nProvider";

type CType = { id: string; label: string; category: string; unit: string; fmv: readonly number[] };

type EventOpt = { id: string; label: string; title: string; typeId: string; area: string | null };

/** Appel à candidatures : pour une collaboration, ou pour intervenir à l'un des événements de l'organisation. */
export function NewCallForm({ orgId, types, ai = false, events = [], defaultEventId, blocked = false }: { orgId: string; types: readonly CType[]; ai?: boolean; events?: EventOpt[]; defaultEventId?: string; blocked?: boolean }) {
  const [state, action, pending] = useActionState(createOpenCall, undefined);
  const [eventId, setEventId] = useState(defaultEventId ?? "");
  const ev = events.find((e) => e.id === eventId);
  const [typeId, setTypeId] = useState(ev && types.some((t) => t.id === ev.typeId) ? ev.typeId : types[0].id);
  const type = types.find((t) => t.id === typeId)!;
  const categories = [...new Set(types.map((t) => t.category))];
  const pickEvent = (id: string) => {
    setEventId(id);
    const e = events.find((x) => x.id === id);
    if (e && types.some((t) => t.id === e.typeId)) setTypeId(e.typeId);
  };
  return (
    <ActionForm action={action} className="card form">
      <h2>Nouvel appel à candidatures</h2>
      <p className="muted">Visible de tous les experts référencés, qui peuvent y candidater. Rattachez-le à un événement si la personne retenue doit y intervenir.</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>Événement concerné
        <select name="eventId" value={eventId} onChange={(e) => pickEvent(e.target.value)}>
          <option value="">— aucun : collaboration hors événement (board, étude, rédaction…) —</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </label>
      <label>Titre<input key={`t-${eventId}`} name="title" required defaultValue={ev ? `Intervenants : ${ev.title}` : ""} placeholder="Ex. : Formateur pour deux sessions de travaux pratiques CFAO" /></label>
      <div className="row">
        <label>Type
          <select name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {categories.map((c) => (
              <optgroup key={c} label={c}>{types.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label>Spécialité recherchée<input key={`s-${eventId}`} name="specialty" defaultValue={ev?.area ?? ""} placeholder="Parodontologie…" /></label>
      </div>
      <label>Description<textarea name="description" rows={ai ? 6 : 4} placeholder={ev ? "Thème et format de l'intervention, profil recherché, durée de prise de parole…" : "Contexte, profil recherché, dates, livrables…"} /></label>
      {ai && <AiDraft kind="appel" target="description" label="Rédiger l'appel avec l'IA" />}
      <div className="row">
        <label>Places<input name="slots" type="number" min={1} max={50} defaultValue={ev ? 1 : undefined} placeholder="Sans limite" /></label>
        <label>Budget min (€ HT)<input name="budgetMin" inputMode="decimal" /></label>
        <label>Budget max (€ HT)<input name="budgetMax" inputMode="decimal" /></label>
        <label>Date limite<input name="deadline" type="date" /></label>
      </div>
      <p className="hint">Repère : {type.fmv[0].toLocaleString("fr-FR")} à {type.fmv[1].toLocaleString("fr-FR")} € HT par {type.unit}.</p>
      <button className="btn" disabled={pending || blocked}>{pending ? "Publication…" : "Publier l'appel"}</button>
      {blocked && <p className="hint">Publication possible une fois l&apos;abonnement activé (voir le bandeau en haut de la page).</p>}
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

export function RetainForm({ orgId, applicationId, unit, defaultFee }: { orgId: string; applicationId: string; unit: string; defaultFee: string }) {
  const [state, action, pending] = useActionState(retainApplication, undefined);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>Retenir…</button>;
  return (
    <form action={action} className="inline wrap">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <input name="units" defaultValue="1" aria-label={`Nombre (${unit})`} title={`Nombre (${unit})`} />
      <input name="fee" defaultValue={defaultFee} placeholder="Honoraires € HT" aria-label="Honoraires" required />
      <button className="btn" disabled={pending}>{pending ? "…" : "Proposer ces honoraires"}</button>
    </form>
  );
}
