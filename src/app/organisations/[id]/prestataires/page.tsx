import { PageHead, EmptyState, SectionHead } from "@/components/UI";
import { aiEnabled } from "@/lib/ai";
import Link from "next/link";
import { ArrowLeft, Ban, CheckCircle2, FilePen, Hourglass, Info, Plus, Receipt, Scale, Star, Store } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { Avatar } from "@/components/Avatar";
import { CategoryIcon } from "@/components/SupplierBits";
import { NewRfqForm } from "@/components/RfqForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventEnded, eventScope } from "@/lib/events";
import { RFQ_STATUS, rfqDisplayStatus, rfqGroup, SUPPLIER_CATEGORIES, supplierCategoryLabel, type RfqGroup } from "@/lib/suppliers";
import { endMandate, setMandateAward } from "@/lib/event-actions";
import { quoteTtc } from "@/lib/quotes";
import { orgRfqs, supplierDirectory, type DirectorySupplier, type OrgRfq } from "@/lib/rfq-org";
import { CAPACITY_LABEL, OFFER_UNITS, photoSrc, readCapacities } from "@/lib/supplier-book";
import { logoSrc } from "@/lib/logos";
import { BillingNotice } from "@/components/BillingNotice";
import { engagementBlock } from "@/lib/billing";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, type Locale, type T } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Prestataires")} — KolBase` };
}

const DAY = 864e5;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; evenement?: string; cat?: string; prestataire?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { evenement, cat, prestataire } = await searchParams;
  const onglet = (await searchParams).onglet ?? (evenement || prestataire ? "nouvelle" : "demandes");
  const { user, roles } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const base = `/organisations/${id}`;
  const scope = eventScope(user, roles);
  const blocked = await engagementBlock(id, "devis");

  const { rfqs, mandates, creators, isOrganizer, now } = await orgRfqs(id, user, roles);
  // Une agence ne se consulte pas elle-même pour le compte du client.
  const ownIds = user.memberships.map((m) => m.organizationId);
  const [suppliers, events] = await Promise.all([
    supplierDirectory(ownIds),
    onglet === "nouvelle" ? db.event.findMany({ where: { organizationId: id, ...scope, startsAt: { gte: now } }, orderBy: { startsAt: "asc" } }) : Promise.resolve([]),
  ]);
  const awarded = rfqs.filter((r) => r.status === "awarded");
  // Montants retenus visibles seulement (une agence consultée ne voit pas celui d'un concurrent).
  const engaged = awarded.reduce((s, r) => s + (r.quotes.find((q) => q.status === "retained")?.amountCents ?? 0), 0);
  const toDecide = rfqs.filter((r) => rfqGroup(r) === "decide").length;
  const tabs = [
    ["demandes", t("Demandes de devis ({n})", { n: rfqs.length })],
    ["annuaire", t("Annuaire ({n})", { n: suppliers.length })],
    ...(isOrganizer ? [["agences", t("Agences mandatées ({mandates})", { mandates: mandates.length })] as const] : []),
  ] as const;
  const sectionTabs = await orgTabs("evenements", id);
  const catOf = (s: DirectorySupplier) => (cat && s.categories.includes(cat) ? cat : s.categories[0]);

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <BillingNotice orgId={id} motive="devis" />
        <SectionNav tabs={sectionTabs} active="prestataires" label={t("Rubrique Événements")} />
        {onglet === "nouvelle" ? (
          <>
            <Link href="?onglet=demandes" className="back-link"><ArrowLeft size={14} /> {t("Demandes de devis")}</Link>
            <PageHead title={t("Nouvelle demande de devis")} desc={t("Décrivez votre besoin une fois : les prestataires que vous choisissez vous répondent par un devis détaillé, directement sur KolBase.")} />
            <NewRfqForm
              orgId={id}
              blocked={blocked}
              ai={aiEnabled()}
              categories={SUPPLIER_CATEGORIES.map((c) => ({ id: c.id, label: t(c.label) }))}
              suppliers={suppliers.map((s) => ({
                id: s.id, name: s.name, categories: s.categories, city: s.city, coverage: s.coverage, about: s.about, since: s.since, rating: s.rating, reviews: s.reviews,
                logo: logoSrc(s), priceHint: s.priceHint,
                from: s.from ? t("dès {amount} HT {unit}", { amount: fmtEur(locale, s.from.unitCents), unit: t(OFFER_UNITS[s.from.unit as keyof typeof OFFER_UNITS] ?? s.from.unit) }) : null,
              }))}
              events={events.map((e) => ({ id: e.id, label: `${fmtDate(locale, e.startsAt)} — ${e.title}`, city: e.city, capacity: e.capacity, agencyId: e.agencyId }))}
              defaultEventId={evenement}
              defaultCategory={cat}
              defaultSupplier={prestataire}
            />
          </>
        ) : (
          <>
            <PageHead title={t("Prestataires et devis")} desc={t("Consultez les prestataires référencés, comparez leurs devis et confiez vos événements à une agence.")}>
              <Link className="btn" href="?onglet=nouvelle"><Plus size={15} /> {t("Nouvelle demande")}</Link>
            </PageHead>
            <div className="stats">
              <div className="card stat"><span className="muted">{t("Devis à comparer")}</span><strong>{toDecide}</strong></div>
              <div className="card stat"><span className="muted">{t("Prestations attribuées")}</span><strong>{awarded.length}</strong></div>
              <div className="card stat"><span className="muted">{t("Budget prestataires engagé")}</span><strong>{fmtEur(locale, engaged)}{" "}{t("HT")}</strong></div>
            </div>
            <nav className="tabs">
              {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
            </nav>
          </>
        )}

        {onglet === "demandes" && <Requests rfqs={rfqs} base={base} t={t} locale={locale} isOrganizer={isOrganizer} now={now} creatorName={(uid) => creators.get(uid)?.name ?? null} />}

        {onglet === "annuaire" && (
          <section className="stack" aria-label={t("Annuaire des prestataires")}>
            <div className="chips">
              <Link href="?onglet=annuaire" className={`chip${!cat ? " active" : ""}`}>{t("Toutes")}</Link>
              {SUPPLIER_CATEGORIES.map((c) => (
                <Link key={c.id} href={`?onglet=annuaire&cat=${c.id}`} className={`chip chip-icon${cat === c.id ? " active" : ""}`}>
                  <CategoryIcon category={c.id} size={13} className="xs" /> {t(c.label)}
                </Link>
              ))}
            </div>
            {(() => {
              const list = cat ? suppliers.filter((s) => s.categories.includes(cat)) : suppliers;
              if (list.length === 0) return <div className="card empty"><EmptyState icon={Store} title={t("Aucun prestataire référencé dans cette catégorie.")} /></div>;
              return (
                <div className="supplier-grid">
                  {list.map((s) => <SupplierCard key={s.id} s={s} t={t} locale={locale} askHref={`?onglet=nouvelle&cat=${catOf(s)}&prestataire=${s.id}`} />)}
                </div>
              );
            })()}
            <div className="info-note">
              <Info size={15} />
              <span>
                {t("Le référencement des prestataires est gratuit ; leur abonnement ne paie que les réponses à de nouvelles demandes, après un premier devis retenu. Il ne leur achète ni un meilleur classement, ni une présélection : le choix des prestataires consultés vous appartient entièrement.")}
              </span>
            </div>
          </section>
        )}

        {onglet === "agences" && isOrganizer && (
          <section className="stack">
            <div className="info-note">
              <Info size={15} />
              <span>{t("Pour confier un événement à une agence, choisissez-la sur la fiche de l'événement (« Agence ») : elle est mandatée au passage et son équipe y accède aussitôt avec son compte. Ici, vous voyez vos agences et pouvez mettre fin à un mandat.")}</span>
            </div>
            {mandates.length === 0 && <div className="card empty"><EmptyState icon={Store} title={t("Aucune agence mandatée pour l'instant.")} /></div>}
            {mandates.map((m) => (
              <section key={m.id} className="card agency-card">
                <div className="agency-head">
                  <Avatar name={m.agency.name} size={44} square />
                  <div className="grow">
                    <strong>{m.agency.name}</strong>
                    <span className="muted text-sm">
                      {m.scope ? `${m.scope} · ` : ""}{t(m.agency._count.agencyEvents > 1 ? "depuis le {date} · {agencyEvents} événements confiés" : "depuis le {date} · {agencyEvents} événement confié", { date: fmtDate(locale, m.startsAt), agencyEvents: m.agency._count.agencyEvents })}
                    </span>
                  </div>
                  <span className={`pill ${m.canAward ? "ok" : "wait"}`}>{m.canAward ? t("Retient les devis") : t("Propose les devis")}</span>
                </div>
                <p className="text-sm muted">
                  {m.canAward
                    ? t("Peut retenir un devis en votre nom sur les événements confiés ; vous êtes prévenu par e-mail de chaque décision.")
                    : t("Propose les devis à retenir ; la décision revient à votre équipe.")}
                </p>
                <div className="actions">
                  <form action={setMandateAward}>
                    <input type="hidden" name="orgId" value={id} />
                    <input type="hidden" name="mandateId" value={m.id} />
                    <input type="hidden" name="canAward" value={m.canAward ? "0" : "1"} />
                    <button className="btn ghost small">{m.canAward ? t("Ne plus laisser retenir les devis") : t("Autoriser à retenir les devis")}</button>
                  </form>
                  <form action={endMandate}>
                    <input type="hidden" name="orgId" value={id} />
                    <input type="hidden" name="mandateId" value={m.id} />
                    <button className="btn ghost small">{t("Mettre fin au mandat")}</button>
                  </form>
                </div>
              </section>
            ))}
            {mandates.length > 0 && <p className="hint">{t("Mettre fin au mandat retire aussitôt à l'équipe de l'agence l'accès aux événements qui lui étaient confiés.")}</p>}
          </section>
        )}
      </main>
    </>
  );
}

/** Demandes rangées par état : ce qui attend une décision d'abord, les annulées repliées en bas. */
function Requests({ rfqs, base, t, locale, isOrganizer, now, creatorName }: { rfqs: OrgRfq[]; base: string; t: T; locale: Locale; isOrganizer: boolean; now: Date; creatorName: (id: string) => string | null }) {
  if (rfqs.length === 0)
    return (
      <div className="card empty">
        <EmptyState icon={Receipt} title={t("Aucune demande de devis.")} action={<Link className="btn secondary small" href="?onglet=nouvelle">{t("Nouvelle demande")}</Link>}>
          {t("Décrivez votre besoin (salle, traiteur, transport…) : les prestataires référencés vous répondent par un devis.")}
        </EmptyState>
      </div>
    );
  const by = (g: RfqGroup) => rfqs.filter((r) => rfqGroup(r) === g);
  const deadlineAsc = (a: OrgRfq, b: OrgRfq) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity);
  const when = (r: OrgRfq) => r.event?.startsAt ?? r.sentAt ?? r.createdAt;
  // Attribuées : les prestations à venir d'abord (la plus proche en tête), puis les réalisées (la plus récente en tête).
  const awarded = by("awarded").sort((a, b) => {
    const fa = when(a) >= now;
    const fb = when(b) >= now;
    if (fa !== fb) return fa ? -1 : 1;
    return fa ? when(a).getTime() - when(b).getTime() : when(b).getTime() - when(a).getTime();
  });
  const groups: { key: RfqGroup; icon: typeof Scale; title: string; desc: string; tone?: "warn" | "ok" | "neutral"; items: OrgRfq[] }[] = [
    { key: "decide", icon: Scale, tone: "warn", title: t("À décider"), desc: t("Des devis sont arrivés : comparez-les et retenez la meilleure offre."), items: by("decide").sort(deadlineAsc) },
    { key: "waiting", icon: Hourglass, title: t("En attente de réponses"), desc: t("Envoyées aux prestataires, sans devis pour l'instant."), items: by("waiting").sort(deadlineAsc) },
    { key: "draft", icon: FilePen, tone: "neutral", title: t("Brouillons"), desc: t("À compléter, puis à envoyer aux prestataires choisis."), items: by("draft") },
    { key: "consulted", icon: Info, tone: "neutral", title: t("Votre organisation est consultée"), desc: t("Demandes de l'organisation où vous répondez comme prestataire : vous n'y voyez que votre devis."), items: by("consulted") },
    { key: "awarded", icon: CheckCircle2, tone: "ok", title: t("Attribuées"), desc: t("Prestations retenues : à venir, puis réalisées."), items: awarded },
  ];
  const cancelled = by("cancelled");
  return (
    <>
      {groups.filter((g) => g.items.length > 0).map((g) => (
        <section key={g.key} className="card row-list" aria-label={g.title}>
          <SectionHead icon={g.icon} tone={g.tone} title={`${g.title} (${g.items.length})`} desc={g.desc} />
          {g.items.map((r) => <RfqRow key={r.id} r={r} base={base} t={t} locale={locale} isOrganizer={isOrganizer} now={now} creatorName={creatorName} />)}
        </section>
      ))}
      {cancelled.length > 0 && (
        <details className="card row-list fold">
          <summary><SectionHead icon={Ban} tone="neutral" title={`${t("Annulées")} (${cancelled.length})`} /></summary>
          {cancelled.map((r) => <RfqRow key={r.id} r={r} base={base} t={t} locale={locale} isOrganizer={isOrganizer} now={now} creatorName={creatorName} />)}
        </details>
      )}
    </>
  );
}

/** Une demande en une ligne : prestation, événement, avancement des réponses, montant clé. */
function RfqRow({ r, base, t, locale, isOrganizer, now, creatorName }: { r: OrgRfq; base: string; t: T; locale: Locale; isOrganizer: boolean; now: Date; creatorName: (id: string) => string | null }) {
  const st = RFQ_STATUS[rfqDisplayStatus(r)];
  const kept = r.quotes.find((q) => q.status === "retained");
  const best = r.quotes[0];
  const city = r.event?.city ?? r.city;
  const late = r.status === "sent" && !!r.deadline && r.deadline < now;
  const soon = r.status === "sent" && !!r.deadline && !late && r.deadline.getTime() - now.getTime() < 3 * DAY;
  const reviewDue = isOrganizer && r.status === "awarded" && !!kept && !r.review && (!r.event || eventEnded(r.event, now));
  const author = r.createdById ? creatorName(r.createdById) : null;
  return (
    <Link href={`${base}/prestataires/${r.id}`} className="row-item rfq-row" id={`ligne-${r.id}`}>
      <CategoryIcon category={r.category} />
      <span className="row-main">
        <strong>{r.event?.title ?? t("Demande de devis")}</strong>
        <span className="muted text-sm">{[t(supplierCategoryLabel(r.category)), r.event ? fmtDate(locale, r.event.startsAt) : null, city, r.headcount ? t("{n} participants", { n: r.headcount }) : null].filter(Boolean).join(" · ")}</span>
        {author && r.status === "draft" && <span className="text-xs muted">{t("Créée par {v}", { v: author })}</span>}
      </span>
      <span className="row-status">
        <span className={`pill ${st.tone}`}>{t(st.label)}</span>
        {!r.conflicted && r.status !== "draft" && r.status !== "cancelled" && (
          <span className="quote-dots" title={t("{quotes} devis sur {suppliers} prestataires consultés", { quotes: r.quotes.length, suppliers: r.suppliers.length })}>
            {r.suppliers.map((s) => {
              const q = r.quotes.find((x) => x.supplierId === s.supplierId);
              return <span key={s.supplierId} className={`qd${q ? (q.status === "retained" ? " kept" : " in") : s.declined ? " no" : ""}`} />;
            })}
            <span className="text-xs muted">{t("{n} devis sur {m}", { n: r.quotes.length, m: r.suppliers.length })}</span>
          </span>
        )}
        {r.status === "sent" && r.deadline && (
          <span className={`text-xs ${late ? "danger-text" : soon ? "warn-text" : "muted"}`}>
            {late ? t("Réponse attendue le {date} : dépassée", { date: fmtDate(locale, r.deadline) }) : t("Réponse avant le {date}", { date: fmtDate(locale, r.deadline) })}
          </span>
        )}
        {reviewDue && <span className="pill electric"><Star size={11} /> {t("Avis à laisser")}</span>}
      </span>
      <span className="row-figures">
        {kept ? (
          <>
            <strong>{t("{amount} HT", { amount: fmtEur(locale, kept.amountCents) })}</strong>
            <span className="text-xs muted">{kept.supplier.name}</span>
          </>
        ) : best && r.status !== "cancelled" ? (
          <>
            <strong>{t("dès {montant}", { montant: fmtEur(locale, quoteTtc(best)) })}</strong>
            <span className="text-xs muted">{t("TTC, meilleure offre")}</span>
          </>
        ) : (
          <span className="text-xs muted">—</span>
        )}
      </span>
    </Link>
  );
}

/** Prestataire de l'annuaire : catégories, repères (note, capacité, prix), puis « Demander un devis ». */
function SupplierCard({ s, t, locale, askHref }: { s: DirectorySupplier; t: T; locale: Locale; askHref: string }) {
  const caps = readCapacities(s.capacities);
  const capKeys = (Object.keys(caps) as (keyof typeof caps)[]).slice(0, 2);
  return (
    <article className="card supplier-card">
      <div className={`supplier-cover cat-bg-${s.categories[0]}${s.cover ? " photo" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s.cover ? <img src={photoSrc(s.cover)} alt="" loading="lazy" /> : <CategoryIcon category={s.categories[0]} size={26} className="lg" />}
      </div>
      <div className="supplier-card-body">
        <div className="supplier-card-head">
          <Avatar name={s.name} size={40} square src={logoSrc(s)} />
          <div className="grow">
            <strong>{s.name}</strong>
            <span className="muted text-xs">{s.coverage ?? s.city ?? ""}</span>
          </div>
          {s.rating != null && <span className="rating-badge" title={t(s.reviews > 1 ? "{reviews} avis vérifiés" : "{reviews} avis vérifié", { reviews: s.reviews })}><Star size={12} /> {s.rating.toFixed(1).replace(".", ",")}</span>}
        </div>
        <div className="cat-tags">
          {s.categories.map((c) => <span key={c} className="cat-tag"><CategoryIcon category={c} size={12} className="xs" /> {t(supplierCategoryLabel(c))}</span>)}
        </div>
        {s.about && <p className="text-sm clamp-3">{s.about}</p>}
        <ul className="supplier-facts">
          {capKeys.map((k) => <li key={k}><strong>{caps[k]!.toLocaleString(locale === "en" ? "en-GB" : "fr-FR")}</strong> {t(CAPACITY_LABEL[k])}</li>)}
          {s.from ? <li><strong>{t("dès {amount} HT", { amount: fmtEur(locale, s.from.unitCents) })}</strong> {t(OFFER_UNITS[s.from.unit as keyof typeof OFFER_UNITS] ?? s.from.unit)}</li> : s.priceHint ? <li>{s.priceHint}</li> : null}
        </ul>
        <div className="supplier-card-actions">
          <Link className="btn small" href={askHref}>{t("Demander un devis")}</Link>
          <a className="btn ghost small" href={`/structures/${s.id}`} target="_blank" rel="noreferrer">{t("Voir le book")}</a>
        </div>
      </div>
    </article>
  );
}
