"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useT } from "@/components/I18nProvider";
import { addPartner, addProgramItem, addRoom, answerPartnership, decideAbstract, openAbstracts, reviewAbstract, scheduleAbstract, submitAbstract } from "@/lib/congress-actions";
import { ABSTRACT_FORMATS, MAX_ABSTRACT_CHARS, PARTNER_LEVELS, PROGRAM_KINDS } from "@/lib/congress";

type Ids = { orgId: string; eventId: string };
type Opt = { id: string; name: string };
const H = ({ orgId, eventId }: Ids) => (<><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="eventId" value={eventId} /></>);

export function RoomForm({ ids }: { ids: Ids }) {
  const t = useT();
  const [state, action, pending] = useActionState(addRoom, undefined);
  return (
    <form action={action} className="form inline-form" key={state?.ok ? Date.now() : "salle"}>
      <Notice state={state?.error ? state : undefined} />
      <H {...ids} />
      <label>{t("Salle")}<input name="name" required maxLength={80} placeholder={t("Amphithéâtre, salle 2…")} /></label>
      <label className="short">{t("Places")}<input name="capacity" type="number" min={1} /></label>
      <button className="btn small secondary" disabled={pending}>{t("Ajouter la salle")}</button>
    </form>
  );
}

/** Jour et horaires d'une séance (heure de Paris), salle. */
function SlotFields({ day, rooms }: { day: string; rooms: Opt[] }) {
  const t = useT();
  return (
    <div className="row">
      <label className="short">{t("Jour")}<input name="day" type="date" required defaultValue={day} /></label>
      <label className="short">{t("Début")}<input name="start" type="time" required /></label>
      <label className="short">{t("Fin")}<input name="end" type="time" required /></label>
      <label>{t("Salle")}
        <select name="roomId" defaultValue="">
          <option value="">{t("— sans salle —")}</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
    </div>
  );
}

export function ProgramItemForm({ ids, day, rooms, partners }: { ids: Ids; day: string; rooms: Opt[]; partners: Opt[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(addProgramItem, undefined);
  const [kind, setKind] = useState("conference");
  return (
    <ActionForm action={action} className="form stack-sm" key={state?.ok ? Date.now() : "seance"}>
      <Notice state={state} />
      <H {...ids} />
      <SlotFields day={day} rooms={rooms} />
      <div className="row">
        <label className="short">{t("Nature")}
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{PROGRAM_KINDS.map((k) => <option key={k.id} value={k.id}>{t(k.label)}</option>)}</select>
        </label>
        <label className="grow">{t("Titre")}<input name="title" required maxLength={200} /></label>
      </div>
      <div className="row">
        <label className="grow">{t("Intervenants")}<input name="speakers" maxLength={400} placeholder={t("Dr Durand (modération), Dr Martin")} /></label>
        {kind === "symposium" && partners.length > 0 && (
          <label>{t("Partenaire du symposium")}
            <select name="partnerId" defaultValue="">
              <option value="">—</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Ajout…") : t("Ajouter la séance")}</button>
    </ActionForm>
  );
}

export function AbstractsCallForm({ ids, deadline, topics, open }: { ids: Ids; deadline: string; topics: string; open: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(openAbstracts, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <H {...ids} />
      <label className="short">{t("Date limite de soumission")}<input name="deadline" type="date" required defaultValue={deadline} /></label>
      <label>{t("Thèmes")}<textarea name="topics" rows={3} defaultValue={topics} placeholder={t("Un thème par ligne : implantologie, parodontologie…")} /></label>
      <button className="btn small" disabled={pending}>{pending ? t("Enregistrement…") : open ? t("Mettre à jour l'appel") : t("Ouvrir l'appel à communications")}</button>
    </ActionForm>
  );
}

/** Soumission d'une communication : titre, auteurs, thème, format souhaité, résumé. */
export function AbstractSubmitForm({ eventId, topics }: { eventId: string; topics: string[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(submitAbstract, undefined);
  const [len, setLen] = useState(0);
  return (
    <ActionForm action={action} className="form stack-sm" key={state?.ok ? Date.now() : "resume"}>
      <Notice state={state} />
      <input type="hidden" name="eventId" value={eventId} />
      <label>{t("Titre")}<input name="title" required maxLength={250} /></label>
      <label>{t("Auteurs")}<input name="authors" required maxLength={600} placeholder={t("Nom Prénom (établissement), dans l'ordre ; l'orateur en premier")} /></label>
      <div className="row">
        {topics.length > 0 && (
          <label>{t("Thème")}
            <select name="topic" defaultValue="">
              <option value="">—</option>
              {topics.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        )}
        <label>{t("Format souhaité")}
          <select name="format" defaultValue="indifferent">{ABSTRACT_FORMATS.map((f) => <option key={f.id} value={f.id}>{t(f.label)}</option>)}</select>
        </label>
      </div>
      <label>{t("Résumé")}
        <textarea name="body" rows={10} required maxLength={MAX_ABSTRACT_CHARS} onChange={(e) => setLen(e.target.value.length)} placeholder={t("Contexte, objectif, méthode, résultats, conclusion. Aucune donnée permettant d'identifier un patient.")} />
        <span className="hint">{t("{n} / {max} caractères", { n: len, max: MAX_ABSTRACT_CHARS })}</span>
      </label>
      <button className="btn" disabled={pending}>{pending ? t("Envoi…") : t("Soumettre la communication")}</button>
    </ActionForm>
  );
}

export function AbstractReviewForm({ ids, abstractId, score, comment }: { ids: Ids; abstractId: string; score: number | null; comment: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(reviewAbstract, undefined);
  return (
    <form action={action} className="inline-form">
      <Notice state={state?.error ? state : undefined} />
      <H {...ids} />
      <input type="hidden" name="abstractId" value={abstractId} />
      <label className="short">{t("Votre note")}
        <select name="score" defaultValue={score != null ? String(score) : ""} required>
          <option value="" disabled>—</option>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
        </select>
      </label>
      <label className="grow">{t("Commentaire")}<input name="comment" maxLength={1000} defaultValue={comment} /></label>
      <button className="btn small ghost" disabled={pending}>{state?.ok ? t("Enregistré") : t("Noter")}</button>
    </form>
  );
}

export function AbstractDecisionForm({ ids, abstractId, wished }: { ids: Ids; abstractId: string; wished: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(decideAbstract, undefined);
  return (
    <form action={action} className="stack-xs">
      <Notice state={state?.error ? state : undefined} />
      <H {...ids} />
      <input type="hidden" name="abstractId" value={abstractId} />
      <div className="inline-form">
        <label className="short">{t("Retenue en")}
          <select name="acceptedFormat" defaultValue={wished === "poster" ? "poster" : "oral"}>
            <option value="oral">{t("Communication orale")}</option>
            <option value="poster">{t("Poster")}</option>
          </select>
        </label>
        <label className="grow">{t("Message à l'auteur")}<input name="note" maxLength={1000} placeholder={t("Facultatif")} /></label>
      </div>
      <div className="inline wrap">
        <button className="btn small secondary" name="decision" value="accept" disabled={pending}>{t("Retenir")}</button>
        <button className="btn small ghost" name="decision" value="reject" disabled={pending}>{t("Ne pas retenir")}</button>
      </div>
    </form>
  );
}

export function AbstractScheduleForm({ ids, abstractId, day, rooms }: { ids: Ids; abstractId: string; day: string; rooms: Opt[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(scheduleAbstract, undefined);
  return (
    <ActionForm action={action} className="form stack-xs">
      <Notice state={state} />
      <H {...ids} />
      <input type="hidden" name="abstractId" value={abstractId} />
      <SlotFields day={day} rooms={rooms} />
      <button className="btn small ghost" disabled={pending}>{t("Placer au programme")}</button>
    </ActionForm>
  );
}

/** Partenaire : organisation présente sur KolBase (convention proposée en ligne) ou autre, niveau, montant, contreparties. */
export function PartnerForm({ ids, orgs }: { ids: Ids; orgs: Opt[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(addPartner, undefined);
  const [org, setOrg] = useState("");
  return (
    <ActionForm action={action} className="form stack-sm" key={state?.ok ? Date.now() : "partenaire"}>
      <Notice state={state} />
      <H {...ids} />
      <div className="row">
        <label>{t("Organisation sur KolBase")}
          <select name="partnerOrgId" value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">{t("— autre partenaire —")}</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        {!org && <label>{t("Nom du partenaire")}<input name="name" maxLength={120} /></label>}
      </div>
      <div className="row">
        <label>{t("Niveau")}<select name="level" defaultValue="or">{PARTNER_LEVELS.map((l) => <option key={l.id} value={l.id}>{t(l.label)}</option>)}</select></label>
        <label className="short">{t("Montant (€ HT)")}<input name="amount" inputMode="decimal" /></label>
      </div>
      <label>{t("Contreparties")}<input name="counterparts" maxLength={1000} placeholder={t("Stand de 9 m², symposium de 45 minutes, logo sur le programme, 4 inscriptions")} /></label>
      <label className="check"><input type="checkbox" name="showLogo" defaultChecked /> {t("Afficher le partenaire sur la page de l'événement")}</label>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Ajout…") : t("Ajouter le partenaire")}</button>
    </ActionForm>
  );
}

/** Réponse de l'organisation partenaire : signer la convention, ou la décliner avec un motif. */
export function PartnershipAnswerForm({ orgId, partnerId }: { orgId: string; partnerId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(answerPartnership, undefined);
  const [declining, setDeclining] = useState(false);
  if (state?.ok) return <p className="notice ok">{state.ok}</p>;
  return (
    <form action={action} className="stack-xs">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="partnerId" value={partnerId} />
      {declining && <label>{t("Motif, transmis à l'organisateur")}<input name="note" maxLength={500} /></label>}
      <div className="inline wrap">
        {!declining && <button className="btn small" name="answer" value="sign" disabled={pending}>{t("Signer la convention")}</button>}
        {declining
          ? <button className="btn small danger" name="answer" value="decline" disabled={pending}>{t("Confirmer : décliner")}</button>
          : <button type="button" className="btn small ghost" onClick={() => setDeclining(true)}>{t("Décliner")}</button>}
      </div>
    </form>
  );
}
