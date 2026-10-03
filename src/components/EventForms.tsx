"use client";

import { useActionState, useState } from "react";
import { createEvent, registerToEvent } from "@/lib/event-actions";
import { Notice } from "@/components/AuthForms";

type Opt = { value: string; label: string };
type CatalogItem = { id: string; label: string; typical: number };

export function NewEventForm({ orgId, types, formats, catalog }: { orgId: string; types: Opt[]; formats: Opt[]; catalog: readonly CatalogItem[] }) {
  const [state, action, pending] = useActionState(createEvent, undefined);
  const [format, setFormat] = useState("PRESENTIEL");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  return (
    <form action={action} className="card form">
      <h1>Nouvel événement</h1>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>Titre<input name="title" required /></label>
      <div className="row">
        <label>Type<select name="typeId">{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        <label>Domaine thérapeutique<input name="therapeuticArea" placeholder="Implantologie…" /></label>
      </div>
      <label>Description<textarea name="description" rows={4} /></label>
      <div className="row">
        <label>Date et heure (Paris)<input name="startsAt" type="datetime-local" required /></label>
        <label>Durée (minutes)<input name="durationMinutes" type="number" min={0} step={15} /></label>
      </div>
      <div className="row">
        <label>Format
          <select name="format" value={format} onChange={(e) => setFormat(e.target.value)}>
            {formats.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <label>Places<input name="capacity" type="number" min={1} placeholder="Illimité" /></label>
      </div>
      {format !== "DISTANCIEL" && (
        <div className="row">
          <label>Ville<input name="city" /></label>
          <label>Lieu<input name="venue" placeholder="Hôtel, salle…" /></label>
        </div>
      )}
      <fieldset>
        <legend>Hospitalités proposées aux participants</legend>
        <p className="hint">Chaque prestation acceptée par un professionnel de santé constitue un avantage à conventionner et déclarer. Indiquez sa valeur réelle par personne (€ TTC).</p>
        <div className="benefits">
          {catalog.map((b) => (
            <div key={b.id} className="benefit-row">
              <label className="check">
                <input type="checkbox" name={`benefit_${b.id}`} checked={!!picked[b.id]} onChange={(e) => setPicked({ ...picked, [b.id]: e.target.checked })} /> {b.label}
              </label>
              <input name={`value_${b.id}`} inputMode="decimal" defaultValue={b.typical} disabled={!picked[b.id]} aria-label={`Valeur ${b.label}`} />
              <span className="hint">€</span>
            </div>
          ))}
        </div>
      </fieldset>
      <label className="check"><input type="checkbox" name="publish" value="1" /> Publier immédiatement dans l&apos;agenda</label>
      <button className="btn" disabled={pending}>{pending ? "Création…" : "Créer l'événement"}</button>
    </form>
  );
}

type Benefit = { id: string; label: string; valueCents: number };
const eur = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

export function RegisterForm({ eventId, benefits, hcp, defaultStructure }: { eventId: string; benefits: Benefit[]; hcp: boolean; defaultStructure: string }) {
  const [state, action, pending] = useActionState(registerToEvent, undefined);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const total = benefits.filter((b) => accepted[b.id]).reduce((s, b) => s + b.valueCents, 0);
  if (state?.ok) return <p className="notice ok">{state.ok} Retrouvez-la dans « Mes inscriptions ».</p>;
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="eventId" value={eventId} />
      <label>Structure d&apos;exercice<input name="structure" defaultValue={defaultStructure} placeholder="Cabinet, hôpital…" /></label>
      {benefits.length > 0 && (
        <fieldset>
          <legend>Prestations proposées</legend>
          <p className="hint">Cochez uniquement ce que vous acceptez. Vous pouvez participer sans rien accepter.</p>
          {benefits.map((b) => (
            <label key={b.id} className="check">
              <input type="checkbox" name={`accept_${b.id}`} checked={!!accepted[b.id]} onChange={(e) => setAccepted({ ...accepted, [b.id]: e.target.checked })} />
              {b.label} — {eur(b.valueCents)}
            </label>
          ))}
          {total > 0 && <p className="muted">Valeur totale acceptée : <strong>{eur(total)}</strong></p>}
        </fieldset>
      )}
      {hcp && total > 0 && (
        <div className="notice warn">
          <strong>Information réglementaire.</strong> En tant que professionnel de santé, les prestations acceptées constituent un avantage
          au sens du Code de la santé publique. Elles feront l&apos;objet d&apos;une convention d&apos;hospitalité et seront publiées à votre nom
          sur la base Transparence Santé.
          <label className="check"><input type="checkbox" name="ackHcp" required /> J&apos;ai compris et j&apos;accepte.</label>
        </div>
      )}
      <button className="btn" disabled={pending}>{pending ? "Inscription…" : "M'inscrire"}</button>
    </form>
  );
}
