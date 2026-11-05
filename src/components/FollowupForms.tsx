"use client";

import { useActionState } from "react";
import { sendFollowUpsNow, sendRemindersNow } from "@/lib/followup-actions";
import { useT } from "@/components/I18nProvider";

/** Bouton d'envoi immédiat (rappel de la veille, ou remerciement avec attestation et questionnaire). */
export function SendNowButton({ kind, orgId, eventId, label }: { kind: "reminders" | "followups"; orgId: string; eventId: string; label: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(kind === "reminders" ? sendRemindersNow : sendFollowUpsNow, undefined);
  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="eventId" value={eventId} />
      <button className="btn ghost" disabled={pending}>{pending ? t("Envoi…") : label}</button>
      {state?.ok && <p className="notice ok" role="status">{state.ok}</p>}
      {state?.error && <p className="notice error" role="alert">{state.error}</p>}
    </form>
  );
}
