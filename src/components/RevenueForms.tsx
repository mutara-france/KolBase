"use client";

import { useActionState } from "react";
import { addDeclaredInterest, issueFeeNote, reportTransparencyIssue, updateBilling } from "@/lib/revenue-actions";
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

/** Coordonnées de facturation (notes d'honoraires). */
export function BillingForm({ current }: { current: { billingEntity: string; billingAddress: string; siret: string; vatRegime: string; vatNumber: string; iban: string } }) {
  const [state, action, pending] = useActionState(updateBilling, undefined);
  const t = useT();
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <label>{t("Société d'exercice (facultatif)")}<input name="billingEntity" maxLength={120} defaultValue={current.billingEntity} placeholder={t("SELARL, SELAS… si vous facturez par une société")} /></label>
      <label>{t("Adresse de facturation")}<textarea name="billingAddress" rows={3} maxLength={300} required defaultValue={current.billingAddress} /></label>
      <div className="row">
        <label>{t("SIRET (facultatif)")}<input name="siret" inputMode="numeric" maxLength={17} defaultValue={current.siret} /></label>
        <label>{t("Régime de TVA")}
          <select name="vatRegime" defaultValue={current.vatRegime}>
            <option value="franchise">{t("Franchise en base (TVA non applicable)")}</option>
            <option value="assujetti">{t("Assujetti à la TVA (20 %)")}</option>
          </select>
        </label>
        <label>{t("N° de TVA intracommunautaire")}<input name="vatNumber" maxLength={20} defaultValue={current.vatNumber} placeholder="FR…" /></label>
      </div>
      <label>{t("IBAN (facultatif, imprimé sur la note)")}<input name="iban" maxLength={42} defaultValue={current.iban} autoComplete="off" /></label>
      <button className="btn small" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer")}</button>
    </form>
  );
}

/** Établir la note d'honoraires d'une convention signée. */
export function IssueNoteButton({ linkId }: { linkId: string }) {
  const [state, action, pending] = useActionState(issueFeeNote, undefined);
  const t = useT();
  if (state?.ok) return <span className="text-xs muted" role="status">{state.ok}</span>;
  return (
    <form action={action} className="inline">
      <input type="hidden" name="linkId" value={linkId} />
      <button className="btn small secondary" disabled={pending}>{pending ? "…" : t("Établir la note")}</button>
      {state?.error && <span className="text-xs err" role="alert"> {state.error}</span>}
    </form>
  );
}
