import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { platformAdminEmails, requirePlatformAdmin } from "@/lib/platform";
import { ORG_KIND_LABEL, VERIFICATION_LABEL } from "@/lib/org-roles";
import { formatDate, formatEUR } from "@/lib/events";
import { normalize } from "@/lib/search";
import { recheckSiren, reviewOrganization, reviewRpps } from "@/lib/admin-actions";
import { missingLegal } from "@/lib/legal";
import { mailEnabled } from "@/lib/mail";
import { storageEnabled } from "@/lib/storage";
import { orcidOAuth } from "@/lib/orcid";
import { signatureApiUrl, signatureEnabled, signatureSandbox, webhookSecret } from "@/lib/yousign";
import { Avatar } from "@/components/Avatar";
import { logoSrc } from "@/lib/logos";
import { aiEnabled } from "@/lib/ai";
import { displayStatus, exempt, PLANS, planFor, STATUS_LABEL } from "@/lib/billing-plans";
import { stripeEnabled } from "@/lib/billing";
import { setExemption } from "@/lib/billing-actions";
import { saveServiceOffer, updateServiceOrder } from "@/lib/service-actions";
import { ORDER_STATUS, orderStats, trackedPath } from "@/lib/services";
import { reportLine } from "@/lib/service-report";
import { country, licenseRule, practicesInFrance, registryLink } from "@/lib/countries";

export const metadata = { title: "Administration — KolBase" };
export const dynamic = "force-dynamic";

const TONE = { PENDING: "wait", VERIFIED: "ok", REJECTED: "bad" } as const;
/** Messageries grand public : un administrateur d'entreprise s'inscrit d'ordinaire avec l'adresse de la société. */
const PERSONAL_MAIL = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|gmx|laposte|orange|wanadoo|free|sfr|neuf|bbox|protonmail|proton)\./i;

/** Administration de la plateforme : validation des organisations (SIREN) et des praticiens (RPPS). */
export default async function Page({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  await requirePlatformAdmin();
  const o = (await searchParams).onglet;
  const onglet = o === "praticiens" || o === "lancement" || o === "actualites" || o === "abonnements" || o === "services" ? o : "organisations";

  const [orgs, rppsQueue, rppsDone] = await Promise.all([
    db.organization.findMany({
      include: { members: { where: { role: "ADMIN" }, include: { user: { select: { email: true, firstName: true, lastName: true } } }, take: 3, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    db.practitionerProfile.findMany({
      where: { OR: [{ rpps: { not: null } }, { licenseNumber: { not: null } }], rppsVerified: false, rppsCheckedAt: null },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
      orderBy: { updatedAt: "asc" },
    }),
    db.practitionerProfile.findMany({
      where: { rppsCheckedAt: { not: null } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { rppsCheckedAt: "desc" },
      take: 20,
    }),
  ]);
  const pending = orgs.filter((o) => o.verification === "PENDING");
  // Plusieurs organisations sur un même SIREN : doublon ou tentative d'usurpation, à examiner.
  const bySiren = new Map<string, typeof orgs>();
  for (const o of orgs) if (o.siren) bySiren.set(o.siren, [...(bySiren.get(o.siren) ?? []), o]);
  const groups = [
    ["À valider", pending],
    ["Refusées", orgs.filter((o) => o.verification === "REJECTED")],
    ["Validées", orgs.filter((o) => o.verification === "VERIFIED")],
  ] as const;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <h1>Administration KolBase</h1>
        <nav className="tabs">
          <Link href="?onglet=organisations" className={onglet === "organisations" ? "active" : ""}>Organisations ({pending.length} à valider)</Link>
          <Link href="?onglet=praticiens" className={onglet === "praticiens" ? "active" : ""}>Identités ({rppsQueue.length} à vérifier)</Link>
          <Link href="?onglet=services" className={onglet === "services" ? "active" : ""}>Services ({await db.serviceOrder.count({ where: { status: "demandee" } })} à traiter)</Link>
          <Link href="?onglet=abonnements" className={onglet === "abonnements" ? "active" : ""}>Abonnements</Link>
          <Link href="?onglet=actualites" className={onglet === "actualites" ? "active" : ""}>Actualités</Link>
          <Link href="?onglet=lancement" className={onglet === "lancement" ? "active" : ""}>Lancement</Link>
        </nav>

        {onglet === "organisations" &&
          groups.map(([title, list]) => (
            <section key={title} className="stack">
              <h2>{title} ({list.length})</h2>
              {list.length === 0 && <p className="muted">Aucune.</p>}
              {list.map((o) => {
                const mismatch = o.legalName && !normalize(o.legalName).includes(normalize(o.name)) && !normalize(o.name).includes(normalize(o.legalName));
                const twins = o.siren ? (bySiren.get(o.siren) ?? []).filter((x) => x.id !== o.id) : [];
                return (
                  <section key={o.id} className="card stack-sm">
                    <div className="actions spread">
                      <span className="actions" style={{ alignItems: "center" }}>
                        <Avatar name={o.name} size={44} square src={logoSrc(o)} />
                        <span>
                        <strong>{o.name}</strong> <span className={`pill ${TONE[o.verification]}`}>{VERIFICATION_LABEL[o.verification]}</span>
                        <br />
                        <span className="muted">{ORG_KIND_LABEL[o.kind]} · créée le {formatDate(o.createdAt)}{o.headquarters ? ` · ${o.headquarters}` : ""}</span>
                        </span>
                      </span>
                    </div>
                    <dl className="facts">
                      <dt>SIREN</dt>
                      <dd>
                        {o.siren ? (
                          <>
                            {o.siren}{" "}
                            <a href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${o.siren}`} target="_blank" rel="noreferrer">
                              Annuaire des entreprises <ExternalLink size={12} />
                            </a>
                          </>
                        ) : (
                          <span className="muted">non renseigné</span>
                        )}
                      </dd>
                      <dt>Répertoire</dt>
                      <dd>
                        {!o.siren ? "—" : !o.sirenCheckedAt ? "non contrôlé (répertoire indisponible)" : o.legalName ? `${o.legalName}${o.sirenActive === false ? " — FERMÉE" : o.sirenActive ? " — active" : ""}` : "SIREN introuvable"}
                        {mismatch && <span className="pill wait" style={{ marginLeft: 8 }}>Nom différent de la raison sociale</span>}
                      </dd>
                      {twins.length > 0 && (
                        <>
                          <dt>Même SIREN</dt>
                          <dd><span className="pill bad">Doublon possible</span> {twins.map((t) => `${t.name} (${VERIFICATION_LABEL[t.verification].toLowerCase()})`).join(", ")}</dd>
                        </>
                      )}
                      <dt>Administrateurs</dt>
                      <dd>
                        {o.members.map((m) => `${m.user.firstName} ${m.user.lastName} <${m.user.email}>`).join(", ") || "—"}
                        {o.members.some((m) => PERSONAL_MAIL.test(m.user.email)) && <span className="pill wait" style={{ marginLeft: 8 }}>Adresse personnelle</span>}
                      </dd>
                      {o.contactEmail && (<><dt>Contact</dt><dd>{o.contactEmail}</dd></>)}
                      {o.verificationNote && (<><dt>Note</dt><dd>{o.verificationNote}</dd></>)}
                    </dl>
                    <div className="actions wrap">
                      {o.verification !== "VERIFIED" && (
                        <form action={reviewOrganization} className="inline wrap">
                          <input type="hidden" name="orgId" value={o.id} />
                          <input name="note" placeholder="Note (facultatif pour valider, obligatoire pour refuser)" style={{ minWidth: 320 }} />
                          <button className="btn small" name="decision" value="verify">Valider</button>
                          {o.verification !== "REJECTED" && <button className="btn ghost small" name="decision" value="reject">Refuser</button>}
                        </form>
                      )}
                      {o.verification === "VERIFIED" && (
                        <form action={reviewOrganization} className="inline wrap">
                          <input type="hidden" name="orgId" value={o.id} />
                          <input name="note" placeholder="Motif de la suspension" />
                          <button className="btn ghost small" name="decision" value="suspend">Suspendre</button>
                        </form>
                      )}
                      {o.siren && (
                        <form action={recheckSiren}>
                          <input type="hidden" name="orgId" value={o.id} />
                          <button className="link">Relancer le contrôle du SIREN</button>
                        </form>
                      )}
                    </div>
                  </section>
                );
              })}
            </section>
          ))}

        {onglet === "actualites" && <NewsAdmin />}
        {onglet === "abonnements" && <BillingAdmin />}
        {onglet === "services" && <ServicesAdmin />}

        {onglet === "lancement" && (
          <LaunchChecklist
            demoOrgs={orgs.filter((x) => x.id.startsWith("demo-")).length}
            admins={await db.user.findMany({ where: { email: { in: platformAdminEmails() } }, select: { email: true, emailVerifiedAt: true } })}
          />
        )}

        {onglet === "praticiens" && (
          <>
            <p className="muted">
              Contrôlez chaque numéro sur le registre du pays d&apos;exercice (en France, l&apos;<a href="https://annuaire.sante.fr/" target="_blank" rel="noreferrer">Annuaire Santé <ExternalLink size={12} /></a>) :
              le nom, la profession et la situation d&apos;exercice doivent correspondre. Le badge « Identité vérifiée » s&apos;affiche dès la validation.
            </p>
            {rppsQueue.length === 0 && <p className="muted">Aucune identité en attente.</p>}
            {rppsQueue.map((p) => {
              const fr = practicesInFrance(p.country);
              const id = (fr ? p.rpps : p.licenseNumber) ?? "";
              const reg = registryLink(p.country);
              return (
              <section key={p.id} className="card actions spread">
                <span>
                  <strong>{p.user.firstName} {p.user.lastName}</strong> · {p.profession}{p.city ? ` · ${p.city}` : ""} · {country(p.country).name}{p.listed ? " · expert référencé" : ""}
                  <br />
                  <span className="muted">
                    {fr ? "RPPS" : licenseRule(p.country).label} <span className="mono">{id}</span> · {p.user.email}
                    {reg.url && <> · <a href={reg.url} target="_blank" rel="noreferrer">{reg.label} <ExternalLink size={12} /></a></>}
                  </span>
                </span>
                <form action={reviewRpps} className="inline wrap">
                  <input type="hidden" name="practitionerId" value={p.id} />
                  <input type="hidden" name="identifier" value={id} />
                  <input name="note" placeholder="Motif (obligatoire pour refuser)" />
                  <button className="btn small" name="decision" value="verify">Valider</button>
                  <button className="btn ghost small" name="decision" value="reject">Refuser</button>
                </form>
              </section>
              );
            })}
            {rppsDone.length > 0 && (
              <section className="card">
                <h2>Derniers contrôles</h2>
                <ul className="pub-list">
                  {rppsDone.map((p) => (
                    <li key={p.id}>
                      <strong>{p.user.firstName} {p.user.lastName}</strong>
                      <span className="text-xs">
                        {practicesInFrance(p.country) ? `RPPS ${p.rpps}` : `${country(p.country).name} · ${p.licenseNumber}`} · {p.rppsVerified ? "validé" : `refusé${p.rppsCheckNote ? ` : ${p.rppsCheckNote}` : ""}`} le {formatDate(p.rppsCheckedAt!)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

/** État de la configuration en production (lecture seule) : ce qui reste à faire avant l'ouverture. */
async function ServicesAdmin() {
  const [orders, offers, audience] = await Promise.all([
    db.serviceOrder.findMany({ include: { event: { select: { id: true, title: true, startsAt: true } }, organization: { select: { name: true } }, offer: { select: { kind: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.serviceOffer.findMany({ orderBy: { position: "asc" } }),
    db.user.count({ where: { notifyPrefs: { path: ["newsletter"], equals: true }, emailVerifiedAt: { not: null } } }),
  ]);
  const open = orders.filter((o) => ["demandee", "planifiee"].includes(o.status));
  const done = orders.filter((o) => !["demandee", "planifiee"].includes(o.status));
  const toInvoice = done.filter((o) => o.status === "realisee" && !o.invoicedAt && o.priceCents > 0);
  const realized = orders.filter((o) => o.status === "realisee");
  const stats = await orderStats(orders.filter((o) => o.status !== "refusee" && o.status !== "annulee"));
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const Row = ({ o }: { o: (typeof orders)[number] }) => (
    <li className="card stack-sm">
      <div className="actions spread">
        <div>
          <strong>{o.label}</strong> · {formatEUR(o.priceCents)} HT · <span className={`pill ${ORDER_STATUS[o.status]?.tone ?? ""}`}>{ORDER_STATUS[o.status]?.label}</span>
          <div className="text-sm muted">{o.organization.name} · « <Link href={`/evenements/${o.event.id}`}>{o.event.title}</Link> » du {formatDate(o.event.startsAt)} · commandé le {formatDate(o.createdAt)}{o.wishedAt ? ` · souhaité le ${formatDate(o.wishedAt)}` : ""}</div>
          {o.brief && <p className="text-sm">« {o.brief} »</p>}
          {o.adminNote && <p className="text-xs muted">{o.adminNote}</p>}
          {o.status === "realisee" && <p className="text-xs muted">{o.invoicedAt ? `Facturé (${o.invoiceRef})` : o.invoiceRef ?? "À facturer"}</p>}
          {o.trackCode && o.offer.kind !== "newsletter" && ["demandee", "planifiee"].includes(o.status) && <p className="text-xs">Lien suivi à utiliser : <code>{app}{trackedPath(o.trackCode)}</code></p>}
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
            <h2>Commandes à traiter ({open.length})</h2>
            <p className="text-sm muted">{realized.length} service{realized.length > 1 ? "s" : ""} réalisé{realized.length > 1 ? "s" : ""} pour {formatEUR(realized.reduce((n, o) => n + o.priceCents, 0))} HT.</p>
          </div>
          <Link className="btn ghost small" href="/admin/services/lettre">Lettre d&apos;information libre ({audience} abonné{audience > 1 ? "s" : ""})</Link>
        </div>
        {open.length === 0 ? <p className="muted">Aucune commande en attente.</p> : <ul className="plain stack-sm">{open.map((o) => <Row key={o.id} o={o} />)}</ul>}
        {toInvoice.length > 0 && <p className="notice warn">{toInvoice.length} service{toInvoice.length > 1 ? "s" : ""} réalisé{toInvoice.length > 1 ? "s" : ""} à facturer hors Stripe.</p>}
        {done.length > 0 && (
          <details className="older"><summary>Commandes traitées ({done.length})</summary><ul className="plain stack-sm">{done.map((o) => <Row key={o.id} o={o} />)}</ul></details>
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

async function BillingAdmin() {
  const orgs = await db.organization.findMany({ where: { verification: "VERIFIED" }, select: { id: true, name: true, kind: true, subscription: true }, orderBy: { name: "asc" } });
  const now = new Date();
  const paying = orgs.filter((o) => ["essai", "active", "impayee"].includes(o.subscription?.status ?? "") && !exempt(o.subscription, now));
  const mrr = paying.filter((o) => o.subscription!.status !== "essai").reduce((s, o) => s + PLANS[planFor(o.kind)].cents, 0);
  return (
    <section className="card stack-sm">
      <h2>Abonnements</h2>
      <p className="muted">
        {stripeEnabled() ? "Facturation active (Stripe)." : "Facturation inactive : STRIPE_SECRET_KEY non défini, toutes les fonctions sont accessibles."}{" "}
        {paying.length} abonnement{paying.length > 1 ? "s" : ""} en cours, revenu mensuel hors essais : {formatEUR(mrr)} HT.
      </p>
      <table className="table" tabIndex={0}>
        <thead><tr><th>Organisation</th><th>Offre</th><th>Statut</th><th>Échéance</th><th>Gratuité</th></tr></thead>
        <tbody>
          {orgs.map((o) => {
            const st = displayStatus(o.subscription, now);
            return (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td>{PLANS[planFor(o.kind)].label.replace("Abonnement ", "")}</td>
                <td><span className={`pill ${["active", "essai", "offerte"].includes(st) ? "ok" : st === "impayee" ? "wait" : ""}`}>{STATUS_LABEL[st]}</span>{o.subscription?.triggeredAt ? <div className="text-xs muted">{o.subscription.triggeredBy}</div> : null}</td>
                <td>{o.subscription?.trialEndsAt && o.subscription.status === "essai" ? `essai → ${formatDate(o.subscription.trialEndsAt)}` : o.subscription?.currentPeriodEnd ? formatDate(o.subscription.currentPeriodEnd) : "—"}</td>
                <td>
                  <form action={setExemption} className="inline wrap">
                    <input type="hidden" name="orgId" value={o.id} />
                    {exempt(o.subscription, now) ? (
                      <><span className="text-xs">jusqu&apos;au {formatDate(o.subscription!.exemptUntil!)}{o.subscription!.exemptNote ? ` · ${o.subscription!.exemptNote}` : ""}</span><input type="hidden" name="remove" value="1" /><button className="link">retirer</button></>
                    ) : (
                      <><input type="date" name="until" aria-label="Offert jusqu'au" required /><input name="note" placeholder="Motif" aria-label="Motif" /><button className="link">offrir</button></>
                    )}
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

async function NewsAdmin() {
  const articles = await db.article.findMany({ select: { id: true, slug: true, title: true, category: true, publishedAt: true, updatedAt: true }, orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { updatedAt: "desc" }] });
  return (
    <section className="card stack-sm">
      <div className="actions spread">
        <h2>Actualités ({articles.length})</h2>
        <Link className="btn small" href="/admin/actualites/nouveau">Nouvelle actualité</Link>
      </div>
      <p className="muted">Publiées dans la rubrique « Actualités » et sur la page d&apos;accueil (les trois plus récentes).</p>
      {articles.length === 0 ? <p className="muted">Aucune actualité.</p> : (
        <table className="table" tabIndex={0}>
          <thead><tr><th>Titre</th><th>Rubrique</th><th>Statut</th><th>Mise à jour</th></tr></thead>
          <tbody>
            {articles.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/admin/actualites/${a.id}`}>{a.title}</Link></td>
                <td>{a.category}</td>
                <td><span className={`pill ${a.publishedAt ? "ok" : "wait"}`}>{a.publishedAt ? `Publiée le ${formatDate(a.publishedAt)}` : "Brouillon"}</span></td>
                <td>{formatDate(a.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function LaunchChecklist({ demoOrgs, admins }: { demoOrgs: number; admins: { email: string; emailVerifiedAt: Date | null }[] }) {
  const unconfirmed = admins.filter((a) => !a.emailVerifiedAt).map((a) => a.email);
  const missing = platformAdminEmails().filter((e) => !admins.some((a) => a.email.toLowerCase() === e));
  const legalGaps = missingLegal();
  const esign = signatureEnabled();
  const esignDetail = !esign
    ? "Non configurée : les conventions se signent sur papier puis se déposent dans le dossier."
    : [
        signatureSandbox() ? `Environnement de test (${signatureApiUrl()}) : les signatures n'ont pas de valeur juridique.` : "Yousign, environnement de production.",
        webhookSecret()
          ? `Webhook signé configuré (${process.env.APP_URL ?? "<APP_URL>"}/api/signature/webhook).`
          : `YOUSIGN_WEBHOOK_SECRET absent : déclarer le webhook ${process.env.APP_URL ?? "<APP_URL>"}/api/signature/webhook chez Yousign, sinon le statut se met à jour à la main depuis chaque dossier.`,
      ].join(" ");
  const items: { ok: boolean; optional?: boolean; label: string; detail: string }[] = [
    {
      ok: missing.length === 0 && unconfirmed.length === 0,
      label: "Administrateurs KolBase (PLATFORM_ADMIN_EMAILS)",
      detail: [
        missing.length ? `Sans compte : ${missing.join(", ")} (à créer sans tarder : une adresse listée et libre pourrait être prise).` : "",
        unconfirmed.length ? `Adresse à confirmer : ${unconfirmed.join(", ")} (exigé dès que les e-mails sont configurés).` : "",
      ].filter(Boolean).join(" ") || "Comptes créés et adresses confirmées.",
    },
    { ok: !!process.env.APP_URL, label: "Adresse du site (APP_URL)", detail: process.env.APP_URL || "Non définie : les liens des e-mails et du plan du site sont incomplets." },
    { ok: mailEnabled(), label: "Envoi d'e-mails (SMTP_URL, MAIL_FROM)", detail: mailEnabled() ? `Expéditeur : ${process.env.MAIL_FROM ?? "par défaut"}` : "Non configuré : aucun e-mail n'est envoyé (mot de passe oublié, notifications)." },
    { ok: storageEnabled(), label: "Stockage des documents (S3_*)", detail: storageEnabled() ? `Compartiment : ${process.env.S3_BUCKET}` : "Non configuré : le dépôt de documents est désactivé." },
    { ok: esign && !!webhookSecret() && !signatureSandbox(), optional: !esign, label: "Signature électronique (YOUSIGN_*, facultatif)", detail: esignDetail },
    { ok: !!process.env.CRON_SECRET, label: "Tâches planifiées (CRON_SECRET, service cron kolbase-taches)", detail: process.env.CRON_SECRET ? "Configurées : rappels de la veille, attestations et questionnaires, purge des sessions expirées (toutes les heures)." : "Non configurées : synchroniser le Blueprint Render (service cron) ; ni rappels ni envois après les événements." },
    { ok: stripeEnabled() && !!process.env.STRIPE_WEBHOOK_SECRET, label: "Facturation (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)", detail: stripeEnabled() ? (process.env.STRIPE_WEBHOOK_SECRET ? `Active${process.env.STRIPE_TAX_RATE ? ", TVA appliquée" : " (STRIPE_TAX_RATE à définir pour la TVA)"}. Notifications : <APP_URL>/api/stripe/webhook.` : "Clé définie mais secret des notifications manquant : déclarer <APP_URL>/api/stripe/webhook chez Stripe.") : "Inactive : abonnements non facturés, toutes les fonctions accessibles." },
    { ok: aiEnabled(), optional: true, label: "Assistant d'IA (ANTHROPIC_API_KEY, facultatif)", detail: aiEnabled() ? `Actif (modèle ${process.env.ANTHROPIC_MODEL ?? "par défaut"}).` : "Non configuré : brouillons, suggestion d'experts (sans résumé) et relecture assistée indisponibles." },
    { ok: !!orcidOAuth(), optional: true, label: "Connexion ORCID (facultatif)", detail: orcidOAuth() ? "Active." : "Non configurée : l'iD ORCID se saisit à la main." },
    { ok: legalGaps.length === 0, label: "Textes légaux (src/lib/legal.ts)", detail: legalGaps.length ? `À compléter : ${legalGaps.join(", ")}.` : "Complets." },
    { ok: process.env.SEED_DEMO !== "1", label: "Rechargement de la démo (SEED_DEMO)", detail: process.env.SEED_DEMO === "1" ? "Actif : la démo est rechargée à chaque déploiement. Passer à 0 avant l'ouverture." : "Désactivé." },
    { ok: demoOrgs === 0, label: "Données de démonstration", detail: demoOrgs ? `${demoOrgs} organisations fictives présentes : npm run db:purge-demo -- --confirmer (shell Render).` : "Aucune." },
  ];
  return (
    <section className="card stack-sm">
      <h2>Avant l&apos;ouverture au public</h2>
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
