"use client";

import { useActionState } from "react";
import { addDeclaredInterest, reportTransparencyIssue } from "@/lib/revenue-actions";
import { Notice } from "@/components/AuthForms";
import { useT } from "@/components/I18nProvider";

/** Ajout d'un lien d'intérêts noué hors de KolBase. */
export function InterestForm() {
  const [state, action, pending] = useActionState(addDeclaredInterest, undefined);
  const t = useT();
  const year = new Date().getFullYear();
  return (
    <form action={action} className="form" key={state?.ok ? Date.now() : "interest"}>
      <Notice state={state} />
      <div className="row">
        <label>{t("Organisation")}<input name="organization" required maxLength={120} placeholder={t("Laboratoire, fabricant, société savante…")} /></label>
        <label>{t("Nature du lien")}<input name="nature" required maxLength={200} placeholder={t("Consultant, orateur, investigateur, participation financière…")} /></label>
      </div>
      <div className="row">
        <label>{t("Depuis")}<input name="startYear" type="number" min={1980} max={year} defaultValue={year} required /></label>
        <label>{t("Jusqu'à (vide si en cours)")}<input name="endYear" type="number" min={1980} max={year} /></label>
      </div>
      <button className="btn small" disabled={pending}>{pending ? t("Enregistrement…") : t("Ajouter le lien")}</button>
    </form>
  );
}

/** Signalement d'une erreur sur une déclaration Transparence Santé. */
export function ReportForm({ kind, id }: { kind: "convention" | "hospitalite"; id: string }) {
  const [state, action, pending] = useActionState(reportTransparencyIssue, undefined);
  const t = useT();
  if (state?.ok) return <span className="text-xs muted" role="status">{state.ok}</span>;
  return (
    <details className="older">
      <summary>{t("Signaler une erreur")}</summary>
      <form action={action} className="form">
        <Notice state={state} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <textarea name="comment" rows={2} required minLength={10} placeholder={t("Montant, nature ou date erronés…")} aria-label={t("Erreur constatée")} />
        <button className="btn ghost small" disabled={pending}>{t("Envoyer à l'organisation")}</button>
      </form>
    </details>
  );
}
