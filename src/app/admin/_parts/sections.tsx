import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate, formatEUR } from "@/lib/events";
import { asInterval, displayStatus, exempt, monthlyCents, PLANS, planFor, STATUS_LABEL } from "@/lib/billing-plans";
import { stripeEnabled } from "@/lib/billing";
import { setExemption } from "@/lib/billing-actions";
import { saveServiceOffer, updateServiceOrder } from "@/lib/service-actions";
import { featuredUntil, newsletterAudienceCount, newsletterSendsThisMonth, ORDER_STATUS, orderStats, trackedPath } from "@/lib/services";
import { groupOrders, packItemStatus, packStatus } from "@/lib/service-pack";
import { NEWSLETTER_MONTHLY_MAX, parisMonthLabel } from "@/lib/newsletter";
import { reportLine } from "@/lib/service-report";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ExemptionOffer } from "@/components/AdminForms";
import { TableWrap } from "@/components/TableWrap";
import type { LaunchItem } from "@/lib/admin-data";

/** Services KolBase : commandes à traiter, lettre d'information, catalogue. */
export async function ServicesAdmin() {
  const [orders, offers, audience, sends, campaigns] = await Promise.all([
    db.serviceOrder.findMany({ include: { event: { select: { id: true, title: true, startsAt: true } }, organization: { select: { name: true } }, offer: { select: { kind: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.serviceOffer.findMany({ orderBy: { position: "asc" } }),
    newsletterAudienceCount(),
    newsletterSendsThisMonth(),
    db.newsletterCampaign.findMany({
      include: { order: { select: { label: true, organization: { select: { name: true } }, event: { select: { id: true, title: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const done = orders.filter((o) => !["demandee", "planifiee"].includes(o.status));
  const toInvoice = done.filter((o) => o.status === "realisee" && !o.invoicedAt && o.priceCents > 0);
  const realized = orders.filter((o) => o.status === "realisee");
  const stats = await orderStats(orders.filter((o) => o.status !== "refusee" && o.status !== "annulee"));
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const now = new Date();
  // Services d'un même pack regroupés : « Pack visibilité — 990 € HT », détail repliable (actions par service).
  const groups = groupOrders(orders);
  const isOpen = (o: (typeof orders)[number]) => ["demandee", "planifiee"].includes(o.status);
  const openGroups = groups.filter((g) => g.orders.some(isOpen));
  const doneGroups = groups.filter((g) => !g.orders.some(isOpen));
  const Group = ({ g, unfold }: { g: (typeof groups)[number]; unfold: boolean }) => {
    if (!g.pack) return <Row o={g.orders[0]} />;
    const first = g.orders[0];
    const ps = packStatus(g.orders.map((o) => packItemStatus(o, now)));
    return (
      <li className="card stack-sm service-pack-group">
        <div>
          <strong>{g.pack} — {formatEUR(g.orders.reduce((n, o) => n + o.priceCents, 0))} HT</strong> ·{" "}
          <span className={`pill ${ps.status === "en_cours" ? "electric" : ORDER_STATUS[ps.status]?.tone ?? ""}`}>{ps.status === "en_cours" ? (ps.done === ps.total ? "Réalisé · mise à la une en cours" : `En cours (${ps.done} sur ${ps.total} réalisé${ps.done > 1 ? "s" : ""})`) : ORDER_STATUS[ps.status]?.label}</span>
          <div className="text-sm muted">{first.organization.name} · « <Link href={`/evenements/${first.event.id}`}>{first.event.title}</Link> » du {formatDate(first.event.startsAt)} · commandé le {formatDate(first.createdAt)}</div>
          {first.brief && <p className="text-sm">« {first.brief} »</p>}
        </div>
        <details className="older" open={unfold}>
          <summary>Détail des {g.orders.length} services du pack</summary>
          <ul className="plain stack-sm">{g.orders.map((o) => <Row key={o.id} o={o} />)}</ul>
        </details>
      </li>
    );
  };
  const Row = ({ o }: { o: (typeof orders)[number] }) => (
    <li className="card stack-sm">
      <div className="actions spread">
        <div>
          <strong>{o.label}</strong> · {formatEUR(o.priceCents)} HT{o.packLabel ? <span className="text-xs muted"> (part du pack)</span> : null} ·{" "}
          {featuredUntil(o, now) ? <span className="pill electric">En cours jusqu&apos;au {formatDate(featuredUntil(o, now)!)}</span> : <span className={`pill ${ORDER_STATUS[o.status]?.tone ?? ""}`}>{ORDER_STATUS[o.status]?.label}</span>}
          <div className="text-sm muted">{o.organization.name} · « <Link href={`/evenements/${o.event.id}`}>{o.event.title}</Link> » du {formatDate(o.event.startsAt)} · commandé le {formatDate(o.createdAt)}{o.wishedAt ? ` · souhaité le ${formatDate(o.wishedAt)}` : ""}</div>
          {o.brief && <p className="text-sm">« {o.brief} »</p>}
          {o.adminNote && <p className="text-xs muted">{o.adminNote}</p>}
          {o.status === "realisee" && <p className="text-xs muted">{o.invoicedAt ? `Facturé (${o.invoiceRef})` : o.invoiceRef ?? "À facturer"}</p>}
          {/* Lien à placer soi-même (post) ; l'e-mailing et la mise à la une de l'accueil l'utilisent d'eux-mêmes. */}
          {o.trackCode && o.offer.kind === "social" && ["demandee", "planifiee"].includes(o.status) && <p className="text-xs">Lien suivi à utiliser : <code>{app}{trackedPath(o.trackCode)}</code></p>}
          {stats.get(o.id) && (o.status === "realisee" || stats.get(o.id)!.clicks > 0) && (
            <p className="text-xs service-stats">Bilan : {reportLine(stats.get(o.id)!, o.offer.kind)}{o.reportSentAt ? ` · bilan envoyé le ${formatDate(o.reportSentAt)}` : ""}</p>
          )}
        </div>
        {["newsletter", "social"].includes(o.offer.kind) && ["demandee", "planifiee"].includes(o.status) && <Link className="btn small" href={`/admin/services/${o.id}`}>{o.offer.kind === "newsletter" ? "Préparer l'e-mailing" : "Préparer le post"}</Link>}
      </div>
      {["demandee", "planifiee"].includes(o.status) && (
        <div className="actions" style={{ marginTop: 0 }}>
          <form action={updateServiceOrder} className="inline wrap"><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="action" value="plan" /><input type="date" name="plannedAt" required aria-label="Date de réalisation" /><button className="link">planifier</button></form>
          {o.offer.kind !== "newsletter" && <form action={updateServiceOrder} className="inline wrap"><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="action" value="done" /><input name="resultUrl" placeholder="Lien du résultat (facultatif)" aria-label="Lien du résultat" /><button className="link">marquer réalisé</button></form>}
          <form action={updateServiceOrder} className="inline wrap"><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="action" value="refuse" /><input name="note" placeholder="Motif du refus" aria-label="Motif du refus" required /><button className="link danger">refuser</button></form>
        </div>
      )}
      {o.status === "realisee" && !o.invoicedAt && o.priceCents > 0 && (
        <form action={updateServiceOrder} className="inline wrap"><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="action" value="invoiced" /><input name="note" placeholder="Réf. de facture" aria-label="Référence de facture" /><button className="link">marquer facturé</button></form>
      )}
    </li>
  );
  return (
    <>
      <section className="stack-sm">
        <div className="actions spread">
          <div>
            {/* Une commande = un service, ou un pack (ses services regroupés) : le compteur suit la liste affichée. */}
            <h2>Commandes à traiter ({openGroups.length})</h2>
            <p className="text-sm muted">{realized.length} service{realized.length > 1 ? "s" : ""} réalisé{realized.length > 1 ? "s" : ""} pour {formatEUR(realized.reduce((n, o) => n + o.priceCents, 0))} HT.</p>
          </div>
          <Link className="btn ghost small" href="/admin/services/lettre">Lettre d&apos;information libre ({audience} praticien{audience > 1 ? "s" : ""} abonné{audience > 1 ? "s" : ""})</Link>
        </div>
        {openGroups.length === 0 ? <p className="muted">Aucune commande en attente.</p> : <ul className="plain stack-sm">{openGroups.map((g) => <Group key={g.orders[0].id} g={g} unfold />)}</ul>}
        {toInvoice.length > 0 && <p className="notice warn">{toInvoice.length} service{toInvoice.length > 1 ? "s" : ""} réalisé{toInvoice.length > 1 ? "s" : ""} à facturer hors Stripe.</p>}
        {doneGroups.length > 0 && (
          <details className="older"><summary>Commandes traitées ({doneGroups.length})</summary><ul className="plain stack-sm">{doneGroups.map((g) => <Group key={g.orders[0].id} g={g} unfold={false} />)}</ul></details>
        )}
      </section>
      <section className="card stack-sm" id="lettre">
        <div className="actions spread">
          <h2>Lettre d&apos;information</h2>
          <span className={`pill ${sends >= NEWSLETTER_MONTHLY_MAX ? "bad" : "ok"}`}>{sends} envoi{sends > 1 ? "s" : ""} sur {NEWSLETTER_MONTHLY_MAX} en {parisMonthLabel()}</span>
        </div>
        <p className="muted">
          {audience} praticien{audience > 1 ? "s" : ""} abonné{audience > 1 ? "s" : ""} (compte praticien, lettre acceptée, adresse confirmée). Au plus {NEWSLETTER_MONTHLY_MAX} envois par mois civil,
          e-mailings commandés et lettres libres confondus : au-delà, l&apos;envoi est refusé.
        </p>
        {campaigns.length === 0 ? <p className="muted">Aucun envoi pour l&apos;instant.</p> : (
          <TableWrap label="Lettre d'information">
            <table className="table">
              <thead><tr><th>Date</th><th>Objet</th><th>Destinataires</th><th>Commande liée</th></tr></thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Date">{c.sentAt ? formatDate(c.sentAt) : "envoi en cours"}</td>
                    <td data-label="Objet">{c.subject}</td>
                    <td data-label="Destinataires">{c.recipients}</td>
                    <td data-label="Commande liée">{c.order ? <>{c.order.label} · {c.order.organization.name} · <Link href={`/evenements/${c.order.event.id}`}>{c.order.event.title}</Link></> : "Lettre libre"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
      <section className="card stack-sm">
        <h2>Catalogue des services</h2>
        <p className="muted">Proposés aux organisateurs sur chaque événement publié. Le prix est figé à la commande.</p>
        {offers.map((f) => (
          <form key={f.id} action={saveServiceOffer} className="form offer-admin">
            <input type="hidden" name="id" value={f.id} />
            <div className="row">
              <label>Libellé<input name="label" defaultValue={f.label} required maxLength={120} /></label>
              <label>Prix HT (€)<input name="price" defaultValue={String(f.priceCents / 100)} inputMode="decimal" required /></label>
              <label>Ordre<input name="position" type="number" defaultValue={f.position} /></label>
            </div>
            <label>Description<textarea name="description" rows={2} defaultValue={f.description} /></label>
            {f.kind === "pack" && <p className="hint">Pack : {f.includes.map((c) => offers.find((x) => x.code === c)?.label ?? c).join(", ")} (séparément : {formatEUR(offers.filter((x) => f.includes.includes(x.code)).reduce((n, x) => n + x.priceCents, 0))} HT). Le prix du pack est réparti entre ces services au prorata et facturé au fil des réalisations.</p>}
            <div className="actions" style={{ marginTop: 0 }}>
              <label className="check"><input type="checkbox" name="active" defaultChecked={f.active} /> Proposé</label>
              <button className="btn small secondary">Enregistrer</button>
            </div>
          </form>
        ))}
        <details className="older">
          <summary>Ajouter un service</summary>
          <form action={saveServiceOffer} className="form">
            <div className="row">
              <label>Libellé<input name="label" required maxLength={120} /></label>
              <label>Prix HT (€)<input name="price" inputMode="decimal" required /></label>
              <label>Type
                <select name="kind" defaultValue="autre"><option value="newsletter">E-mailing aux membres</option><option value="social">Réseaux sociaux</option><option value="une">À la une de l&apos;accueil</option><option value="autre">Autre</option></select>
              </label>
            </div>
            <label>Description<textarea name="description" rows={2} /></label>
            <input type="hidden" name="active" value="on" />
            <button className="btn small">Ajouter</button>
          </form>
        </details>
      </section>
    </>
  );
}

/** Abonnements des organisations : statut, échéance, gratuité accordée par KolBase. */
export async function BillingAdmin() {
  const orgs = await db.organization.findMany({ where: { verification: { in: ["VERIFIED", "SUSPENDED"] } }, select: { id: true, name: true, kind: true, verification: true, subscription: true }, orderBy: { name: "asc" } });
  const now = new Date();
  // Gratuité : aujourd'hui au plus tôt (date de Paris).
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const paying = orgs.filter((o) => ["essai", "active", "impayee"].includes(o.subscription?.status ?? "") && !exempt(o.subscription, now));
  // Revenu mensuel récurrent : une formule annuelle compte pour un douzième.
  const mrr = paying.filter((o) => o.subscription!.status !== "essai").reduce((s, o) => s + monthlyCents(planFor(o.kind), asInterval(o.subscription!.interval)), 0);
  return (
    <section className="card stack-sm">
      <h2>Abonnements</h2>
      <p className="muted">
        {stripeEnabled() ? "Facturation active (Stripe)." : "Facturation inactive : STRIPE_SECRET_KEY non défini, toutes les fonctions sont accessibles."}{" "}
        {paying.length} abonnement{paying.length > 1 ? "s" : ""} en cours, revenu mensuel hors essais : {formatEUR(mrr)} HT.
      </p>
      <p className="hint scroll-hint">Tableau plus large que l&apos;écran : faites-le défiler vers la droite pour la colonne Gratuité.</p>
      <TableWrap label="Abonnements des organisations">
        <table className="table">
          <thead><tr><th>Organisation</th><th>Offre</th><th>Statut</th><th>Échéance</th><th>Gratuité</th></tr></thead>
          <tbody>
            {orgs.map((o) => {
              const st = displayStatus(o.subscription, now);
              return (
                <tr key={o.id}>
                  <td data-label="Organisation">{o.name}</td>
                  <td data-label="Offre">{PLANS[planFor(o.kind)].label.replace("Abonnement ", "")}{o.subscription && ["essai", "active", "impayee"].includes(o.subscription.status) ? <div className="text-xs muted">{asInterval(o.subscription.interval) === "year" ? "annuel" : "mensuel"}</div> : null}</td>
                  <td data-label="Statut"><span className={`pill ${["active", "essai", "offerte"].includes(st) ? "ok" : st === "impayee" ? "wait" : ""}`}>{STATUS_LABEL[st]}</span>{o.subscription?.triggeredAt ? <div className="text-xs muted">{o.subscription.triggeredBy}</div> : null}</td>
                  <td data-label="Échéance">{o.subscription?.trialEndsAt && o.subscription.status === "essai" ? `essai → ${formatDate(o.subscription.trialEndsAt)}` : o.subscription?.currentPeriodEnd ? formatDate(o.subscription.currentPeriodEnd) : "—"}</td>
                  <td data-label="Gratuité">
                    {exempt(o.subscription, now) ? (
                      <form action={setExemption} className="inline wrap">
                        <input type="hidden" name="orgId" value={o.id} />
                        <span className="text-xs">jusqu&apos;au {formatDate(o.subscription!.exemptUntil!)}{o.subscription!.exemptNote ? ` · ${o.subscription!.exemptNote}` : ""}</span>
                        <input type="hidden" name="remove" value="1" />
                        <ConfirmButton className="link" confirm="retirer la gratuité" summary={<>{o.name} est prévenue par e-mail ; {o.subscription?.stripeSubscriptionId && ["active", "essai", "impayee"].includes(o.subscription.status) ? (o.verification === "SUSPENDED" ? "la facturation de son abonnement Stripe reste en pause pendant la suspension." : "la facturation de son abonnement Stripe reprend.") : "pour continuer à agir, un administrateur devra activer l'abonnement."}</>}>
                          retirer
                        </ConfirmButton>
                      </form>
                    ) : (
                      <ExemptionOffer orgId={o.id} min={today} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </section>
  );
}

/** Actualités : brouillons et articles publiés. */
export async function NewsAdmin() {
  const articles = await db.article.findMany({ select: { id: true, slug: true, title: true, category: true, publishedAt: true, updatedAt: true }, orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { updatedAt: "desc" }] });
  return (
    <section className="card stack-sm">
      <div className="actions spread">
        <h2>Actualités ({articles.length})</h2>
        <Link className="btn small" href="/admin/actualites/nouveau">Nouvelle actualité</Link>
      </div>
      <p className="muted">Publiées dans la rubrique « Actualités » et sur la page d&apos;accueil (les trois plus récentes).</p>
      {articles.length === 0 ? <p className="muted">Aucune actualité.</p> : (
        <TableWrap label="Actualités">
          <table className="table">
            <thead><tr><th>Titre</th><th>Rubrique</th><th>Statut</th><th>Mise à jour</th></tr></thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id}>
                  <td data-label="Titre"><Link href={`/admin/actualites/${a.id}`}>{a.title}</Link></td>
                  <td data-label="Rubrique">{a.category}</td>
                  <td data-label="Statut"><span className={`pill ${a.publishedAt ? "ok" : "wait"}`}>{a.publishedAt ? `Publiée le ${formatDate(a.publishedAt)}` : "Brouillon"}</span></td>
                  <td data-label="Mise à jour">{formatDate(a.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </section>
  );
}

/** Avant l'ouverture au public : chaque prérequis, OK, à faire ou facultatif. */
export function LaunchChecklist({ items }: { items: LaunchItem[] }) {
  const left = items.filter((i) => !i.ok && !i.optional).length;
  return (
    <section className="card stack-sm" id="lancement">
      <h2>Avant l&apos;ouverture au public</h2>
      <p className={left ? "notice warn" : "muted"}>{left ? `${left} prérequis encore à faire.` : "Tous les prérequis sont remplis."}</p>
      <ul className="pub-list">
        {items.map((i) => (
          <li key={i.label}>
            <strong>
              <span className={`pill ${i.ok ? "ok" : i.optional ? "done" : "wait"}`}>{i.ok ? "OK" : i.optional ? "Facultatif" : "À faire"}</span> {i.label}
            </strong>
            <span className="text-xs">{i.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
