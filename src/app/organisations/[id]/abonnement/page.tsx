import Link from "next/link";
import { CheckCircle2, CreditCard, Gift } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { stripeEnabled, syncCheckout } from "@/lib/billing";
import { asInterval, canEngage, displayStatus, ENGAGING, formatPrice, freeMonths, monthlyCents, planFor, planPrice, PLANS, STATUS_LABEL, TRIAL_DAYS, type Motive } from "@/lib/billing-plans";
import { openBillingPortal, startSubscription } from "@/lib/billing-actions";
import { formatDate } from "@/lib/events";

export const metadata = { title: "Abonnement — KolBase" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ session?: string; motif?: string; annule?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { org, isAdmin } = await requireMembership(id);
  if (sp.session && stripeEnabled()) await syncCheckout(id, sp.session).catch((e) => console.error("[abonnement]", e));
  const sub = await db.subscription.findUnique({ where: { organizationId: id } });
  const admins = await db.membership.findMany({ where: { organizationId: id, role: "ADMIN" }, include: { user: { select: { firstName: true, lastName: true } } } });
  const plan = planFor(org.kind);
  const status = displayStatus(sub);
  const ok = canEngage(sub);
  const supplier = plan === "prestataire";
  const won = supplier ? await db.quote.count({ where: { supplierId: id, status: "retained" } }) : 0;
  const motive = sp.motif && sp.motif in ENGAGING ? (sp.motif as Motive) : null;
  const tone = status === "active" || status === "essai" || status === "offerte" ? "ok" : status === "impayee" ? "wait" : "";

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Abonnement</p>
        <h1>Abonnement</h1>
        {!stripeEnabled() && <p className="notice">La facturation n&apos;est pas encore activée sur KolBase : toutes les fonctions restent accessibles.</p>}
        {motive && !ok && stripeEnabled() && <p className="notice warn">Pour {ENGAGING[motive]}, l&apos;abonnement de l&apos;organisation doit être activé{isAdmin ? "" : " par un administrateur"}.</p>}
        {sp.annule && <p className="notice">Paiement interrompu : rien n&apos;a été souscrit.</p>}

        <section className="card stack-sm">
          <div className="actions spread">
            <div>
              <h2>{PLANS[plan].label}</h2>
              <p className="muted">{formatPrice(PLANS[plan].cents)} sans engagement, ou {formatPrice(PLANS[plan].yearCents, "year")} ({freeMonths(plan)} mois offerts) ; premier mois offert.</p>
            </div>
            <span className={`pill ${tone}`}>{STATUS_LABEL[status]}</span>
          </div>
          <dl className="hero-facts">
            {status === "offerte" && <div><dt><Gift size={13} /> Offert jusqu&apos;au</dt><dd>{formatDate(sub!.exemptUntil!)}<small>{sub!.exemptNote ?? "accordé par KolBase"}</small></dd></div>}
            {sub?.status === "essai" && sub.trialEndsAt && <div><dt>Mois offert jusqu&apos;au</dt><dd>{formatDate(sub.trialEndsAt)}<small>premier prélèvement ensuite</small></dd></div>}
            {sub?.status === "active" && sub.currentPeriodEnd && <div><dt>Prochaine échéance</dt><dd>{formatDate(sub.currentPeriodEnd)}<small>{sub.cancelAtPeriodEnd ? "résiliation programmée à cette date" : asInterval(sub.interval) === "year" ? "renouvellement annuel" : "renouvellement mensuel"}</small></dd></div>}
            {["essai", "active", "impayee"].includes(sub?.status ?? "") && <div><dt>Formule</dt><dd>{asInterval(sub!.interval) === "year" ? "Annuelle" : "Mensuelle"}<small>{formatPrice(planPrice(plan, asInterval(sub!.interval)), asInterval(sub!.interval))}</small></dd></div>}
            {sub?.triggeredAt && <div><dt>Déclenché le</dt><dd>{formatDate(sub.triggeredAt)}<small>{sub.triggeredBy}</small></dd></div>}
          </dl>
          {isAdmin && stripeEnabled() && (
            <div className="actions">
              {!ok && (
                <form action={startSubscription} className="plan-choice">
                  <input type="hidden" name="orgId" value={id} />
                  <div className="plan-option">
                    <strong>Mensuel</strong>
                    <span className="plan-price">{formatPrice(PLANS[plan].cents)}</span>
                    <span className="text-sm muted">Sans engagement, résiliable à tout moment.</span>
                    <button className="btn secondary" name="interval" value="month"><CreditCard size={15} /> {sub?.trialUsed ? "Réactiver l'abonnement mensuel" : `Activer l'abonnement mensuel — ${TRIAL_DAYS} jours offerts`}</button>
                  </div>
                  <div className="plan-option recommended">
                    <strong>Annuel <span className="pill ok">{freeMonths(plan)} mois offerts</span></strong>
                    <span className="plan-price">{formatPrice(PLANS[plan].yearCents, "year")}</span>
                    <span className="text-sm muted">Soit {formatPrice(monthlyCents(plan, "year"))}, réglé en une fois.</span>
                    <button className="btn" name="interval" value="year"><CreditCard size={15} /> {sub?.trialUsed ? "Réactiver l'abonnement annuel" : `Activer l'abonnement annuel — ${TRIAL_DAYS} jours offerts`}</button>
                  </div>
                </form>
              )}
              {sub?.stripeCustomerId && (
                <form action={openBillingPortal}>
                  <input type="hidden" name="orgId" value={id} />
                  <button className="btn ghost">Moyen de paiement, factures, résiliation</button>
                </form>
              )}
            </div>
          )}
          {!isAdmin && !ok && stripeEnabled() && <p className="hint">Seul un administrateur peut activer l&apos;abonnement : {admins.map((a) => `${a.user.firstName} ${a.user.lastName}`).join(", ")}.</p>}
          <p className="hint">Paiement par carte ou prélèvement SEPA, facture envoyée par e-mail à chaque échéance (TVA en sus). Résiliable à tout moment, effet à la fin de la période en cours (mois ou année).</p>
        </section>

        <section className="card stack-sm">
          <h2>Ce qui est compris</h2>
          {supplier ? (
            <ul className="plain check-list">
              <li><CheckCircle2 size={15} /> <span><strong>Gratuit :</strong> référencement dans l&apos;annuaire, book, réception des demandes de devis et réponses jusqu&apos;au premier devis retenu{won ? ` (vous en avez ${won})` : ""}.</span></li>
              <li><CheckCircle2 size={15} /> <span><strong>Abonnement :</strong> répondre à de nouvelles demandes après un premier devis retenu ; les prestations retenues et les échanges en cours restent toujours accessibles.</span></li>
              <li><CheckCircle2 size={15} /> <span>Payer ne change jamais votre place dans l&apos;annuaire.</span></li>
            </ul>
          ) : (
            <ul className="plain check-list">
              <li><CheckCircle2 size={15} /> <span><strong>Gratuit :</strong> création et validation de l&apos;organisation, invitation de l&apos;équipe, paramétrage, consultation de l&apos;annuaire, brouillons.</span></li>
              <li><CheckCircle2 size={15} /> <span><strong>L&apos;abonnement démarre</strong> à la première action qui engage un tiers : {Object.values(ENGAGING).slice(0, 4).join(", ")}.</span></li>
              <li><CheckCircle2 size={15} /> <span>Utilisateurs illimités ; agences mandatées sans surcoût.</span></li>
              <li><CheckCircle2 size={15} /> <span>Dossiers, conventions, registres et déclarations restent toujours accessibles, même sans abonnement actif.</span></li>
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
