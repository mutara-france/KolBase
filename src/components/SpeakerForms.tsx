"use client";

import { useActionState, useState } from "react";
import { Megaphone, Plus, Send } from "lucide-react";
import { applyAsSpeaker, openSpeakerCall, retainSpeaker } from "@/lib/speaker-actions";
import { Notice } from "@/components/AuthForms";

type EventOpt = { id: string; label: string; slots: number | null; deadline: string; min: string; max: string; profile: string };

/** Ouvre un appel sur un événement à venir (ou met à jour ses paramètres). */
export function OpenSpeakerCallForm({ orgId, events, startOpen = false }: { orgId: string; events: EventOpt[]; startOpen?: boolean }) {
  const [state, action, pending] = useActionState(openSpeakerCall, undefined);
  const [open, setOpen] = useState(startOpen);
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const ev = events.find((e) => e.id === eventId);
  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Plus size={14} /> Nouvel appel
      </button>
    );
  if (events.length === 0) return <p className="notice warn">Créez d&apos;abord un événement à venir : l&apos;appel à intervenants s&apos;y rattache.</p>;
  return (
    <form action={action} className="card form" key={eventId}>
      <h2>Appel à intervenants</h2>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>Événement
        <select name="eventId" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {events.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </label>
      <div className="row">
        <label>Places d&apos;intervenant<input name="slots" type="number" min={1} max={50} defaultValue={ev?.slots ?? 1} required /></label>
        <label>Clôture des candidatures<input name="deadline" type="date" defaultValue={ev?.deadline} /></label>
      </div>
      <div className="row">
        <label>Honoraires min. (€ HT)<input name="budgetMin" inputMode="decimal" defaultValue={ev?.min} /></label>
        <label>Honoraires max. (€ HT)<input name="budgetMax" inputMode="decimal" defaultValue={ev?.max} /></label>
      </div>
      <label>Profil recherché<textarea name="profile" rows={3} defaultValue={ev?.profile} placeholder="Spécialité, expérience attendue, thème de la session…" /></label>
      <div className="actions">
        <button className="btn" disabled={pending}><Megaphone size={14} /> {pending ? "Publication…" : "Publier l'appel"}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </form>
  );
}

export function SpeakerApplyForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(applyAsSpeaker, undefined);
  const [open, setOpen] = useState(false);
  if (state?.ok) return <p className="notice ok">{state.ok} L&apos;organisateur vous recontactera s&apos;il vous retient.</p>;
  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Megaphone size={14} /> Proposer ma candidature
      </button>
    );
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="eventId" value={eventId} />
      <textarea name="message" rows={3} required minLength={20} placeholder="Ce que vous proposez de présenter, en quelques lignes…" aria-label="Votre proposition" />
      <div className="actions">
        <button className="btn" disabled={pending}><Send size={13} /> {pending ? "Envoi…" : "Envoyer"}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </form>
  );
}

export function RetainSpeakerForm({ orgId, applicationId, defaultFee }: { orgId: string; applicationId: string; defaultFee: string }) {
  const [state, action, pending] = useActionState(retainSpeaker, undefined);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn small" onClick={() => setOpen(true)}>Retenir…</button>;
  return (
    <form action={action} className="inline wrap">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <input name="fee" defaultValue={defaultFee} placeholder="Honoraires € HT" aria-label="Honoraires" required />
      <button className="btn" disabled={pending}>{pending ? "…" : "Retenir et ouvrir le dossier"}</button>
    </form>
  );
}
