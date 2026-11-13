"use client";

import { useActionState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { offerExemption } from "@/lib/billing-actions";
import { addWatchSource } from "@/lib/watch-actions";
import { startMarketImport } from "@/lib/market-actions";

/**
 * Gratuité offerte par KolBase (administration) : dernier jour offert (aujourd'hui au plus tôt) et motif. Une date
 * absente ou passée est refusée avec un message, la saisie reste.
 */
export function ExemptionOffer({ orgId, min }: { orgId: string; min: string }) {
  const [state, action, pending] = useActionState(offerExemption, undefined);
  return (
    <ActionForm action={action} className="inline wrap">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="date" name="until" min={min} aria-label="Offert jusqu'au" required />
      <input name="note" placeholder="Motif" aria-label="Motif" />
      <button className="link" disabled={pending}>offrir</button>
      {state?.error && <span className="text-xs warn-text" role="alert">{state.error}</span>}
    </ActionForm>
  );
}

/** Source de veille (administration) : nom affiché aux organisations et adresse du flux, lu une première fois à l'ajout. */
export function WatchSourceForm() {
  const [state, action, pending] = useActionState(addWatchSource, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      {state?.error && <p className="notice error" role="alert">{state.error}</p>}
      {state?.ok && <p className="notice ok" role="status">{state.ok}</p>}
      <div className="row">
        <label>Nom de la source<input name="name" required maxLength={120} /></label>
        <label>Adresse du flux RSS ou Atom<input name="url" type="url" required placeholder="https://…" /></label>
      </div>
      <button className="btn small" disabled={pending}>{pending ? "Lecture du flux…" : "Ajouter la source"}</button>
    </ActionForm>
  );
}

/** Lien de partage du fichier Transparence Santé (Google Drive ou Google Sheets) et lancement de sa lecture. */
export function MarketImportForm({ link, busy }: { link: string; busy: boolean }) {
  const [state, action, pending] = useActionState(startMarketImport, undefined);
  return (
    <ActionForm action={action} className="form stack-sm">
      {state?.error && <p className="notice error" role="alert">{state.error}</p>}
      {state?.ok && <p className="notice ok" role="status">{state.ok}</p>}
      <label>Lien de partage du fichier<input name="link" type="url" required defaultValue={link} placeholder="https://drive.google.com/file/d/…" maxLength={600} /></label>
      <button className="btn small" disabled={pending || busy}>{pending ? "Lancement…" : busy ? "Mise à jour en cours…" : "Mettre à jour"}</button>
    </ActionForm>
  );
}
