"use client";

import { useActionState, useState, useTransition } from "react";
import { Megaphone, Sparkles } from "lucide-react";
import { draftServiceText, orderService, sendNewsletter } from "@/lib/service-actions";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { de } from "@/lib/elision";
import { useT } from "@/components/I18nProvider";

type Offer = {
  id: string; label: string; description: string; price: string; ordered: boolean; pack?: boolean; compareAt?: string; saving?: string; blocked?: boolean;
  /** E-mailing (seul ou dans le pack) : praticiens abonnés aujourd'hui. */ audience?: number;
  /** Raison pour laquelle la commande n'est pas possible (audience nulle, plafond de la lettre jusqu'après l'événement). */ unavailable?: string;
  /** Plafond mensuel de la lettre atteint : prochain envoi possible. */ note?: string;
  /** Date souhaitée au plus tôt (prochain envoi possible de la lettre). */ minDate?: string;
};

/** Catalogue des services KolBase sur un événement : commande avec consignes et date souhaitée. */
export function ServiceOffers({ orgId, eventId, offers, maxDate }: { orgId: string; eventId: string; offers: Offer[]; maxDate: string }) {
  const t = useT();
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
              {o.compareAt && <> <s className="text-sm muted">{o.compareAt}</s> <span className="pill ok">{t("Économisez {saving}", { saving: o.saving })}</span></>}
              <p className="text-sm muted">{o.description}</p>
              {o.audience != null && (
                <p className="text-xs">
                  {o.audience > 0
                    ? t(o.audience > 1 ? "E-mailing : {audience} praticiens abonnés à la lettre d'information aujourd'hui." : "E-mailing : {audience} praticien abonné à la lettre d'information aujourd'hui.", { audience: o.audience })
                    : t("E-mailing : aucun praticien n'est abonné à la lettre d'information pour l'instant, la commande n'est pas possible.")}
                </p>
              )}
              {o.note && !o.ordered && <p className="text-xs warn-text">{o.note}</p>}
            </div>
            {o.ordered ? <span className="pill electric">{t("Commandé")}</span>
              : o.blocked ? <span className="text-xs muted">{t("Un des services du pack est déjà commandé.")}</span>
              : o.unavailable ? <span className="text-xs muted">{o.unavailable}</span>
              : open === o.id ? null : <button type="button" className={`btn small${o.pack ? "" : " secondary"}`} onClick={() => setOpen(o.id)}><Megaphone size={13} />{" "}{t("Commander")}</button>}
            {open === o.id && !o.ordered && (
              <form action={action} className="form service-order-form" onSubmit={() => setOpen(null)}>
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="offerId" value={o.id} />
                <label>{t("Consignes (facultatif)")}<textarea name="brief" rows={3} maxLength={2000} placeholder={t("Public visé, points à mettre en avant, visuels fournis…")} /></label>
                <label>{t("Date souhaitée (facultatif)")}<input type="date" name="wishedAt" min={o.minDate} max={maxDate} /></label>
                <p className="hint">{t("Facturé une fois réalisé ; annulable sans frais tant que la commande n'est pas planifiée.")}{" "}<a href="/conditions-de-vente#art-8" target="_blank" rel="noopener">{t("Conditions de vente")}</a></p>
                <div className="actions">
                  <button className="btn small" disabled={pending}>{pending ? t("Envoi…") : t("Commander — {price}", { price: o.price })}</button>
                  <button type="button" className="link" onClick={() => setOpen(null)}>{t("Annuler")}</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * E-mailing aux praticiens consentants (équipe KolBase), avec brouillon de l'assistant. Aperçu de l'e-mail tel
 * qu'il part, « M'envoyer un test », puis envoi confirmé en deux temps (compteur des envois du mois).
 */
export function NewsletterForm({ orderId, advertiser, subject, body, audience, ai, sends, max, month }: {
  orderId?: string; advertiser?: string; subject: string; body: string; audience: number; ai: boolean; sends: number; max: number; month: string;
}) {
  const t = useT();
  const [state, action, pending] = useActionState(sendNewsletter, undefined);
  const [text, setText] = useState(body);
  const [title, setTitle] = useState(subject);
  const [drafting, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (state?.sent) return <p className="notice ok">{state.ok}</p>;
  const capped = sends >= max;
  const people = `${audience} praticien${audience > 1 ? "s" : ""}`;
  return (
    <ActionForm action={action} className="card form">
      <Notice state={state} />
      {orderId && <input type="hidden" name="orderId" value={orderId} />}
      <label>{t("Objet")}<input name="subject" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>{t("Texte")}<textarea name="body" rows={12} required value={text} onChange={(e) => setText(e.target.value)} /></label>
      {ai && orderId && (
        <div className="ai-draft">
          <button type="button" className="btn ghost small ai-btn" disabled={drafting} onClick={() => {
            const fd = new FormData();
            fd.set("orderId", orderId);
            setErr(null);
            start(async () => { const r = await draftServiceText(fd); if (r.text) setText(r.text); else setErr(r.error ?? t("Pas de proposition.")); });
          }}><Sparkles size={14} /> {drafting ? t("Rédaction…") : t("Proposer un texte avec l'IA")}</button>
          {err && <span className="text-xs error-text">{err}</span>}
        </div>
      )}
      <details className="newsletter-preview" open>
        <summary>{t("Aperçu de l'e-mail")}</summary>
        <div className="mail-preview">
          <p className="text-sm"><strong>{title || t("(objet)")}</strong></p>
          <p className="mail-preview-body">{text || t("(texte)")}{advertiser ? t("Communication {de}, diffusée par KolBase.", { de: de(advertiser) }) : ""}</p>
          <p className="text-sm"><span className="btn small" aria-hidden>{orderId ? t("Voir l'événement et s'inscrire") : t("Ouvrir KolBase")}</span></p>
          <p className="text-xs muted">{t("Lien de désinscription en un clic ajouté à chaque envoi.")}</p>
        </div>
      </details>
      <p className="hint">
        {t("Envoyé à {people} (compte praticien, lettre acceptée, adresse confirmée). Envois en {month} : {sends} sur {max} au plus (e-mailings commandés et lettres libres confondus).", { people, month, sends, max })}
      </p>
      {capped && <p className="notice warn">{t("Plafond atteint pour {month} : le prochain envoi est possible le mois prochain.", { month })}</p>}
      <div className="actions">
        <button className="btn ghost small" name="intent" value="test" disabled={pending}>{pending ? t("Envoi…") : t("M'envoyer un test")}</button>
        <ConfirmButton
          className="btn"
          disabled={audience === 0 || capped}
          pending={pending}
          name="intent"
          value="send"
          confirm={t("envoyer à {people}", { people })}
          summary={<>{t("« {title} » part aussitôt à {people} ; envoi", { title, people })}{" "}{sends + 1} sur {max} en {month}. Il ne pourra pas être annulé.</>}
        >
          {t("Envoyer à {people}", { people })}
        </ConfirmButton>
      </div>
    </ActionForm>
  );
}

/** Brouillon de post pour les réseaux sociaux (à copier sur les comptes de KolBase). */
export function SocialDraft({ orderId }: { orderId: string }) {
  const t = useT();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="stack-sm">
      <button type="button" className="btn ghost small ai-btn" disabled={pending} onClick={() => {
        const fd = new FormData();
        fd.set("orderId", orderId);
        start(async () => { const r = await draftServiceText(fd); setText(r.text ?? r.error ?? ""); });
      }}><Sparkles size={14} /> {pending ? t("Rédaction…") : t("Proposer le post avec l'IA")}</button>
      {text && <textarea className="copy-block" rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("Texte du post")} />}
    </div>
  );
}
