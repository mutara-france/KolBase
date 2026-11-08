"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addBudgetLine, addEventInvites, createEvent, registerToEvent, reviewEvent, saveEventProgram, saveTravel, sendEventMessage, setEventMdeonVisa, updateEvent } from "@/lib/event-actions";
import { ROOM_TYPES } from "@/lib/travel";
import { BUDGET_POSTS } from "@/lib/event-budget";
import { canAcceptHospitality, type HospitalityGate } from "@/lib/belgium";
import { DIETS } from "@/lib/registration-needs";
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
  format: string; capacity: string; city: string; postalCode?: string; venue: string; address?: string; onlineUrl: string; inviteOnly?: boolean; hostedBy?: string; hostedUrl?: string; benefits: { catalogId: string; valueCents: number }[];
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
      <div>
        <label className="check"><input type="checkbox" name="inviteOnly" value="1" defaultChecked={!!initial?.inviteOnly} /> {t("Sur invitation : hors de l'agenda public, inscription réservée aux invités")}</label>
        <p className="hint">{t("Comité consultatif, atelier fermé, invitation à un congrès : vous ajoutez les invités depuis la fiche de l'événement, chacun reçoit un lien personnel.")}</p>
      </div>
      <details className="disclosure" open={!!initial?.hostedBy}>
        <summary>{t("Congrès organisé par un tiers")}</summary>
        <div className="row">
          <label>{t("Organisateur du congrès")}<input name="hostedBy" maxLength={160} defaultValue={initial?.hostedBy} placeholder={t("ADF, société savante…")} /></label>
          <label>{t("Page du congrès")}<input name="hostedUrl" type="url" inputMode="url" maxLength={300} defaultValue={initial?.hostedUrl} placeholder="https://…" /></label>
        </div>
        <p className="hint">{t("Vous invitez des praticiens à un congrès que vous n'organisez pas : proposez les frais d'inscription, le transport et la nuitée comme prestations ; chacun accepte ce qu'il veut, les conventions et déclarations suivent.")}</p>
      </details>
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
          <label className="short">{t("Code postal")}<input name="postalCode" inputMode="numeric" autoComplete="postal-code" maxLength={12} defaultValue={initial?.postalCode} /></label>
          <label>{t("Ville")}<input name="city" defaultValue={initial?.city} /></label>
          <label>{t("Lieu")}<input name="venue" placeholder={t("Hôtel, salle…")} defaultValue={initial?.venue} /></label>
        </div>
      )}
      {format !== "DISTANCIEL" && (
        <label>{t("Adresse")}<input name="address" autoComplete="street-address" maxLength={200} placeholder={t("Numéro et rue")} defaultValue={initial?.address} />
          <span className="hint">{t("Affichée sur la page de l'événement, dans la confirmation d'inscription et dans l'agenda des inscrits.")}</span>
        </label>
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

export function NewEventForm({ orgId, types, formats, catalog, project, blocked = null, limits, review = false }: { orgId: string; types: Opt[]; formats: Opt[]; catalog: readonly CatalogItem[]; project?: { id: string; title: string; area: string | null; publishable?: boolean }; blocked?: Blocked; limits?: HospitalityLimits; review?: boolean }) {
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
      {/* Validation par la conformité exigée : soumission (dès la création ou depuis la fiche), puis publication. */}
      {!internal && review && (!project || project.publishable !== false) && (
        <>
          <label className="check"><input type="checkbox" name="submitReview" value="1" />{" "}{t("Soumettre aussitôt à la conformité")}</label>
          <p className="hint">{t("La conformité valide le lieu, la date, le programme et les hospitalités avant la publication. Vous pouvez aussi le lui soumettre plus tard, depuis la fiche de l'événement.")}</p>
        </>
      )}
      {!internal && !review && (!project || project.publishable !== false) && (
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

type Benefit = { id: string; label: string; valueCents: number; catalogId?: string };
const eur = (c: number, locale: Locale) => (c / 100).toLocaleString(intlLocale(locale), { style: "currency", currency: "EUR" });

export function RegisterForm({ eventId, benefits, hcp, defaultStructure, gate = "fr", visa = null, invitation }: { eventId: string; benefits: Benefit[]; hcp: boolean; defaultStructure: string; gate?: HospitalityGate; visa?: string | null; invitation?: string }) {
  const [state, action, pending] = useActionState(registerToEvent, undefined);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const t = useT();
  const locale = useLocale();
  // Étudiant, ou praticien exerçant en Belgique sans visa Mdeon : inscription possible, sans aucune prestation.
  const closed = !canAcceptHospitality(gate);
  const total = closed ? 0 : benefits.filter((b) => accepted[b.id]).reduce((s, b) => s + b.valueCents, 0);
  if (state?.ok) return <p className="notice ok">{state.ok} <Link href="/inscriptions">{t("Retrouvez-la dans « Mes inscriptions ».")}</Link></p>;
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="eventId" value={eventId} />
      {invitation && <input type="hidden" name="invitation" value={invitation} />}
      <label>{t("Structure d'exercice")}<input name="structure" defaultValue={defaultStructure} placeholder={t("Cabinet, hôpital…")} /></label>
      {benefits.length > 0 && (
        <fieldset>
          <legend>{t("Prestations proposées")}</legend>
          {gate === "student" ? (
            <p className="notice warn">{t("En tant qu'étudiant, vous ne pouvez accepter aucune de ces prestations : l'hospitalité offerte aux étudiants par les entreprises de santé est interdite. Vous pouvez vous inscrire sans elles.")}</p>
          ) : gate === "be_no_visa" ? (
            <p className="notice warn">{t("Vous exercez en Belgique : la prise en charge de cet événement suppose un visa Mdeon, que l'organisateur n'a pas encore communiqué. Vous pouvez vous inscrire sans les prestations.")}</p>
          ) : (
            <p className="hint">{t("Cochez uniquement ce que vous acceptez. Vous pouvez participer sans rien accepter.")}</p>
          )}
          {benefits.map((b) => (
            <label key={b.id} className="check">
              <input type="checkbox" name={`accept_${b.id}`} checked={!closed && !!accepted[b.id]} disabled={closed} onChange={(e) => setAccepted({ ...accepted, [b.id]: e.target.checked })} />
              {t(b.label)} — {eur(b.valueCents, locale)}
            </label>
          ))}
          {total > 0 && <p className="muted">{t("Valeur totale acceptée :")} <strong>{eur(total, locale)}</strong></p>}
        </fieldset>
      )}
      {!closed && benefits.some((b) => accepted[b.id] && (b.catalogId === "nuitee" || b.catalogId === "transport")) && (
        <label>{t("Ville de départ")}<input name="departureCity" maxLength={120} placeholder={t("Pour réserver votre transport et votre hôtel")} /></label>
      )}
      <NeedsFields />
      {hcp && total > 0 && (
        <div className="notice warn">
          <strong>{t("Information réglementaire.")}</strong>{" "}
          {gate === "be"
            ? visa
              ? t("Vous exercez en Belgique : les prestations acceptées constituent un avantage au sens de l'article 10 de la loi sur les médicaments. Elles sont couvertes par le visa Mdeon n° {visa} et seront publiées à votre nom sur betransparent.be.", { visa })
              : t("Vous exercez en Belgique : les prestations acceptées constituent un avantage au sens de l'article 10 de la loi sur les médicaments et seront publiées à votre nom sur betransparent.be.")
            : gate === "other"
              ? t("En tant que professionnel de santé, les prestations acceptées constituent un avantage soumis aux règles de votre pays d'exercice ; l'organisateur peut être tenu de les publier.")
              : t("En tant que professionnel de santé, les prestations acceptées constituent un avantage au sens du Code de la santé publique. Elles feront l'objet d'une convention d'hospitalité et seront publiées à votre nom sur la base Transparence Santé.")}
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

/**
 * Décision de la conformité sur un événement soumis : valider, ou demander des modifications (motif transmis à
 * l'équipe qui l'organise). `justify` : seule personne habilitée, qui l'a soumis elle-même (justification exigée).
 */
export function EventReviewForm({ orgId, eventId, justify = false }: { orgId: string; eventId: string; justify?: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(reviewEvent, undefined);
  return (
    <form action={action} className="stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="eventId" value={eventId} />
      <label>{justify ? t("Justification (obligatoire pour valider)") : t("Commentaire (obligatoire pour demander des modifications)")}
        <textarea name="note" rows={2} maxLength={1000} placeholder={t("Ex. : préciser le programme scientifique, choisir un lieu sans caractère touristique…")} />
      </label>
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn small" name="decision" value="approve" disabled={pending}>{t("Valider l'événement")}</button>
        <button className="btn ghost small" name="decision" value="changes" disabled={pending}>{t("Demander des modifications")}</button>
      </div>
    </form>
  );
}

/** Visa Mdeon de l'événement (praticiens exerçant en Belgique) : saisie, modification ou retrait du numéro. */
export function MdeonVisaForm({ orgId, eventId, visa }: { orgId: string; eventId: string; visa: string | null }) {
  const t = useT();
  const [state, action, pending] = useActionState(setEventMdeonVisa, undefined);
  return (
    <form action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="eventId" value={eventId} />
      <label>{t("Numéro de visa Mdeon")}
        <input name="mdeonVisa" defaultValue={visa ?? ""} placeholder={t("Numéro attribué par Mdeon")} maxLength={60} />
      </label>
      <p className="hint">{t("Laissez vide pour retirer le numéro. Il est communiqué aux praticiens exerçant en Belgique avec les prestations.")}</p>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer le visa")}</button>
    </form>
  );
}

/**
 * Besoins pour l'événement (facultatifs) : régime, allergies, accessibilité ou adaptation. Données sensibles : la
 * case d'accord apparaît dès qu'un champ est rempli et conditionne leur enregistrement.
 */
function NeedsFields() {
  const t = useT();
  const [diet, setDiet] = useState("");
  const [allergies, setAllergies] = useState("");
  const [needs, setNeeds] = useState("");
  const filled = !!(diet || allergies.trim() || needs.trim());
  return (
    <details className="disclosure needs-fields">
      <summary>{t("Repas, allergies, accessibilité (facultatif)")}</summary>
      <div className="stack-sm">
        <div className="row">
          <label>{t("Régime alimentaire")}
            <select name="diet" value={diet} onChange={(e) => setDiet(e.target.value)}>
              <option value="">{t("Aucun en particulier")}</option>
              {DIETS.map((d) => <option key={d.id} value={d.id}>{t(d.label)}</option>)}
            </select>
          </label>
          <label>{t("Allergies ou intolérances")}<input name="allergies" maxLength={300} value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder={t("Arachide, crustacés…")} /></label>
        </div>
        <label>{t("Accessibilité ou adaptation")}<textarea name="needs" rows={2} maxLength={500} value={needs} onChange={(e) => setNeeds(e.target.value)} placeholder={t("Accès en fauteuil, boucle magnétique, place réservée…")} /></label>
        {filled && (
          <label className="check text-sm">
            <input type="checkbox" name="needsConsent" value="1" required />{" "}
            {t("J'accepte que ces informations soient transmises à l'organisateur et, sans mon nom, au lieu et au traiteur, pour préparer l'événement. Elles sont effacées 30 jours après.")}
          </label>
        )}
      </div>
    </details>
  );
}

/** Message aux inscrits (e-mail à chacun) : objet et texte. */
export function EventMessageForm({ orgId, eventId, count }: { orgId: string; eventId: string; count: number }) {
  const t = useT();
  const [state, action, pending] = useActionState(sendEventMessage, undefined);
  return (
    <form action={action} className="form stack-sm" key={state?.ok ? Date.now() : "message"}>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="eventId" value={eventId} />
      <label>{t("Objet")}<input name="subject" maxLength={120} required placeholder={t("Changement de salle, informations pratiques…")} /></label>
      <label>{t("Message")}<textarea name="body" rows={4} maxLength={4000} required /></label>
      <button className="btn small" disabled={pending}>{pending ? t("Envoi…") : t(count > 1 ? "Envoyer aux {n} inscrits" : "Envoyer à l'inscrit", { n: count })}</button>
    </form>
  );
}

/** Invités : une personne par ligne (e-mail, prénom, nom), chacune reçoit un lien personnel. */
export function InviteForm({ orgId, eventId }: { orgId: string; eventId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(addEventInvites, undefined);
  return (
    <form action={action} className="form stack-sm" key={state?.ok ? Date.now() : "invites"}>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="eventId" value={eventId} />
      <label>{t("Personnes à inviter")}
        <textarea name="people" rows={4} required placeholder={t("claire.dupont@exemple.fr ; Claire ; Dupont\nJean Martin <jean.martin@exemple.fr>")} />
        <span className="hint">{t("Une personne par ligne : e-mail, prénom, nom (séparés par un point-virgule), ou « Prénom Nom <e-mail> ». Collez directement depuis un tableur.")}</span>
      </label>
      <button className="btn small" disabled={pending}>{pending ? t("Envoi…") : t("Inviter")}</button>
    </form>
  );
}

type TravelInitial = { checkIn: string; checkOut: string; roomType: string; hotel: string; hotelRef: string; outbound: string; returnTrip: string; ticketRef: string; notes: string };

/** Réservations d'un participant : hôtel, dates, chambre, trajets, billets. */
export function TravelForm({ orgId, registrationId, initial }: { orgId: string; registrationId: string; initial: TravelInitial }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveTravel, undefined);
  return (
    <form action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="registrationId" value={registrationId} />
      <div className="row">
        <label>{t("Hôtel")}<input name="hotel" maxLength={160} defaultValue={initial.hotel} /></label>
        <label>{t("N° de réservation")}<input name="hotelRef" maxLength={80} defaultValue={initial.hotelRef} /></label>
      </div>
      <div className="row">
        <label>{t("Arrivée")}<input name="checkIn" type="date" defaultValue={initial.checkIn} /></label>
        <label>{t("Départ")}<input name="checkOut" type="date" defaultValue={initial.checkOut} /></label>
        <label>{t("Chambre")}
          <select name="roomType" defaultValue={initial.roomType}>
            <option value="">—</option>
            {ROOM_TYPES.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <label>{t("Aller")}<input name="outbound" maxLength={300} defaultValue={initial.outbound} placeholder={t("TGV 6203 Paris 7 h 04 → Lyon 9 h 00")} /></label>
        <label>{t("Retour")}<input name="returnTrip" maxLength={300} defaultValue={initial.returnTrip} /></label>
      </div>
      <div className="row">
        <label>{t("Billets (référence)")}<input name="ticketRef" maxLength={120} defaultValue={initial.ticketRef} /></label>
        <label>{t("Remarque")}<input name="notes" maxLength={500} defaultValue={initial.notes} /></label>
      </div>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer")}</button>
    </form>
  );
}

/** Nouveau poste du budget de l'événement. */
export function BudgetLineForm({ orgId, eventId }: { orgId: string; eventId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(addBudgetLine, undefined);
  return (
    <form action={action} className="form stack-sm" key={state?.ok ? Date.now() : "budget"}>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="eventId" value={eventId} />
      <div className="row">
        <label>{t("Poste")}<select name="category" defaultValue="restauration">{BUDGET_POSTS.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}</select></label>
        <label>{t("Libellé")}<input name="label" maxLength={120} placeholder={t("Cocktail de clôture…")} /></label>
        <label>{t("Prévu (€ TTC)")}<input name="planned" inputMode="decimal" required /></label>
      </div>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Ajout…") : t("Ajouter le poste")}</button>
    </form>
  );
}
