"use client";

import { useActionState, useState } from "react";
import { addExpense, addMaterial, addMaterialVersion, proposeCollaboration, setBudget } from "@/lib/dossier-actions";
import { Notice } from "@/components/AuthForms";
import { uploadDocument } from "@/lib/document-actions";
import { refreshSignatureStatus, sendConventionForSignature } from "@/lib/signature-actions";

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
  if (!open) return <button type="button" className="btn secondary small" onClick={() => setOpen(true)}>Soumettre un support</button>;
  return (
    <form action={action} className="form sub-form" key={state?.ok ? Date.now() : "mat"}>
      <Notice state={state} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="row">
        <label>Titre<input name="title" required placeholder="Diaporama du symposium" /></label>
        <label>Type<select name="kind" defaultValue="diaporama">{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <label>Lien vers le document<input name="url" type="url" placeholder="https://… (Drive, SharePoint, Dropbox…)" /></label>
      <label>Contenu ou précisions<textarea name="notes" rows={3} placeholder="Résumé, messages clés, points à vérifier…" /></label>
      <button className="btn small" disabled={pending}>{pending ? "Envoi…" : "Soumettre à la relecture"}</button>
    </form>
  );
}

export function VersionForm({ materialId }: { materialId: string }) {
  const [state, action, pending] = useActionState(addMaterialVersion, undefined);
  const [open, setOpen] = useState(false);
  if (state?.ok) return <p className="notice ok">{state.ok}</p>;
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>Déposer une nouvelle version</button>;
  return (
    <form action={action} className="form sub-form">
      <Notice state={state} />
      <input type="hidden" name="materialId" value={materialId} />
      <label>Lien vers la nouvelle version<input name="url" type="url" placeholder="https://…" /></label>
      <label>Modifications apportées<textarea name="notes" rows={2} /></label>
      <button className="btn small" disabled={pending}>Soumettre la version</button>
    </form>
  );
}

type CType = { id: string; label: string; category: string; unit: string; fmv: readonly number[] };
export function ProposeForm({ orgId, orgName, types, defaultFee }: { orgId: string; orgName: string; types: readonly CType[]; defaultFee: string }) {
  const [state, action, pending] = useActionState(proposeCollaboration, undefined);
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(types[0].id);
  const type = types.find((t) => t.id === typeId)!;
  if (!open) return <button type="button" className="btn secondary" onClick={() => setOpen(true)}>Proposer une collaboration</button>;
  return (
    <form action={action} className="card form">
      <h2>Proposer une collaboration à {orgName}</h2>
      <p className="muted">Votre proposition ouvre un dossier que l&apos;organisation peut accepter ou décliner.</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>Titre<input name="title" required placeholder="Ex. : Webinaire sur la maintenance implantaire" /></label>
      <div className="row">
        <label>Type<select name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <label>Domaine<input name="therapeuticArea" /></label>
      </div>
      <div className="row">
        <label>Volume ({type.unit})<input name="units" inputMode="decimal" defaultValue="1" /></label>
        <label>Honoraires souhaités (€ HT)<input name="fee" inputMode="decimal" defaultValue={defaultFee} /></label>
      </div>
      <p className="hint">Référence : {type.fmv[0].toLocaleString("fr-FR")} à {type.fmv[1].toLocaleString("fr-FR")} € HT par {type.unit}.</p>
      <label>Votre proposition<textarea name="message" rows={4} required minLength={30} placeholder="Objectif, public, format, dates possibles…" /></label>
      <button className="btn" disabled={pending}>{pending ? "Envoi…" : "Envoyer la proposition"}</button>
    </form>
  );
}

/** Dépôt d'un document de dossier (pièce, ou convention signée d'un expert). */
export function DocumentUploadForm({ projectId, experts, ownLinkId }: { projectId: string; experts: { id: string; name: string }[]; ownLinkId?: string }) {
  const [state, action, pending] = useActionState(uploadDocument, undefined);
  return (
    <form action={action} className="form stack-sm" key={state?.ok ? Date.now() : "doc"}>
      <Notice state={state} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="row">
        <label>Document
          <select name="kind" defaultValue="PIECE">
            <option value="PIECE">Pièce du dossier</option>
            <option value="CONVENTION_SIGNEE">Convention signée</option>
          </select>
        </label>
        {ownLinkId ? <input type="hidden" name="linkId" value={ownLinkId} /> : (
          <label>Expert concerné
            <select name="linkId" defaultValue="">
              <option value="">— tout le dossier —</option>
              {experts.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <label>Fichier<input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.pptx" /></label>
      <p className="hint">PDF, image ou document bureautique, 10 Mo au maximum.</p>
      <button className="btn secondary" disabled={pending}>{pending ? "Envoi…" : "Déposer"}</button>
    </form>
  );
}

/** Envoi de la convention d'un expert en signature électronique (Yousign). */
export function SendSignatureForm({ orgId, linkId, again }: { orgId: string; linkId: string; again?: boolean }) {
  const [state, action, pending] = useActionState(sendConventionForSignature, undefined);
  return (
    <form action={action} className="stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="linkId" value={linkId} />
      {!state?.ok && (
        <span>
          <button className="btn small" disabled={pending}>{pending ? "Envoi en cours…" : again ? "Envoyer de nouveau en signature électronique" : "Envoyer en signature électronique"}</button>
        </span>
      )}
    </form>
  );
}

/** Interrogation du prestataire de signature (sans webhook, ou pour rattraper un événement manqué). */
export function RefreshSignatureForm({ linkId }: { linkId: string }) {
  const [state, action, pending] = useActionState(refreshSignatureStatus, undefined);
  return (
    <form action={action} className="inline wrap">
      <input type="hidden" name="linkId" value={linkId} />
      <button className="link" disabled={pending}>{pending ? "Mise à jour…" : "Mettre à jour le statut"}</button>
      {state?.error && <span className="text-xs" style={{ color: "var(--danger)" }} role="alert">{state.error}</span>}
      {state?.ok && <span className="text-xs" role="status">{state.ok}</span>}
    </form>
  );
}
