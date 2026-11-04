"use client";

import { useActionState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { offerExemption } from "@/lib/billing-actions";

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
