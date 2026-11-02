"use client";

import { useActionState, useState } from "react";
import { addExpense, addMaterial, addMaterialVersion, proposeCollaboration, setBudget } from "@/lib/dossier-actions";
import { Notice } from "@/components/AuthForms";
import { uploadDocument } from "@/lib/document-actions";
import { intlLocale } from "@/lib/i18n";
import { useLocale, useT } from "@/components/I18nProvider";

type Hidden = { orgId: string; projectId: string };
const H = ({ orgId, projectId }: Hidden) => (<><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="projectId" value={projectId} /></>);

export function BudgetForm({ orgId, projectId, budgetCents }: Hidden & { budgetCents: number | null }) {
  const [state, action, pending] = useActionState(setBudget, undefined);
  return (
    <form action={action} className="inline wrap">
      <H orgId={orgId} projectId={projectId} />
      <input name="budget" inputMode="decimal" defaultValue={budgetCents != null ? String(budgetCents / 100) : ""} placeholder="Budget total € HT" aria-label="Budget" />
      <button className="btn ghost small" disabled={pending}>Enregistrer</button>
      {state?.error && <span className="text-xs" style={{ color: "var(--danger)" }}>{state.error}</span>}
    </form>
  );
}

export function ExpenseForm(p: Hidden) {
  const [state, action, pending] = useActionState(addExpense, undefined);
  return (
    <form action={action} className="form" key={state?.ok ? Date.now() : "exp"}>
      <Notice state={state?.error ? state : undefined} />
      <H {...p} />
      <div className="row">
        <label>Poste<input name="label" placeholder="Location de salle, traiteur, déplacement…" required /></label>
        <label>Montant (€ HT)<input name="amount" inputMode="decimal" required /></label>
        <label>Date<input name="date" type="date" /></label>
      </div>
      <button className="btn secondary small" disabled={pending}>Ajouter la dépense</button>
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

type CType = { id: string; label: string; category: string; unit: string; fmv: readonly number[] };
export function ProposeForm({ orgId, orgName, types, defaultFee }: { orgId: string; orgName: string; types: readonly CType[]; defaultFee: string }) {
  const [state, action, pending] = useActionState(proposeCollaboration, undefined);
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(types[0].id);
  const t = useT();
  const locale = useLocale();
  const num = (n: number) => n.toLocaleString(intlLocale(locale));
  const type = types.find((x) => x.id === typeId)!;
  if (!open) return <button type="button" className="btn secondary" onClick={() => setOpen(true)}>{t("Proposer une collaboration")}</button>;
  return (
    <form action={action} className="card form">
      <h2>{t("Proposer une collaboration à {org}", { org: orgName })}</h2>
      <p className="muted">{t("Votre proposition ouvre un dossier que l'organisation peut accepter ou décliner.")}</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>{t("Titre")}<input name="title" required placeholder={t("Ex. : Webinaire sur la maintenance implantaire")} /></label>
      <div className="row">
        <label>{t("Type")}<select name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>{types.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}</select></label>
        <label>{t("Domaine")}<input name="therapeuticArea" /></label>
      </div>
      <div className="row">
        <label>{t("Volume ({unit})", { unit: t(type.unit) })}<input name="units" inputMode="decimal" defaultValue="1" /></label>
        <label>{t("Honoraires souhaités (€ HT)")}<input name="fee" inputMode="decimal" defaultValue={defaultFee} /></label>
      </div>
      <p className="hint">{t("Référence : {min} à {max} € HT par {unit}.", { min: num(type.fmv[0]), max: num(type.fmv[1]), unit: t(type.unit) })}</p>
      <label>{t("Votre proposition")}<textarea name="message" rows={4} required minLength={30} placeholder={t("Objectif, public, format, dates possibles…")} /></label>
      <button className="btn" disabled={pending}>{pending ? t("Envoi…") : t("Envoyer la proposition")}</button>
    </form>
  );
}

/** Dépôt d'un document de dossier (pièce, ou convention signée d'un expert). */
export function DocumentUploadForm({ projectId, experts, ownLinkId }: { projectId: string; experts: { id: string; name: string }[]; ownLinkId?: string }) {
  const [state, action, pending] = useActionState(uploadDocument, undefined);
  const t = useT();
  return (
    <form action={action} className="form stack-sm" key={state?.ok ? Date.now() : "doc"}>
      <Notice state={state} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="row">
        <label>{t("Document")}
          <select name="kind" defaultValue="PIECE">
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
