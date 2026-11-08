"use client";

import { useActionState } from "react";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { TableWrap } from "@/components/TableWrap";
import { useT } from "@/components/I18nProvider";
import { createHalfDays, saveAssessments, saveAttendance, saveTrainingSheet } from "@/lib/training-actions";
import { ASSESSMENTS, FUNDING } from "@/lib/training";

type Ids = { orgId: string; eventId: string };
const H = ({ orgId, eventId }: Ids) => (<><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="eventId" value={eventId} /></>);

type SheetInit = { objectives: string; audience: string; prerequisites: string; hours: string; methods: string; assessment: string; accessDelay: string; accessibility: string; price: string; funding: string[]; fundingNote: string; dpcRef: string; contact: string };

/** Fiche de la formation : ce que le public doit savoir avant de s'inscrire (Qualiopi, indicateur 1). */
export function TrainingSheetForm({ ids, init }: { ids: Ids; init: SheetInit }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveTrainingSheet, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <H {...ids} />
      <label>{t("Objectifs pédagogiques")}<textarea name="objectives" rows={3} required defaultValue={init.objectives} placeholder={t("À l'issue de la formation, le participant sait…")} /></label>
      <div className="row">
        <label>{t("Public visé")}<input name="audience" defaultValue={init.audience} placeholder={t("Chirurgiens-dentistes, assistants…")} /></label>
        <label>{t("Prérequis")}<input name="prerequisites" defaultValue={init.prerequisites} placeholder={t("Aucun, ou pratique de l'implantologie…")} /></label>
        <label className="short">{t("Durée (heures)")}<input name="hours" inputMode="decimal" defaultValue={init.hours} /></label>
      </div>
      <label>{t("Modalités pédagogiques")}<textarea name="methods" rows={2} defaultValue={init.methods} placeholder={t("Exposés, cas cliniques, travaux pratiques sur simulateur, support remis…")} /></label>
      <label>{t("Modalités d'évaluation des acquis")}<textarea name="assessment" rows={2} defaultValue={init.assessment} placeholder={t("Quiz avant et après, mise en situation, évaluation par le formateur…")} /></label>
      <div className="row">
        <label>{t("Modalités et délai d'accès")}<input name="accessDelay" defaultValue={init.accessDelay} placeholder={t("Inscription en ligne jusqu'à 7 jours avant")} /></label>
        <label>{t("Accessibilité (handicap)")}<input name="accessibility" defaultValue={init.accessibility} placeholder={t("Salle accessible, adaptation sur demande au référent handicap")} /></label>
      </div>
      <div className="row">
        <label>{t("Tarif")}<input name="price" maxLength={300} defaultValue={init.price} placeholder={t("450 € TTC, déjeuner compris")} /></label>
        <label>{t("Référence DPC (n° d'action ANDPC)")}<input name="dpcRef" maxLength={60} defaultValue={init.dpcRef} /></label>
      </div>
      <fieldset>
        <legend>{t("Modalités de financement")}</legend>
        <div className="inline wrap">
          {FUNDING.map((f) => <label key={f.id} className="check"><input type="checkbox" name="funding" value={f.id} defaultChecked={init.funding.includes(f.id)} /> {t(f.label)}</label>)}
        </div>
        <label>{t("Précisions sur le financement")}<input name="fundingNote" maxLength={500} defaultValue={init.fundingNote} placeholder={t("Prise en charge DPC dans la limite du forfait annuel…")} /></label>
      </fieldset>
      <label>{t("Contact")}<input name="contact" maxLength={300} defaultValue={init.contact} placeholder={t("Nom, e-mail ou téléphone")} /></label>
      <button className="btn small" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer la fiche")}</button>
    </ActionForm>
  );
}

/** Demi-journées sur un ou plusieurs jours (matin, après-midi), pour l'émargement. */
export function HalfDaysForm({ ids, firstDay, replace }: { ids: Ids; firstDay: string; replace: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(createHalfDays, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <H {...ids} />
      <div className="row">
        <label className="short">{t("Premier jour")}<input name="firstDay" type="date" required defaultValue={firstDay} /></label>
        <label className="short">{t("Nombre de jours")}<input name="days" type="number" min={1} max={10} required defaultValue="1" /></label>
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" name="am" defaultChecked /> {t("Matin")}</label>
        <label className="short">{t("de")}<input name="amStart" type="time" defaultValue="09:00" /></label>
        <label className="short">{t("à")}<input name="amEnd" type="time" defaultValue="12:30" /></label>
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" name="pm" defaultChecked /> {t("Après-midi")}</label>
        <label className="short">{t("de")}<input name="pmStart" type="time" defaultValue="14:00" /></label>
        <label className="short">{t("à")}<input name="pmEnd" type="time" defaultValue="17:30" /></label>
      </div>
      {replace && <p className="hint">{t("Les demi-journées actuelles, sans émargement, sont remplacées.")}</p>}
      <button className="btn small secondary" disabled={pending}>{pending ? t("Création…") : t("Créer les demi-journées")}</button>
    </ActionForm>
  );
}

type Grid = { sessions: { id: string; label: string; open: boolean }[]; rows: { id: string; name: string; cells: { sessionId: string; checked: boolean; self: boolean }[] }[] };

/** Émargement par demi-journée : signatures des participants, présences relevées par l'organisateur. */
export function AttendanceForm({ ids, grid }: { ids: Ids; grid: Grid }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveAttendance, undefined);
  return (
    <form action={action} className="stack-sm">
      <Notice state={state} />
      <H {...ids} />
      <TableWrap label={t("Émargement")}>
        <table className="table attendance">
          <thead><tr><th>{t("Participant")}</th>{grid.sessions.map((s) => <th key={s.id} className="num">{s.label}</th>)}</tr></thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                {r.cells.map((c) => {
                  const s = grid.sessions.find((x) => x.id === c.sessionId)!;
                  return (
                    <td key={c.sessionId} className="num">
                      <label className="sr-only" htmlFor={`att_${c.sessionId}_${r.id}`}>{`${r.name} · ${s.label}`}</label>
                      <input id={`att_${c.sessionId}_${r.id}`} type="checkbox" name={`att_${c.sessionId}_${r.id}`} defaultChecked={c.checked} disabled={c.self || !s.open} />
                      {c.self && <><input type="hidden" name={`att_${c.sessionId}_${r.id}`} value="on" /><span className="text-xs muted"> {t("signé")}</span></>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="hint">{t("« signé » : le participant a émargé lui-même, connecté à son compte. Les autres cases sont relevées par l'équipe.")}</p>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer l'émargement")}</button>
    </form>
  );
}

/** Évaluation des acquis de chaque participant (attestation de fin de formation, indicateur publié). */
export function AssessmentForm({ ids, rows }: { ids: Ids; rows: { id: string; name: string; value: string; hours: string | null }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveAssessments, undefined);
  return (
    <form action={action} className="stack-sm">
      <Notice state={state} />
      <H {...ids} />
      <ul className="plain stack-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex-between">
            <span>{r.name}{r.hours && <span className="text-xs muted"> · {r.hours}</span>}</span>
            <label className="sr-only" htmlFor={`assess_${r.id}`}>{t("Évaluation des acquis de {name}", { name: r.name })}</label>
            <select id={`assess_${r.id}`} name={`assess_${r.id}`} defaultValue={r.value}>
              <option value="">{t("Non évalué")}</option>
              {ASSESSMENTS.map((a) => <option key={a.id} value={a.id}>{t(a.label)}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer l'évaluation")}</button>
    </form>
  );
}
