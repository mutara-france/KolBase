"use client";

import { useActionState, useState } from "react";
import { createEvent, registerToEvent, saveEventProgram } from "@/lib/event-actions";
import { AiDraft } from "@/components/AiDraft";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useLocale, useT } from "@/components/I18nProvider";
import { intlLocale, type Locale } from "@/lib/i18n";

type Opt = { value: string; label: string };
type CatalogItem = { id: string; label: string; typical: number };

export function NewEventForm({ orgId, types, formats, catalog, project }: { orgId: string; types: Opt[]; formats: Opt[]; catalog: readonly CatalogItem[]; project?: { id: string; title: string; area: string | null } }) {
  const [state, action, pending] = useActionState(createEvent, undefined);
  const [format, setFormat] = useState("PRESENTIEL");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  // Créé depuis un dossier (board, comité) : réunion interne par défaut.
  const [internal, setInternal] = useState(!!project);
  return (
    <ActionForm action={action} className="card form">
      <h1>Nouvel événement</h1>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      {project && <input type="hidden" name="projectId" value={project.id} />}
      {project && <p className="notice ok">Événement rattaché au dossier « {project.title} » : sa logistique (salle, traiteur, hébergement…) se pilote depuis la fiche de l&apos;événement.</p>}
      <label>Titre<input name="title" required defaultValue={project?.title} /></label>
      <div className="row">
        <label>Type<select name="typeId">{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        <label>Domaine thérapeutique<input name="therapeuticArea" placeholder="Implantologie…" defaultValue={project?.area ?? undefined} /></label>
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
      <label className="check">
        <input type="checkbox" name="internal" value="1" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Réunion interne (board, comité, réunion d&apos;experts) : ni publication dans l&apos;agenda, ni inscriptions en ligne
      </label>
      {!internal && <label className="check"><input type="checkbox" name="publish" value="1" /> Publier immédiatement dans l&apos;agenda</label>}
      <button className="btn" disabled={pending}>{pending ? "Création…" : "Créer l'événement"}</button>
    </ActionForm>
  );
}

type Benefit = { id: string; label: string; valueCents: number };
const eur = (c: number, locale: Locale) => (c / 100).toLocaleString(intlLocale(locale), { style: "currency", currency: "EUR" });

export function RegisterForm({ eventId, benefits, hcp, defaultStructure }: { eventId: string; benefits: Benefit[]; hcp: boolean; defaultStructure: string }) {
  const [state, action, pending] = useActionState(registerToEvent, undefined);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const t = useT();
  const locale = useLocale();
  const total = benefits.filter((b) => accepted[b.id]).reduce((s, b) => s + b.valueCents, 0);
  if (state?.ok) return <p className="notice ok">{state.ok} {t("Retrouvez-la dans « Mes inscriptions ».")}</p>;
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="eventId" value={eventId} />
      <label>{t("Structure d'exercice")}<input name="structure" defaultValue={defaultStructure} placeholder={t("Cabinet, hôpital…")} /></label>
      {benefits.length > 0 && (
        <fieldset>
          <legend>{t("Prestations proposées")}</legend>
          <p className="hint">{t("Cochez uniquement ce que vous acceptez. Vous pouvez participer sans rien accepter.")}</p>
          {benefits.map((b) => (
            <label key={b.id} className="check">
              <input type="checkbox" name={`accept_${b.id}`} checked={!!accepted[b.id]} onChange={(e) => setAccepted({ ...accepted, [b.id]: e.target.checked })} />
              {b.label} — {eur(b.valueCents, locale)}
            </label>
          ))}
          {total > 0 && <p className="muted">{t("Valeur totale acceptée :")} <strong>{eur(total, locale)}</strong></p>}
        </fieldset>
      )}
      {hcp && total > 0 && (
        <div className="notice warn">
          <strong>{t("Information réglementaire.")}</strong>{" "}
          {t("En tant que professionnel de santé, les prestations acceptées constituent un avantage au sens du Code de la santé publique. Elles feront l'objet d'une convention d'hospitalité et seront publiées à votre nom sur la base Transparence Santé.")}
          <label className="check"><input type="checkbox" name="ackHcp" required /> {t("J'ai compris et j'accepte.")}</label>
        </div>
      )}
      <button className="btn" disabled={pending}>{pending ? t("Inscription…") : t("M'inscrire")}</button>
    </form>
  );
}

/** Programme de l'événement, avec l'assistant de rédaction si activé. */
export function ProgramForm({ orgId, eventId, program, ai }: { orgId: string; eventId: string; program: string; ai: boolean }) {
  const [state, action, pending] = useActionState(saveEventProgram, undefined);
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="eventId" value={eventId} />
      <label>Déroulé
        <textarea name="program" rows={program ? Math.min(16, program.split("\n").length + 2) : 6} defaultValue={program} placeholder={"18:30 – 18:45  Accueil des participants\n18:45 – 19:30  Session 1 — intervenant\n…"} />
      </label>
      <div className="actions">
        {ai && <AiDraft kind="programme" target="program" label="Proposer un programme avec l'IA" />}
        <button className="btn small" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer le programme"}</button>
      </div>
    </form>
  );
}
