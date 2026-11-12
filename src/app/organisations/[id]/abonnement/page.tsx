import { SectionHead, PageHead } from "@/components/UI";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, CreditCard, Gift, PackageCheck, Sparkles } from "lucide-react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { isAgencyOnly, requireMembership } from "@/lib/orgs";
import { stripeEnabled, syncCheckout } from "@/lib/billing";
import { addonOpen, addonPrice, ADDONS, addonsFor, addonSource, asAddon, asInterval, asMotive, asObjectId, canEngage, displayStatus, ENGAGING, formatPrice, freeMonths, monthlyCents, planFor, planPrice, PLANS, resumeAction, RUNNING, STATUS_LABEL, TRIAL_DAYS } from "@/lib/billing-plans";
import { openBillingPortal, startSubscription, toggleAddon } from "@/lib/billing-actions";
import { setEventFlag } from "@/lib/event-actions";
import { getT } from "@/lib/i18n/server";
import { fmtDate, intlLocale } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Abonnement")} — KolBase` };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ session?: string; motif?: string; objet?: string; annule?: string; option?: string; resultat?: string }> }) {
  const { t, locale } = await getT();
  const loc = intlLocale(locale);
  const { id } = await params;
  const sp = await searchParams;
  const { org, isAdmin, roles } = await requireMembership(id);
  // L'abonnement d'une organisation ne regarde pas l'agence qu'elle mandate.
  if (isAgencyOnly(roles, org.kind)) redirect(`/organisations/${id}`);
  if (sp.session && stripeEnabled()) await syncCheckout(id, sp.session).catch((e) => console.error("[abonnement]", e));
  const sub = await db.subscription.findUnique({ where: { organizationId: id } });
  const admins = await db.membership.findMany({ where: { organizationId: id, role: "ADMIN" }, include: { user: { select: { firstName: true, lastName: true } } } });
  const plan = planFor(org.kind);
  const status = displayStatus(sub);
  const ok = canEngage(sub);
  const supplier = plan === "prestataire";
  const won = supplier ? await db.quote.count({ where: { supplierId: id, status: "retained" } }) : 0;
  const motive = asMotive(sp.motif);
  const objet = asObjectId(sp.objet);
  // Prestataire : rien à payer avant un premier devis retenu (pas de bouton de paiement d'ici là).
  const freeSupplier = supplier && !ok && !sub?.triggeredAt && won === 0;
  // Retour du paiement : abonnement activé, et l'action qui l'attendait peut reprendre.
  const resume = sp.session && ok ? resumeAction(id, motive, objet) : null;
  // Options : celles en vente pour ce type d'organisation, et celles que l'organisation a déjà (offertes par KolBase).
  const options = addonsFor(org.kind).filter((a) => addonOpen(a) || addonSource(sub, a));
  const wanted = asAddon(sp.option);
  // Une option s'ajoute à un abonnement Stripe en cours, à sa périodicité.
  const running = !!sub?.stripeSubscriptionId && RUNNING.includes(sub.status);
  const interval = asInterval(sub?.interval);
  const tone = status === "active" || status === "essai" || status === "offerte" ? "ok" : status === "impayee" ? "wait" : "";

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / {t("Abonnement")}</p>
        <PageHead title={t("Abonnement")} desc={t("Votre formule, sa facturation et ce qu'elle comprend.")} />
        {!stripeEnabled() && <p className="notice">{t("La facturation n'est pas encore activée sur KolBase : toutes les fonctions restent accessibles.")}</p>}
        {sp.session && ok && (
          <div className="notice ok stack-sm" role="status">
            <span><CheckCircle2 size={15} />{" "}{t("Abonnement activé")}{status === "essai" ? t(" : premier mois offert") : ""}{t(". Merci !")}</span>
            {resume && (
              resume.publish ? (
                <form action={setEventFlag}>
                  <input type="hidden" name="orgId" value={id} />
                  <input type="hidden" name="eventId" value={resume.publish} />
                  <input type="hidden" name="flag" value="publish" />
                  <button className="btn small">{t(resume.label)}</button>
                </form>
              ) : <Link className="btn small" href={resume.href}>{t(resume.label)}</Link>
            )}
          </div>
        )}
        {motive && !ok && stripeEnabled() && <p className="notice warn">{t("Pour {motive}, l'abonnement de l'organisation doit être activé", { motive: t(ENGAGING[motive]) })}{isAdmin ? "" : t(" par un administrateur")}.</p>}
        {freeSupplier && stripeEnabled() && <p className="notice ok">{t("Référencement gratuit : rien à payer avant votre premier devis retenu. L'abonnement prestataire ne sera demandé qu'ensuite, pour répondre à de nouvelles demandes.")}</p>}
        {sp.annule && <p className="notice">{t("Paiement interrompu : rien n'a été souscrit.")}</p>}

        <section className="card stack-sm">
          <div className="actions spread">
            <div>
              <h2>{t(PLANS[plan].label)}</h2>
              <p className="muted">{t("{montant} sans engagement, ou {montant2} ({freeMonths} mois offerts) ; premier mois offert.", { montant: formatPrice(PLANS[plan].cents, "month", t, loc), montant2: formatPrice(PLANS[plan].yearCents, "year", t, loc), freeMonths: freeMonths(plan) })}</p>
            </div>
            <span className={`pill ${tone}`}>{t(STATUS_LABEL[status])}</span>
          </div>
          <dl className="hero-facts">
            {status === "offerte" && <div><dt><Gift size={13} />{" "}{t("Offert jusqu'au")}</dt><dd>{fmtDate(locale, sub!.exemptUntil!)}<small>{sub!.exemptNote ?? t("accordé par KolBase")}</small></dd></div>}
            {sub?.status === "essai" && sub.trialEndsAt && <div><dt>{t("Mois offert jusqu'au")}</dt><dd>{fmtDate(locale, sub.trialEndsAt)}<small>{t("premier prélèvement ensuite")}</small></dd></div>}
            {sub?.status === "active" && sub.currentPeriodEnd && <div><dt>{t("Prochaine échéance")}</dt><dd>{fmtDate(locale, sub.currentPeriodEnd)}<small>{sub.cancelAtPeriodEnd ? t("résiliation programmée à cette date") : asInterval(sub.interval) === "year" ? t("renouvellement annuel") : t("renouvellement mensuel")}</small></dd></div>}
            {["essai", "active", "impayee"].includes(sub?.status ?? "") && <div><dt>{t("Formule")}</dt><dd>{asInterval(sub!.interval) === "year" ? t("Annuelle") : t("Mensuelle")}<small>{formatPrice(planPrice(plan, asInterval(sub!.interval)), asInterval(sub!.interval), t, loc)}</small></dd></div>}
            {sub?.triggeredAt && <div><dt>{t("Déclenché le")}</dt><dd>{fmtDate(locale, sub.triggeredAt)}<small>{sub.triggeredBy}</small></dd></div>}
          </dl>
          {isAdmin && stripeEnabled() && (
            <div className="actions">
              {!ok && !freeSupplier && (
                <form action={startSubscription} className="plan-choice">
                  <input type="hidden" name="orgId" value={id} />
                  {motive && <input type="hidden" name="motif" value={motive} />}
                  {motive && objet && <input type="hidden" name="objet" value={objet} />}
                  <div className="plan-option">
                    <strong>{t("Mensuel")}</strong>
                    <span className="plan-price">{formatPrice(PLANS[plan].cents, "month", t, loc)}</span>
                    <span className="text-sm muted">{t("Sans engagement, résiliable à tout moment.")}{sub?.trialUsed ? "" : ` ${t("{TRIAL_DAYS} jours offerts avant le premier prélèvement.", { TRIAL_DAYS })}`}</span>
                    <button className="btn secondary" name="interval" value="month"><CreditCard size={15} /> {sub?.trialUsed ? t("Réactiver l'abonnement mensuel") : t("Activer l'abonnement mensuel")}</button>
                  </div>
                  <div className="plan-option recommended">
                    <strong>{t("Annuel")}{" "}<span className="pill ok">{t("{freeMonths} mois offerts", { freeMonths: freeMonths(plan) })}</span></strong>
                    <span className="plan-price">{formatPrice(PLANS[plan].yearCents, "year", t, loc)}</span>
                    <span className="text-sm muted">{t("Soit {montant}, réglé en une fois.", { montant: formatPrice(monthlyCents(plan, "year"), "month", t, loc) })}{sub?.trialUsed ? "" : ` ${t("{TRIAL_DAYS} jours offerts avant le premier prélèvement.", { TRIAL_DAYS })}`}</span>
                    <button className="btn" name="interval" value="year"><CreditCard size={15} /> {sub?.trialUsed ? t("Réactiver l'abonnement annuel") : t("Activer l'abonnement annuel")}</button>
                  </div>
                </form>
              )}
              {sub?.stripeCustomerId && (
                <form action={openBillingPortal}>
                  <input type="hidden" name="orgId" value={id} />
                  <button className="btn ghost">{t("Moyen de paiement, factures, résiliation")}</button>
                </form>
              )}
            </div>
          )}
          {!isAdmin && !ok && !freeSupplier && stripeEnabled() && <p className="hint">{t("Seul un administrateur peut activer l'abonnement : {join}.", { join: admins.map((a) => `${a.user.firstName} ${a.user.lastName}`).join(", ") })}</p>}
          <p className="hint">{t("Paiement par carte ou prélèvement SEPA, facture envoyée par e-mail à chaque échéance (TVA en sus). Résiliable à tout moment, effet à la fin de la période en cours (mois ou année). En activant l'abonnement, vous acceptez les")}{" "}<Link href="/conditions-de-vente" target="_blank">{t("conditions générales de vente")}</Link>.</p>
        </section>

        {options.length > 0 && (
          <section className="card stack-sm" id="options">
            <SectionHead icon={Sparkles} title={t("Options")} />
            <p className="muted">{t("En plus de l'abonnement et à la même périodicité. Un administrateur les ajoute ou les retire à tout moment.")}</p>
            {wanted && sp.resultat === "added" && <p className="notice ok" role="status"><CheckCircle2 size={15} />{" "}{t("{option} est activée.", { option: ADDONS[wanted].label })}</p>}
            {wanted && sp.resultat === "removed" && <p className="notice" role="status">{t("{option} est retirée : la part non consommée de la période en cours sera déduite de votre prochaine facture.", { option: ADDONS[wanted].label })}</p>}
            {wanted && sp.resultat === "no_subscription" && <p className="notice warn" role="status">{t("Activez d'abord l'abonnement : l'option s'y ajoute ensuite.")}</p>}
            {wanted && sp.resultat === "error" && <p className="notice warn" role="alert">{t("L'option n'a pas pu être modifiée (paiement refusé ou service de paiement indisponible) : rien n'a changé. Vérifiez votre moyen de paiement, puis réessayez.")}</p>}
            {wanted && !sp.resultat && !addonSource(sub, wanted) && options.includes(wanted) && <p className="notice warn">{t("Cette page fait partie de l'option {option}.", { option: ADDONS[wanted].label })}</p>}
            <div className="plan-choice">
              {options.map((a) => {
                const source = addonSource(sub, a);
                const price = formatPrice(addonPrice(a, interval), interval, t, loc);
                return (
                  <div key={a} className={`plan-option${wanted === a && !source ? " recommended" : ""}`}>
                    <strong>{ADDONS[a].label}{source && <>{" "}<span className="pill ok">{source === "offerte" ? t("Offerte par KolBase") : t("Active")}</span></>}</strong>
                    <span className="plan-price">{price}</span>
                    <span className="text-sm muted">{t(ADDONS[a].pitch)}</span>
                    {source === "souscrite" && isAdmin && stripeEnabled() && (
                      <form action={toggleAddon}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="addon" value={a} />
                        <input type="hidden" name="on" value="0" />
                        <ConfirmButton className="btn ghost small" confirm={t("retirer l'option")} summary={t("{option} cesse aussitôt ; la part non consommée de la période en cours est déduite de votre prochaine facture.", { option: ADDONS[a].label })} localized>{t("Retirer l'option")}</ConfirmButton>
                      </form>
                    )}
                    {!source && isAdmin && stripeEnabled() && running && (
                      <form action={toggleAddon}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="addon" value={a} />
                        <input type="hidden" name="on" value="1" />
                        <ConfirmButton className="btn small" confirm={t("ajouter l'option")} summary={sub?.status === "essai" ? t("{price} en plus de l'abonnement, à partir de la fin de votre mois offert.", { price }) : t("{price} en plus de l'abonnement ; la période en cours est facturée aussitôt, au prorata des jours restants.", { price })} localized>{t("Ajouter l'option")}</ConfirmButton>
                      </form>
                    )}
                    {!source && !running && <span className="hint">{!stripeEnabled() || status === "offerte" ? t("Option activée par l'équipe KolBase : écrivez-nous depuis la page d'aide.") : isAdmin ? t("Activez d'abord l'abonnement ci-dessus : l'option s'y ajoute ensuite.") : t("Un administrateur active d'abord l'abonnement : l'option s'y ajoute ensuite.")}</span>}
                    {!source && running && !isAdmin && <span className="hint">{t("Seul un administrateur peut ajouter une option : {join}.", { join: admins.map((x) => `${x.user.firstName} ${x.user.lastName}`).join(", ") })}</span>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="card stack-sm">
          <SectionHead icon={PackageCheck} title={t("Ce qui est compris")} />
          {supplier ? (
            <ul className="plain check-list">
              <li><CheckCircle2 size={15} /> <span><strong>{t("Gratuit :")}</strong>{" "}{t("référencement dans l'annuaire, page prestataire, réception des demandes de devis et réponses jusqu'au premier devis retenu")}{won ? ` ${t("(vous en avez {won})", { won })}` : ""}.</span></li>
              <li><CheckCircle2 size={15} /> <span><strong>{t("Abonnement :")}</strong>{" "}{t("répondre à de nouvelles demandes après un premier devis retenu ; les prestations retenues et les échanges en cours restent toujours accessibles.")}</span></li>
              <li><CheckCircle2 size={15} /> <span>{t("Payer ne change jamais votre place dans l'annuaire.")}</span></li>
            </ul>
          ) : (
            <ul className="plain check-list">
              <li><CheckCircle2 size={15} /> <span><strong>{t("Gratuit :")}</strong>{" "}{t("création et validation de l'organisation, invitation de l'équipe, paramétrage, consultation de l'annuaire, brouillons.")}</span></li>
              <li><CheckCircle2 size={15} /> <span><strong>{t("L'abonnement démarre")}</strong>{" "}{t("à la première action qui engage un tiers : {join}.", { join: Object.values(ENGAGING).slice(0, 4).map((x) => t(x)).join(", ") })}</span></li>
              <li><CheckCircle2 size={15} /> <span>{t("Utilisateurs illimités ; agences mandatées sans surcoût.")}</span></li>
              <li><CheckCircle2 size={15} /> <span>{t("Dossiers, conventions, registres et déclarations restent toujours accessibles, même sans abonnement actif.")}</span></li>
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
