"use client";

import { useActionState, useState } from "react";
import { createEvent, registerToEvent, saveEventProgram, updateEvent } from "@/lib/event-actions";
import { AiDraft } from "@/components/AiDraft";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { BLOCKED_UNTIL, type Blocked } from "@/lib/billing-plans";
import { useLocale, useT } from "@/components/I18nProvider";
import { intlLocale, type Locale } from "@/lib/i18n/core";
import { benefitLimit, hospitalityRegime, regimeReason, type HospitalityLimits } from "@/lib/compliance";
import { eurToCents } from "@/lib/form";
import { parseParisDateTime } from "@/lib/events";
import { EVENT_NOT_PUBLISHABLE } from "@/lib/projects";

type Opt = { value: string; label: string };
type CatalogItem = { id: string; label: string; typical: number };
/** Valeurs d'un événement existant (formulaire de modification). */
export type EventInitial = {
  title: string; typeId: string; therapeuticArea: string; description: string; startsAt: string; durationMinutes: string;
  format: string; capacity: string; city: string; venue: string; onlineUrl: string; benefits: { catalogId: string; valueCents: number }[];
};

type Frozen = { catalogId: string; label: string; valueCents: number }[];
const euros = (locale: Locale, c: number) => (c / 100).toLocaleString(intlLocale(locale), { style: "currency", currency: "EUR" });

/**
 * Régime des hospitalités saisies, en direct : chaque prestation au-delà de son seuil et la convention d'un
 * participant qui accepterait tout (déclaration ou autorisation), avec les seuils de l'organisation.
 */
function HospitalityAlert({ limits, benefits, startsAt }: { limits: HospitalityLimits; benefits: { catalogId: string; valueCents: number }[]; startsAt?: string }) {
  const t = useT();
  const locale = useLocale();
  if (benefits.length === 0) return null;
  const r = hospitalityRegime(limits, benefits);
  // Date saisie (heure de Paris) déjà dans le délai d'autorisation : la demande ne pourrait plus aboutir à temps.
  const start = startsAt ? parseParisDateTime(startsAt) : null;
  const late = !!start && start.getTime() - Date.now() < limits.authorizationDays * 864e5;
  return r.regime === "autorisation" ? (
    <p className={`notice ${late ? "error" : "warn"}`} role="status">
      {t("Au-delà des seuils ({reason}) : la convention d'hospitalité d'un participant qui accepte ces prestations est soumise à autorisation de l'Ordre, à demander au moins {authorizationDays} jours avant l'événement.", { reason: regimeReason(r, t, intlLocale(locale)), authorizationDays: limits.authorizationDays })}
      {late && <> <strong>{t("Délai d'autorisation déjà dépassé pour cette date")}</strong>{" "}{t(": l'autorisation ne pourra pas être obtenue à temps. Ramenez les valeurs sous les seuils, ou décalez l'événement.")}</>}
    </p>
  ) : (
    <p className="hint" role="status">{t("Sous les seuils d'autorisation de votre organisation : convention d'hospitalité déclarée à l'Ordre ({declarationDays} jours ouvrables avant l'événement).", { declarationDays: limits.declarationDays })}</p>
  );
}

/** Champs communs à la création et à la modification d'un événement. */
function EventFields({ types, formats, catalog, initial, frozen, project, limits }: { types: Opt[]; formats: Opt[]; catalog: readonly CatalogItem[]; initial?: EventInitial; frozen?: Frozen; project?: { title: string; area: string | null }; limits?: HospitalityLimits }) {
  const t = useT();
  const locale = useLocale();
  const [format, setFormat] = useState(initial?.format ?? "PRESENTIEL");
  // Date suivie pour l'alerte de délai d'autorisation (le champ reste non contrôlé).
  const [start, setStart] = useState(initial?.startsAt ?? "");
  const [picked, setPicked] = useState<Record<string, boolean>>(Object.fromEntries((initial?.benefits ?? []).map((b) => [b.catalogId, true])));
  const value = (id: string, typical: number) => {
    const b = initial?.benefits.find((x) => x.catalogId === id);
    return b ? String(b.valueCents / 100).replace(".", ",") : String(typical);
  };
  // Valeurs saisies, suivies pour l'alerte de seuil (les champs restent non contrôlés).
  const [typed, setTyped] = useState<Record<string, string>>({});
  const chosen = catalog.filter((b) => picked[b.id]).map((b) => ({ catalogId: b.id, valueCents: eurToCents(typed[b.id] ?? value(b.id, b.typical)) })).filter((b): b is { catalogId: string; valueCents: number } => b.valueCents != null);
  const over = (id: string) => {
    const l = limits ? benefitLimit(limits, id) : null;
    const v = chosen.find((b) => b.catalogId === id)?.valueCents;
    return l && v != null && v / 100 > l.max ? l : null;
  };
  return (
    <>
      <label>{t("Titre")}<input name="title" required defaultValue={initial?.title ?? project?.title} /></label>
      <div className="row">
        <label>{t("Type")}<select name="typeId" defaultValue={initial?.typeId}>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        <label>{t("Domaine thérapeutique")}<input name="therapeuticArea" placeholder={t("Implantologie…")} defaultValue={initial?.therapeuticArea ?? project?.area ?? undefined} /></label>
      </div>
      <label>{t("Description")}<textarea name="description" rows={4} defaultValue={initial?.description} /></label>
      <div className="row">
        <label>{t("Date et heure (Paris)")}<input name="startsAt" type="datetime-local" required defaultValue={initial?.startsAt} onChange={(e) => setStart(e.target.value)} /></label>
        <label>{t("Durée (minutes)")}<input name="durationMinutes" type="number" min={0} step={15} defaultValue={initial?.durationMinutes} /></label>
      </div>
      <div className="row">
        <label>{t("Format")}
          <select name="format" value={format} onChange={(e) => setFormat(e.target.value)}>
            {formats.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <label>{t("Places")}<input name="capacity" type="number" min={1} placeholder={t("Illimité")} defaultValue={initial?.capacity} /></label>
      </div>
      {format !== "DISTANCIEL" && (
        <div className="row">
          <label>{t("Ville")}<input name="city" defaultValue={initial?.city} /></label>
          <label>{t("Lieu")}<input name="venue" placeholder={t("Hôtel, salle…")} defaultValue={initial?.venue} /></label>
        </div>
      )}
      {format !== "PRESENTIEL" && (
        <label>{t("Lien de connexion")}<input name="onlineUrl" type="url" inputMode="url" placeholder="https://…" defaultValue={initial?.onlineUrl} />
          <span className="hint">{t("Visioconférence (Zoom, Teams, Meet…), adresse en https. Communiqué aux seuls inscrits : sur leur page d'inscription, dans le rappel de la veille et dans leur agenda. Vous pourrez l'ajouter plus tard.")}</span>
        </label>
      )}
      <fieldset>
        <legend>{t("Hospitalités proposées aux participants")}</legend>
        {frozen ? (
          <>
            {frozen.length === 0 ? <p className="muted">{t("Aucune.")}</p> : <ul className="plain stack-sm">{frozen.map((b) => <li key={b.label} className="flex-between"><span>{t(b.label)}</span><span className="muted">{t("{montant} TTC par personne", { montant: euros(locale, b.valueCents) })}</span></li>)}</ul>}
            {limits && <HospitalityAlert limits={limits} benefits={frozen} startsAt={start} />}
            <p className="hint">{t("Hospitalités figées : des inscrits les ont déjà acceptées, leur valeur est rattachée à leur nom. Pour reporter le coût réel d'un devis retenu, utilisez la rubrique Logistique.")}</p>
          </>
        ) : (
          <>
            <p className="hint">{t("Chaque prestation acceptée par un professionnel de santé constitue un avantage à conventionner et déclarer. Indiquez sa valeur réelle par personne (€ TTC).")}</p>
            <div className="benefits">
              {catalog.map((b) => {
                const l = over(b.id);
                return (
                  <div key={b.id} className="benefit-row">
                    <label className="check">
                      <input type="checkbox" name={`benefit_${b.id}`} checked={!!picked[b.id]} onChange={(e) => setPicked({ ...picked, [b.id]: e.target.checked })} /> {t(b.label)}
                    </label>
                    <input name={`value_${b.id}`} inputMode="decimal" defaultValue={value(b.id, b.typical)} onChange={(e) => setTyped({ ...typed, [b.id]: e.target.value })} disabled={!picked[b.id]} aria-label={t("Valeur {label}", { label: t(b.label) })} aria-invalid={l ? true : undefined} />
                    <span className="hint">€</span>
                    {l && <span className="text-sm warn-text benefit-over">{t("Au-delà de {max} € TTC {per} : autorisation", { max: l.max, per: t(l.per) })}</span>}
                  </div>
                );
              })}
            </div>
            {limits && <HospitalityAlert limits={limits} benefits={chosen} startsAt={start} />}
          </>
        )}
      </fieldset>
    </>
  );
}

export function NewEventForm({ orgId, types, formats, catalog, project, blocked = null, limits }: { orgId: string; types: Opt[]; formats: Opt[]; catalog: readonly CatalogItem[]; project?: { id: string; title: string; area: string | null; publishable?: boolean }; blocked?: Blocked; limits?: HospitalityLimits }) {
  const t = useT();
  const [state, action, pending] = useActionState(createEvent, undefined);
  // Créé depuis un dossier (board, comité) : réunion interne par défaut.
  const [internal, setInternal] = useState(!!project);
  return (
    <ActionForm action={action} className="card form">
      <h1>{t("Nouvel événement")}</h1>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      {project && <input type="hidden" name="projectId" value={project.id} />}
      {project && <p className="notice ok">{t("Événement rattaché au dossier « {title} » : il se gère depuis l'onglet « Événement » du dossier (logistique, devis, agence, inscriptions).", { title: project.title })}</p>}
      <EventFields types={types} formats={formats} catalog={catalog} project={project} limits={limits} />
      <label className="check">
        <input type="checkbox" name="internal" value="1" checked={internal} onChange={(e) => setInternal(e.target.checked)} />{" "}{t("Réunion interne (board, comité, réunion d'experts) : ni publication dans l'agenda, ni inscriptions en ligne")}
      </label>
      {!internal && project && project.publishable === false && <p className="hint">{t(EVENT_NOT_PUBLISHABLE)}</p>}
      {!internal && (!project || project.publishable !== false) && (
        <label className="check"><input type="checkbox" name="publish" value="1" disabled={!!blocked} />{" "}{t("Publier immédiatement dans l'agenda")}{blocked ? ` ${t("({blocked} ; enregistrez-le en brouillon d'ici là)", { blocked: t(BLOCKED_UNTIL[blocked]) })}` : ""}</label>
      )}
      <button className="btn" disabled={pending}>{pending ? t("Création…") : t("Créer l'événement")}</button>
    </ActionForm>
  );
}

/** Modifier l'événement : les inscrits sont prévenus d'un changement de date, de lieu, de format ou de lien. */
export function EditEventForm({ orgId, eventId, types, formats, catalog, initial, frozen, registrations, limits }: { orgId: string; eventId: string; types: Opt[]; formats: Opt[]; catalog: readonly CatalogItem[]; initial: EventInitial; frozen?: Frozen; registrations: number; limits?: HospitalityLimits }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateEvent, undefined);
  return (
    <ActionForm action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="eventId" value={eventId} />
      {registrations > 0 && <p className="hint">{t(registrations > 1 ? "{registrations} inscrits : un changement de date, d'heure, de lieu, de format ou de lien de connexion leur est annoncé par e-mail." : "{registrations} inscrit : un changement de date, d'heure, de lieu, de format ou de lien de connexion leur est annoncé par e-mail.", { registrations })}</p>}
      <EventFields types={types} formats={formats} catalog={catalog} initial={initial} frozen={frozen} limits={limits} />
      <button className="btn" disabled={pending}>{pending ? t("Enregistrement…") : t("Mettre à jour l'événement")}</button>
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
              {t(b.label)} — {eur(b.valueCents, locale)}
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
  const t = useT();
  const [state, action, pending] = useActionState(saveEventProgram, undefined);
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="eventId" value={eventId} />
      <label>{t("Déroulé")}
        <textarea name="program" rows={program ? Math.min(16, program.split("\n").length + 2) : 6} defaultValue={program} placeholder={t("18:30 – 18:45  Accueil des participants\n18:45 – 19:30  Session 1 — intervenant\n…")} />
      </label>
      <div className="actions">
        {ai && <AiDraft kind="programme" target="program" label={t("Proposer un programme avec l'IA")} />}
        <button className="btn small" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer le programme")}</button>
      </div>
    </form>
  );
}
