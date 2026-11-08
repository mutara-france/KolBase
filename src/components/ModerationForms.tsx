"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { useT } from "@/components/I18nProvider";
import { handleReport, submitReport } from "@/lib/moderation-actions";
import { REPORT_MAX_CHARS, REPORT_REASONS } from "@/lib/moderation";

/** Signalement d'un contenu : motif, description ; adresse e-mail sans compte (pour la réponse). */
export function ReportForm({ type, id, needEmail }: { type: string; id: string; needEmail: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(submitReport, undefined);
  if (state?.ok) return <p className="notice ok" role="status">{state.ok}</p>;
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <label>{t("Motif")}
        <select name="reason" required defaultValue="">
          <option value="" disabled>{t("— choisir —")}</option>
          {REPORT_REASONS.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
        </select>
      </label>
      <label>{t("Ce qui pose problème")}<textarea name="details" rows={5} required minLength={10} maxLength={REPORT_MAX_CHARS} placeholder={t("Le passage en cause et pourquoi il est illicite, inexact ou contraire à la déontologie.")} /></label>
      {needEmail && <label>{t("Votre adresse e-mail")}<input name="email" type="email" required autoComplete="email" /><span className="hint">{t("La décision de l'équipe KolBase vous est envoyée à cette adresse.")}</span></label>}
      <button className="btn" disabled={pending}>{pending ? t("Envoi…") : t("Envoyer le signalement")}</button>
    </ActionForm>
  );
}

/** Décision de l'équipe KolBase sur un signalement (administration, en français). */
export function ReportDecisionForm({ reportId, removal }: { reportId: string; removal: string }) {
  const [state, action, pending] = useActionState(handleReport, undefined);
  const [decision, setDecision] = useState("sans_suite");
  if (state?.ok) return <p className="notice ok" role="status">{state.ok}</p>;
  return (
    <ActionForm action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="reportId" value={reportId} />
      <fieldset className="inline wrap">
        <legend className="sr-only">Décision</legend>
        <label className="check"><input type="radio" name="decision" value="retire" checked={decision === "retire"} onChange={() => setDecision("retire")} /> {removal}</label>
        <label className="check"><input type="radio" name="decision" value="sans_suite" checked={decision === "sans_suite"} onChange={() => setDecision("sans_suite")} /> Sans suite</label>
      </fieldset>
      <label>Motif de la décision (communiqué)<textarea name="note" rows={3} required maxLength={2000} /></label>
      <button className={decision === "retire" ? "btn danger small" : "btn small"} disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer la décision"}</button>
    </ActionForm>
  );
}
