"use client";

import { useActionState, useState } from "react";
import { addExpense, addMaterial, addMaterialVersion, setBudget } from "@/lib/dossier-actions";
import { Notice } from "@/components/AuthForms";
import { uploadDocument } from "@/lib/document-actions";
import { useT } from "@/components/I18nProvider";
import { refreshSignatureStatus, sendConventionForSignature } from "@/lib/signature-actions";
import { addProjectExpert, updateExpertTerms, updateProjectObject } from "@/lib/project-actions";
import { ActionForm } from "@/components/ActionForm";
import { BLOCKED_UNTIL, subscribeHref, type Blocked } from "@/lib/billing-plans";
import { dpaHref } from "@/lib/dpa";

type Hidden = { orgId: string; projectId: string };
const H = ({ orgId, projectId }: Hidden) => (<><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="projectId" value={projectId} /></>);

export function BudgetForm({ orgId, projectId, budgetCents }: Hidden & { budgetCents: number | null }) {
  const t = useT();
  const [state, action, pending] = useActionState(setBudget, undefined);
  return (
    <form action={action} className="inline wrap">
      <H orgId={orgId} projectId={projectId} />
      <input name="budget" inputMode="decimal" defaultValue={budgetCents != null ? String(budgetCents / 100) : ""} placeholder={t("Budget total € HT")} aria-label={t("Budget")} />
      <button className="btn ghost small" disabled={pending}>{t("Enregistrer")}</button>
      {state?.error && <span className="text-xs" style={{ color: "var(--danger)" }}>{state.error}</span>}
    </form>
  );
}

export function ExpenseForm(p: Hidden) {
  const t = useT();
  const [state, action, pending] = useActionState(addExpense, undefined);
  return (
    <form action={action} className="form" key={state?.ok ? Date.now() : "exp"}>
      <Notice state={state?.error ? state : undefined} />
      <H {...p} />
      <div className="row">
        <label>{t("Poste")}<input name="label" placeholder={t("Location de salle, traiteur, déplacement…")} required /></label>
        <label>{t("Montant (€ HT)")}<input name="amount" inputMode="decimal" required /></label>
        <label>{t("Date")}<input name="date" type="date" /></label>
      </div>
      <button className="btn secondary small" disabled={pending}>{t("Ajouter la dépense")}</button>
    </form>
  );
}

export function MaterialForm({ projectId, kinds }: { projectId: string; kinds: Record<string, string> }) {
  const [state, action, pending] = useActionState(addMaterial, undefined);
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!open) return <button type="button" className="btn secondary small" onClick={() => setOpen(true)}>{t("Soumettre un support")}</button>;
  return (
    <form action={action} className="form sub-form" key={state?.ok ? Date.now() : "mat"}>
      <Notice state={state} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="row">
        <label>{t("Titre")}<input name="title" required placeholder={t("Diaporama du symposium")} /></label>
        <label>{t("Type")}<select name="kind" defaultValue="diaporama">{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></label>
      </div>
      <label>{t("Lien vers le document")}<input name="url" type="url" placeholder={t("https://… (Drive, SharePoint, Dropbox…)")} /></label>
      <label>{t("Contenu ou précisions")}<textarea name="notes" rows={3} placeholder={t("Résumé, messages clés, points à vérifier…")} /></label>
      <button className="btn small" disabled={pending}>{pending ? t("Envoi…") : t("Soumettre à la relecture")}</button>
    </form>
  );
}

export function VersionForm({ materialId }: { materialId: string }) {
  const [state, action, pending] = useActionState(addMaterialVersion, undefined);
  const [open, setOpen] = useState(false);
  const t = useT();
  if (state?.ok) return <p className="notice ok">{state.ok}</p>;
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>{t("Déposer une nouvelle version")}</button>;
  return (
    <form action={action} className="form sub-form">
      <Notice state={state} />
      <input type="hidden" name="materialId" value={materialId} />
      <label>{t("Lien vers la nouvelle version")}<input name="url" type="url" placeholder="https://…" /></label>
      <label>{t("Modifications apportées")}<textarea name="notes" rows={2} /></label>
      <button className="btn small" disabled={pending}>{t("Soumettre la version")}</button>
    </form>
  );
}

/** Dépôt d'un document de dossier (pièce, ou convention signée d'un expert). En signature, « Convention signée » d'office. */
export function DocumentUploadForm({ projectId, experts, ownLinkId, defaultKind = "PIECE" }: { projectId: string; experts: { id: string; name: string }[]; ownLinkId?: string; defaultKind?: "PIECE" | "CONVENTION_SIGNEE" }) {
  const [state, action, pending] = useActionState(uploadDocument, undefined);
  const t = useT();
  return (
    <form action={action} className="form stack-sm" key={state?.ok ? Date.now() : "doc"}>
      <Notice state={state} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="row">
        <label>{t("Document")}
          <select name="kind" defaultValue={defaultKind}>
            <option value="PIECE">{t("Pièce du dossier")}</option>
            <option value="CONVENTION_SIGNEE">{t("Convention signée")}</option>
          </select>
        </label>
        {ownLinkId ? <input type="hidden" name="linkId" value={ownLinkId} /> : (
          <label>{t("Expert concerné")}
            <select name="linkId" defaultValue="">
              <option value="">{t("— tout le dossier —")}</option>
              {experts.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <label>{t("Fichier")}<input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.pptx" /></label>
      <p className="hint">{t("PDF, image ou document bureautique, 10 Mo au maximum.")}</p>
      <button className="btn secondary" disabled={pending}>{pending ? t("Envoi…") : t("Déposer")}</button>
    </form>
  );
}

/** Envoi de la convention d'un expert en signature électronique (Yousign). */
export function SendSignatureForm({ orgId, linkId, again }: { orgId: string; linkId: string; again?: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(sendConventionForSignature, undefined);
  return (
    <form action={action} className="stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="linkId" value={linkId} />
      {!state?.ok && (
        <span>
          <button className="btn small" disabled={pending}>{pending ? t("Envoi en cours…") : again ? t("Envoyer de nouveau en signature électronique") : t("Envoyer en signature électronique")}</button>
        </span>
      )}
    </form>
  );
}

/** Interrogation du prestataire de signature (sans webhook, ou pour rattraper un événement manqué). */
export function RefreshSignatureForm({ linkId }: { linkId: string }) {
  const [state, action, pending] = useActionState(refreshSignatureStatus, undefined);
  const t = useT();
  return (
    <form action={action} className="inline wrap">
      <input type="hidden" name="linkId" value={linkId} />
      <button className="link" disabled={pending}>{pending ? t("Mise à jour…") : t("Mettre à jour le statut")}</button>
      {state?.error && <span className="text-xs" style={{ color: "var(--danger)" }} role="alert">{state.error}</span>}
      {state?.ok && <span className="text-xs" role="status">{state.ok}</span>}
    </form>
  );
}

// ─── Modification du dossier (avant la signature) ──────────────────────────

/** Objet du dossier : titre, domaine thérapeutique, objet et déroulé. */
export function ProjectObjectForm({ orgId, projectId, title, area, description }: Hidden & { title: string; area: string; description: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateProjectObject, undefined);
  return (
    <ActionForm action={action} className="form">
      <Notice state={state} />
      <H orgId={orgId} projectId={projectId} />
      <div className="row">
        <label>{t("Titre du dossier")}<input name="title" required defaultValue={title} /></label>
        <label>{t("Domaine thérapeutique")}<input name="therapeuticArea" defaultValue={area} /></label>
      </div>
      <label>{t("Objet et déroulé")}<textarea name="description" rows={4} defaultValue={description} /></label>
      <button className="btn ghost small" disabled={pending}>{pending ? t("Enregistrement…") : t("Mettre à jour l'objet")}</button>
    </ActionForm>
  );
}

/** Unités et honoraires d'un expert : modifiés, la proposition lui est renvoyée. */
export function ExpertTermsForm({ orgId, projectId, linkId, name, unit, units, fee, desired }: Hidden & { linkId: string; name: string; unit: string; units: string; fee: string; desired?: string | null }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateExpertTerms, undefined);
  return (
    <ActionForm action={action} className="form terms-form">
      <H orgId={orgId} projectId={projectId} />
      <input type="hidden" name="linkId" value={linkId} />
      <div className="fee-row">
        <strong>{name}</strong>
        <label>{t("Unités ({unit})", { unit: t(unit) })}<input name="units" inputMode="decimal" defaultValue={units} /></label>
        <label>{t("Honoraires totaux (€ HT)")}<input name="fee" inputMode="decimal" defaultValue={fee} required /></label>
        <button className="btn ghost small" disabled={pending}>{pending ? t("Envoi…") : t("Proposer ces conditions")}</button>
      </div>
      {desired && <p className="hint">{t("Honoraires souhaités par l'expert : {desired} HT.", { desired })}</p>}
      <Notice state={state} />
    </ActionForm>
  );
}

/** Ajouter un expert référencé au dossier : il reçoit la sollicitation. */
export function AddExpertForm({ orgId, projectId, unit, experts, blocked = null }: Hidden & { unit: string; experts: { id: string; name: string; detail: string; dayRateCents: number | null }[]; blocked?: Blocked }) {
  const t = useT();
  const [state, action, pending] = useActionState(addProjectExpert, undefined);
  const [expertId, setExpertId] = useState("");
  const chosen = experts.find((e) => e.id === expertId);
  if (experts.length === 0) return <p className="muted text-sm">{t("Tous les experts référencés sont déjà sollicités.")}</p>;
  return (
    <ActionForm action={action} className="form">
      <Notice state={state} />
      <H orgId={orgId} projectId={projectId} />
      <label>{t("Expert")}
        <select name="expertId" value={expertId} onChange={(e) => setExpertId(e.target.value)} required>
          <option value="">{t("— choisir un expert référencé —")}</option>
          {experts.map((e) => <option key={e.id} value={e.id}>{e.name}{e.detail ? ` · ${e.detail}` : ""}</option>)}
        </select>
      </label>
      <div className="row">
        <label>{t("Unités ({unit})", { unit: t(unit) })}<input name="units" inputMode="decimal" defaultValue="1" /></label>
        <label>{t("Honoraires totaux (€ HT)")}<input key={expertId} name="fee" inputMode="decimal" defaultValue={chosen?.dayRateCents != null ? String(chosen.dayRateCents / 100) : ""} required /></label>
      </div>
      <label>{t("Message d'accompagnement")}<textarea name="message" rows={2} placeholder={t("Message envoyé avec la sollicitation")} /></label>
      <button className="btn ghost small" disabled={pending || !!blocked}>{pending ? t("Envoi…") : t("Ajouter et solliciter l'expert")}</button>
      {blocked && (
        <p className="hint">
          {t("Sollicitation possible {blocked} :", { blocked: t(BLOCKED_UNTIL[blocked]) })}
          {blocked === "validation" ? <a href={`/organisations/${orgId}/membres?onglet=organisation`}>{t("suivre la validation")}</a> : blocked === "contrat" ? <a href={dpaHref(orgId, "sollicitation", projectId)}>{t("accepter le contrat de sous-traitance")}</a> : <a href={subscribeHref(orgId, "sollicitation", projectId)}>{t("activer l'abonnement")}</a>}.
        </p>
      )}
    </ActionForm>
  );
}
