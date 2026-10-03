"use client";

import { useActionState, useMemo, useState } from "react";
import { createProject, postMessage, respondToSolicitation } from "@/lib/project-actions";
import { Notice } from "@/components/AuthForms";

type CType = { id: string; label: string; category: string; unit: string; fmv: readonly number[] };
type Expert = { id: string; name: string; detail: string; dayRateCents: number | null };

export function NewProjectForm({ orgId, types, experts, preselected }: { orgId: string; types: readonly CType[]; experts: Expert[]; preselected: string[] }) {
  const [state, action, pending] = useActionState(createProject, undefined);
  const [typeId, setTypeId] = useState(types[0].id);
  const [selected, setSelected] = useState<string[]>(preselected);
  const [filter, setFilter] = useState("");
  const type = types.find((t) => t.id === typeId)!;
  const visible = useMemo(
    () => experts.filter((e) => !filter || `${e.name} ${e.detail}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 30),
    [experts, filter],
  );
  const categories = [...new Set(types.map((t) => t.category))];

  return (
    <form action={action} className="card form">
      <h1>Nouveau dossier</h1>
      <p className="muted">Sollicitez un ou plusieurs experts. Chacun reçoit la proposition dans son espace et y répond.</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>Titre du dossier<input name="title" required placeholder="Ex. : Board implantologie — printemps" /></label>
      <div className="row">
        <label>Type de collaboration
          <select name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {categories.map((c) => (
              <optgroup key={c} label={c}>{types.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label>Domaine thérapeutique<input name="therapeuticArea" /></label>
      </div>
      <p className="hint">Juste contrepartie de référence : {type.fmv[0].toLocaleString("fr-FR")} à {type.fmv[1].toLocaleString("fr-FR")} € HT par {type.unit}.</p>
      <label>Objet et déroulé<textarea name="description" rows={4} placeholder="Contexte, livrables attendus, dates…" /></label>

      <fieldset>
        <legend>Experts sollicités</legend>
        <input className="filter" placeholder="Filtrer par nom, spécialité, ville…" value={filter} onChange={(e) => setFilter(e.target.value)} />
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
          {visible.length === 0 && <p className="muted">Aucun expert référencé ne correspond.</p>}
        </div>
      </fieldset>

      {selected.length > 0 && (
        <fieldset>
          <legend>Conditions proposées</legend>
          {selected.map((id) => {
            const e = experts.find((x) => x.id === id);
            if (!e) return null;
            return (
              <div key={id} className="fee-row">
                <input type="hidden" name="expertId" value={id} />
                <strong>{e.name}</strong>
                <label>Unités ({type.unit})<input name={`units_${id}`} inputMode="decimal" defaultValue="1" /></label>
                <label>Honoraires totaux (€ HT)<input name={`fee_${id}`} inputMode="decimal" defaultValue={e.dayRateCents != null ? String(e.dayRateCents / 100) : ""} required /></label>
              </div>
            );
          })}
        </fieldset>
      )}
      <label>Message d&apos;accompagnement<textarea name="message" rows={3} placeholder="Message envoyé à chaque expert sollicité" /></label>
      <button className="btn" disabled={pending}>{pending ? "Envoi…" : "Envoyer les sollicitations"}</button>
    </form>
  );
}

export function MessageForm({ linkId }: { linkId: string }) {
  const [state, action, pending] = useActionState(postMessage, undefined);
  return (
    <form action={action} className="form" key={state?.ok ? Date.now() : "msg"}>
      {state?.error && <Notice state={state} />}
      <textarea name="body" rows={3} placeholder="Votre message…" required />
      <input type="hidden" name="linkId" value={linkId} />
      <button className="btn ghost" disabled={pending}>{pending ? "Envoi…" : "Envoyer"}</button>
    </form>
  );
}

export function RespondForm({ linkId }: { linkId: string }) {
  const [state, action, pending] = useActionState(respondToSolicitation, undefined);
  if (state?.ok) return <p className="notice ok">{state.ok}</p>;
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="linkId" value={linkId} />
      <label>Commentaire (facultatif)<textarea name="note" rows={2} placeholder="Disponibilités, conditions, questions…" /></label>
      <div className="actions">
        <button className="btn" name="answer" value="accept" disabled={pending}>Donner mon accord de principe</button>
        <button className="btn ghost" name="answer" value="decline" disabled={pending}>Décliner</button>
      </div>
      <p className="hint">L&apos;accord de principe n&apos;engage pas encore : la convention vous sera soumise après validation par la conformité.</p>
    </form>
  );
}
