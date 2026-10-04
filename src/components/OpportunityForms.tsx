"use client";

import { useActionState, useState } from "react";
import { applyToCall, createOpenCall, retainApplication } from "@/lib/opportunity-actions";
import { Notice } from "@/components/AuthForms";

type CType = { id: string; label: string; category: string; unit: string; fmv: readonly number[] };

export function NewCallForm({ orgId, types }: { orgId: string; types: readonly CType[] }) {
  const [state, action, pending] = useActionState(createOpenCall, undefined);
  const [typeId, setTypeId] = useState(types[0].id);
  const type = types.find((t) => t.id === typeId)!;
  const categories = [...new Set(types.map((t) => t.category))];
  return (
    <form action={action} className="card form">
      <h2>Publier une opportunité</h2>
      <p className="muted">Un appel ouvert visible par tous les experts référencés, qui peuvent y candidater.</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>Titre<input name="title" required placeholder="Ex. : Conférencier pour une soirée parodontologie à Bordeaux" /></label>
      <div className="row">
        <label>Type
          <select name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {categories.map((c) => (
              <optgroup key={c} label={c}>{types.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label>Spécialité recherchée<input name="specialty" placeholder="Parodontologie…" /></label>
      </div>
      <label>Description<textarea name="description" rows={4} placeholder="Contexte, profil recherché, dates, livrables…" /></label>
      <div className="row">
        <label>Budget min (€ HT)<input name="budgetMin" inputMode="decimal" /></label>
        <label>Budget max (€ HT)<input name="budgetMax" inputMode="decimal" /></label>
        <label>Date limite<input name="deadline" type="date" /></label>
      </div>
      <p className="hint">Référence : {type.fmv[0].toLocaleString("fr-FR")} à {type.fmv[1].toLocaleString("fr-FR")} € HT par {type.unit}.</p>
      <button className="btn" disabled={pending}>{pending ? "Publication…" : "Publier l'opportunité"}</button>
    </form>
  );
}

export function ApplyForm({ callId }: { callId: string }) {
  const [state, action, pending] = useActionState(applyToCall, undefined);
  if (state?.ok) return <p className="notice ok">{state.ok} L&apos;organisation reviendra vers vous via « Sollicitations » si elle vous retient.</p>;
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="callId" value={callId} />
      <label>Votre candidature<textarea name="message" rows={5} required minLength={20} placeholder="Pourquoi vous, expérience pertinente, disponibilités, conditions…" /></label>
      <p className="hint">L&apos;organisation verra ce message et votre fiche d&apos;expert.</p>
      <button className="btn" disabled={pending}>{pending ? "Envoi…" : "Candidater"}</button>
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
      <button className="btn" disabled={pending}>{pending ? "…" : "Ouvrir le dossier"}</button>
    </form>
  );
}
