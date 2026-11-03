"use client";

import { useActionState, useState, useTransition } from "react";
import { Megaphone, Sparkles } from "lucide-react";
import { draftServiceText, orderService, sendNewsletter } from "@/lib/service-actions";
import { Notice } from "@/components/AuthForms";

type Offer = { id: string; label: string; description: string; price: string; ordered: boolean; pack?: boolean; compareAt?: string; saving?: string; blocked?: boolean };

/** Catalogue des services KolBase sur un événement : commande avec consignes et date souhaitée. */
export function ServiceOffers({ orgId, eventId, offers, maxDate }: { orgId: string; eventId: string; offers: Offer[]; maxDate: string }) {
  const [state, action, pending] = useActionState(orderService, undefined);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack-sm">
      <Notice state={state} />
      <ul className="service-list">
        {offers.map((o) => (
          <li key={o.id} className={o.pack ? "service-pack" : undefined}>
            <div>
              <strong>{o.label}</strong> <span className="service-price">{o.price}</span>
              {o.compareAt && <> <s className="text-sm muted">{o.compareAt}</s> <span className="pill ok">Économisez {o.saving}</span></>}
              <p className="text-sm muted">{o.description}</p>
            </div>
            {o.ordered ? <span className="pill electric">Commandé</span>
              : o.blocked ? <span className="text-xs muted">Un des services du pack est déjà commandé.</span>
              : open === o.id ? null : <button type="button" className={`btn small${o.pack ? "" : " secondary"}`} onClick={() => setOpen(o.id)}><Megaphone size={13} /> Commander</button>}
            {open === o.id && !o.ordered && (
              <form action={action} className="form service-order-form" onSubmit={() => setOpen(null)}>
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="offerId" value={o.id} />
                <label>Consignes (facultatif)<textarea name="brief" rows={3} maxLength={2000} placeholder="Public visé, points à mettre en avant, visuels fournis…" /></label>
                <label>Date souhaitée (facultatif)<input type="date" name="wishedAt" max={maxDate} /></label>
                <div className="actions">
                  <button className="btn small" disabled={pending}>{pending ? "Envoi…" : `Commander — ${o.price}`}</button>
                  <button type="button" className="link" onClick={() => setOpen(null)}>Annuler</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** E-mailing aux membres consentants (équipe KolBase), avec brouillon de l'assistant. */
export function NewsletterForm({ orderId, subject, body, audience, ai }: { orderId?: string; subject: string; body: string; audience: number; ai: boolean }) {
  const [state, action, pending] = useActionState(sendNewsletter, undefined);
  const [text, setText] = useState(body);
  const [drafting, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (state?.ok) return <p className="notice ok">{state.ok}</p>;
  return (
    <form action={action} className="card form">
      <Notice state={state} />
      {orderId && <input type="hidden" name="orderId" value={orderId} />}
      <label>Objet<input name="subject" required maxLength={160} defaultValue={subject} /></label>
      <label>Texte<textarea name="body" rows={12} required value={text} onChange={(e) => setText(e.target.value)} /></label>
      {ai && orderId && (
        <div className="ai-draft">
          <button type="button" className="btn ghost small ai-btn" disabled={drafting} onClick={() => {
            const fd = new FormData();
            fd.set("orderId", orderId);
            setErr(null);
            start(async () => { const r = await draftServiceText(fd); if (r.text) setText(r.text); else setErr(r.error ?? "Pas de proposition."); });
          }}><Sparkles size={14} /> {drafting ? "Rédaction…" : "Proposer un texte avec l'IA"}</button>
          {err && <span className="text-xs error-text">{err}</span>}
        </div>
      )}
      <p className="hint">Envoyé à {audience} membre{audience > 1 ? "s" : ""} ayant accepté la lettre d&apos;information, avec un lien de désinscription en un clic.{orderId ? " La mention « Communication de [organisation], diffusée par KolBase » est ajoutée." : ""}</p>
      <button className="btn" disabled={pending || audience === 0}>{pending ? "Envoi…" : `Envoyer à ${audience} membre${audience > 1 ? "s" : ""}`}</button>
    </form>
  );
}

/** Brouillon de post pour les réseaux sociaux (à copier sur les comptes de KolBase). */
export function SocialDraft({ orderId }: { orderId: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="stack-sm">
      <button type="button" className="btn ghost small ai-btn" disabled={pending} onClick={() => {
        const fd = new FormData();
        fd.set("orderId", orderId);
        start(async () => { const r = await draftServiceText(fd); setText(r.text ?? r.error ?? ""); });
      }}><Sparkles size={14} /> {pending ? "Rédaction…" : "Proposer le post avec l'IA"}</button>
      {text && <textarea className="copy-block" rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Texte du post" />}
    </div>
  );
}
