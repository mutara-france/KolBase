"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/AuthForms";
import { useT } from "@/components/I18nProvider";
import { addFrameworkMission, decideExpertExpense, saveExpertTravel, submitExpertExpense } from "@/lib/expert-cost-actions";
import { EXPENSE_CATEGORIES } from "@/lib/expert-costs";
import { ROOM_TYPES } from "@/lib/travel";

/** Note de frais de l'expert : nature, objet, date, montant TTC et justificatif. */
export function ExpertExpenseForm({ linkId, proofRequired }: { linkId: string; proofRequired: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(submitExpertExpense, undefined);
  return (
    <form action={action} className="form stack-sm" key={state?.ok ? Date.now() : "frais"}>
      <Notice state={state} />
      <input type="hidden" name="linkId" value={linkId} />
      <div className="row">
        <label>{t("Nature")}
          <select name="category" defaultValue="transport">
            {EXPENSE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{t(c.label)}</option>)}
          </select>
        </label>
        <label className="grow">{t("Objet")}<input name="label" required maxLength={160} placeholder={t("Train Paris – Lyon aller-retour, hôtel 1 nuit…")} /></label>
      </div>
      <div className="row">
        <label className="short">{t("Date")}<input name="date" type="date" required /></label>
        <label className="short">{t("Montant (€ TTC)")}<input name="amount" inputMode="decimal" required /></label>
        <label>{t("Justificatif")}<input type="file" name="proof" required={proofRequired} accept=".pdf,.jpg,.jpeg,.png" /></label>
      </div>
      <p className="hint">{t("Billet, facture d'hôtel ou note de restaurant, au nom de l'expert. Les frais remboursés sont déclarés avec la convention.")}</p>
      <button className="btn small" disabled={pending}>{pending ? t("Envoi…") : t("Envoyer la note de frais")}</button>
    </form>
  );
}

/** Examen d'une note de frais par l'organisation : accepter, ou refuser avec un motif. */
export function ExpenseDecisionForm({ orgId, expenseId }: { orgId: string; expenseId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(decideExpertExpense, undefined);
  const [refusing, setRefusing] = useState(false);
  return (
    <form action={action} className="stack-xs">
      <Notice state={state?.error ? state : undefined} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="expenseId" value={expenseId} />
      {refusing && <label className="sr-only" htmlFor={`motif-${expenseId}`}>{t("Motif du refus")}</label>}
      {refusing && <input id={`motif-${expenseId}`} name="note" required maxLength={500} placeholder={t("Motif du refus, transmis à l'expert")} />}
      <div className="inline wrap">
        {!refusing && <button className="btn small secondary" name="decision" value="approve" disabled={pending}>{t("Accepter")}</button>}
        {refusing
          ? <button className="btn small danger" name="decision" value="reject" disabled={pending}>{t("Confirmer le refus")}</button>
          : <button type="button" className="btn small ghost" onClick={() => setRefusing(true)}>{t("Refuser")}</button>}
      </div>
    </form>
  );
}

type TravelInitial = { checkIn: string; checkOut: string; roomType: string; hotel: string; hotelRef: string; outbound: string; returnTrip: string; ticketRef: string; notes: string };

/** Voyage d'un expert réservé par l'organisation : hôtel, dates, chambre, trajets, billets ; envoi par e-mail. */
export function ExpertTravelForm({ orgId, linkId, initial, sent }: { orgId: string; linkId: string; initial: TravelInitial; sent: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveExpertTravel, undefined);
  return (
    <form action={action} className="form stack-sm">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="linkId" value={linkId} />
      <div className="row">
        <label>{t("Hôtel")}<input name="hotel" maxLength={160} defaultValue={initial.hotel} /></label>
        <label>{t("N° de réservation")}<input name="hotelRef" maxLength={80} defaultValue={initial.hotelRef} /></label>
      </div>
      <div className="row">
        <label>{t("Arrivée")}<input name="checkIn" type="date" defaultValue={initial.checkIn} /></label>
        <label>{t("Départ")}<input name="checkOut" type="date" defaultValue={initial.checkOut} /></label>
        <label>{t("Chambre")}
          <select name="roomType" defaultValue={initial.roomType}>
            <option value="">—</option>
            {ROOM_TYPES.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <label>{t("Aller")}<input name="outbound" maxLength={300} defaultValue={initial.outbound} placeholder={t("TGV 6203 Paris 7 h 04 → Lyon 9 h 00")} /></label>
        <label>{t("Retour")}<input name="returnTrip" maxLength={300} defaultValue={initial.returnTrip} /></label>
      </div>
      <div className="row">
        <label>{t("Billets (référence)")}<input name="ticketRef" maxLength={120} defaultValue={initial.ticketRef} /></label>
        <label>{t("Remarque")}<input name="notes" maxLength={500} defaultValue={initial.notes} /></label>
      </div>
      <label className="check"><input type="checkbox" name="send" defaultChecked={!sent} /> {sent ? t("Renvoyer le détail à l'expert par e-mail") : t("Envoyer le détail à l'expert par e-mail")}</label>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer le voyage")}</button>
    </form>
  );
}

/** Mission réalisée au titre d'un contrat-cadre : date, objet, unités consommées. */
export function FrameworkMissionForm({ orgId, linkId, unit, remaining }: { orgId: string; linkId: string; unit: string; remaining: number }) {
  const t = useT();
  const [state, action, pending] = useActionState(addFrameworkMission, undefined);
  return (
    <form action={action} className="form stack-sm" key={state?.ok ? Date.now() : "mission"}>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="linkId" value={linkId} />
      <div className="row">
        <label className="short">{t("Date")}<input name="date" type="date" required /></label>
        <label className="grow">{t("Objet de la mission")}<input name="label" required maxLength={200} placeholder={t("Webinaire du 12 mars, relecture du support…")} /></label>
        <label className="short">{t("Unités ({unit})", { unit: t(unit) })}<input name="units" inputMode="decimal" required defaultValue="1" /></label>
      </div>
      <p className="hint">{t("Il reste {n} au contrat-cadre.", { n: String(remaining) })}</p>
      <button className="btn small secondary" disabled={pending}>{pending ? t("Enregistrement…") : t("Consigner la mission")}</button>
    </form>
  );
}
