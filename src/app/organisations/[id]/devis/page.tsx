import { BookForm, OfferForm, PhotoForm } from "@/components/BookForms";
import { removeSupplierOffer, removeSupplierPhoto } from "@/lib/book-actions";
import { delayLabel, EQUIPMENT, OFFER_UNITS, PHOTO_MAX, photoSrc, readCapacities, supplierBook } from "@/lib/supplier-book";
import { aiEnabled } from "@/lib/ai";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { QuoteForm, RfqMessageForm, SupplierProfileForm } from "@/components/RfqForms";
import { Thread } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { formatDate, formatEUR } from "@/lib/events";
import { QUOTE_STATUS, SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";
import { declineRfq } from "@/lib/rfq-actions";
import { readLines, withVat } from "@/lib/quotes";
import { storageEnabled } from "@/lib/storage";
import { BillingNotice } from "@/components/BillingNotice";
import { billingBlocked } from "@/lib/billing";

export const metadata = { title: "Demandes de devis — KolBase" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string }> }) {
  const { id } = await params;
  const { onglet = "en-cours" } = await searchParams;
  const { org, isAdmin, user } = await requireMembership(id);
  if (org.kind !== "PRESTATAIRE") redirect(`/organisations/${id}`);
  // Après un premier devis retenu, une nouvelle réponse suppose l'abonnement (les révisions restent libres).
  const quoteBlocked = await billingBlocked(id, "reponse");

  const invites = await db.rfqSupplier.findMany({
    where: { supplierId: id, rfq: { status: { not: "draft" } } },
    include: {
      rfq: {
        include: {
          organization: true, event: true, quotes: { where: { supplierId: id } },
          messages: { where: { supplierId: id }, include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
        },
      },
    },
    orderBy: { rfq: { sentAt: "desc" } },
  });
  const todo = invites.filter((i) => i.rfq.status === "sent" && i.rfq.quotes.length === 0 && !i.declined);
  // En cours : demandes ouvertes, et prestations qui vous sont attribuées (à préparer avec l'organisation).
  const current = invites.filter((i) => (i.rfq.status === "sent" && !i.declined) || (i.rfq.status === "awarded" && i.rfq.quotes[0]?.status === "retained" && (!i.rfq.event || i.rfq.event.startsAt >= new Date())));
  const shown = onglet === "en-cours" ? current : invites;
  const won = invites.filter((i) => i.rfq.quotes[0]?.status === "retained");
  const tabs = [["en-cours", `En cours (${current.length})`], ["toutes", `Toutes (${invites.length})`], ["fiche", "Mon book"]] as const;
  const book = onglet === "fiche" ? await supplierBook(id, true) : null;
  const [photos, offers] = await Promise.all([
    onglet === "fiche" ? db.organizationPhoto.findMany({ where: { organizationId: id }, select: { id: true, caption: true, createdAt: true }, orderBy: { position: "asc" } }) : Promise.resolve([]),
    db.supplierOffer.findMany({ where: { organizationId: id }, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <h1>Demandes de devis</h1>
        <BillingNotice orgId={id} motive="reponse" />
        {!org.listed && <p className="notice warn">Votre organisation n&apos;apparaît pas dans l&apos;annuaire des prestataires. Complétez la fiche prestataire pour être consulté.</p>}
        <div className="stats">
          <div className="card stat"><span className="muted">À traiter</span><strong>{todo.length}</strong></div>
          <div className="card stat"><span className="muted">Devis retenus</span><strong>{won.length}</strong></div>
          <div className="card stat"><span className="muted">Montant retenu</span><strong>{formatEUR(won.reduce((s, i) => s + i.rfq.quotes[0].amountCents, 0))} HT</strong></div>
        </div>
        <nav className="tabs">
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>

        {onglet === "fiche" && book ? (
          <>
            <section className="card stack-sm">
              <div className="card-head">
                <div>
                  <h2>Vos indicateurs</h2>
                  <p className="muted">Calculés à partir de votre activité sur KolBase ; les organisations voient la note, le délai et le taux de réponse.</p>
                </div>
                <Link className="btn ghost" href={`/structures/${id}`}>Voir ma page publique</Link>
              </div>
              <dl className="hero-facts">
                <div><dt>Note moyenne</dt><dd>{book.rating != null ? `${book.rating.toFixed(1).replace(".", ",")} / 5` : "—"}<small>{book.reviews.length} avis vérifié{book.reviews.length > 1 ? "s" : ""}</small></dd></div>
                <div><dt>Taux de réponse</dt><dd>{book.responseRate != null ? `${book.responseRate} %` : "—"}<small>{book.answered} devis sur {book.invites} demandes</small></dd></div>
                <div><dt>Délai de réponse</dt><dd>{delayLabel(book.delayHours) ?? "—"}<small>médian</small></dd></div>
                <div><dt>Prestations</dt><dd>{book.retained}<small>retenues via KolBase</small></dd></div>
              </dl>
              {book.market.map((m) => (
                <p key={m.category} className={`text-sm ${m.mine > m.median * 1.15 ? "warn-text" : ""}`}>
                  {supplierCategoryLabel(m.category)} : votre prix médian est de {m.mine.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € TTC par participant, pour une médiane de {m.median.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € TTC sur {m.count} devis de la catégorie (données anonymisées).
                </p>
              ))}
            </section>
            <SupplierProfileForm
              orgId={id}
              categories={SUPPLIER_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
              current={{ categories: org.supplierCategories, coverage: org.coverage ?? "", listed: org.listed }}
              canEdit={isAdmin}
            />
            {isAdmin && (
              <>
                <BookForm orgId={id} capacities={readCapacities(org.capacities)} equipment={org.equipment} options={EQUIPMENT} accessible={org.accessible} priceHint={org.priceHint ?? ""} />
                <section className="card stack-sm">
                  <h2>Photos ({photos.length}/{PHOTO_MAX})</h2>
                  <p className="muted">Vos salles, vos réalisations : les photos apparaissent en tête de votre page publique.</p>
                  {photos.length > 0 && (
                    <div className="gallery">
                      {photos.map((ph) => (
                        <figure key={ph.id}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photoSrc(ph)} alt={ph.caption ?? ""} loading="lazy" />
                          <figcaption>
                            <span>{ph.caption ?? "Sans légende"}</span>
                            <form action={removeSupplierPhoto}><input type="hidden" name="orgId" value={id} /><input type="hidden" name="photoId" value={ph.id} /><button className="link danger">Retirer</button></form>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                  {photos.length < PHOTO_MAX && <PhotoForm orgId={id} />}
                </section>
                <section className="card stack-sm">
                  <h2>Catalogue de forfaits</h2>
                  <p className="muted">Vos prestations courantes et leur prix : vous les ajoutez en un clic à vos devis, et les organisations voient vos prix « à partir de ».</p>
                  {offers.length > 0 && (
                    <ul className="offer-list">
                      {offers.map((o) => (
                        <li key={o.id}>
                          <span>{o.label}</span>
                          <span className="actions">
                            <strong>{formatEUR(o.unitCents)} HT</strong> <span className="muted text-sm">{OFFER_UNITS[o.unit as keyof typeof OFFER_UNITS] ?? o.unit}</span>
                            <form action={removeSupplierOffer}><input type="hidden" name="orgId" value={id} /><input type="hidden" name="offerId" value={o.id} /><button className="link danger">Retirer</button></form>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <OfferForm orgId={id} units={OFFER_UNITS} />
                </section>
              </>
            )}
          </>
        ) : (
          <>
            {shown.length === 0 && <div className="card empty"><Receipt size={22} /><p className="muted">Aucune demande {onglet === "en-cours" ? "en cours" : "reçue"}.</p></div>}
            {shown.map(({ rfq: r, declined }) => {
              const q = r.quotes[0];
              const closed = r.status !== "sent";
              return (
                <section key={r.id} className="card">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow-sm">{supplierCategoryLabel(r.category)} · {r.organization.name}</div>
                      <h2>{r.event?.title ?? "Demande de devis"}</h2>
                      <div className="muted">
                        {r.event ? `${formatDate(r.event.startsAt)}${r.event.venue ? ` · ${r.event.venue}` : ""}` : ""}
                        {r.city ? ` · ${r.city}` : ""}{r.headcount ? ` · ${r.headcount} participants` : ""}
                      </div>
                    </div>
                    <span className={`pill ${q ? (q.status === "retained" ? "ok" : q.status === "rejected" ? "done" : "electric") : r.status === "cancelled" ? "bad" : declined ? "done" : "wait"}`}>
                      {q ? QUOTE_STATUS[q.status] : r.status === "cancelled" ? "Annulée" : r.status === "awarded" ? "Attribuée à un autre prestataire" : declined ? "Déclinée" : "Devis attendu"}
                    </span>
                  </div>
                  <p>{r.needs}</p>
                  <div className="kv">
                    <div><span>Reçue le</span><span>{r.sentAt ? formatDate(r.sentAt) : "—"}</span></div>
                    <div><span>Réponse attendue</span><span>{r.deadline ? formatDate(r.deadline) : "à définir"}</span></div>
                    {q && <div><span>Votre devis{q.revision > 1 ? ` (version ${q.revision})` : ""}</span><span>{formatEUR(q.amountCents)} HT · {formatEUR(withVat(q.amountCents, q.vatBp))} TTC</span></div>}
                  </div>
                  {!closed && (
                    <>
                      <QuoteForm
                        orgId={id}
                        rfqId={r.id}
                        category={r.category}
                        offers={offers.map((o) => ({ label: o.label, unit: o.unit, unitCents: o.unitCents }))}
                        ai={aiEnabled()}
                        headcount={r.headcount}
                        uploads={storageEnabled()}
                        blocked={quoteBlocked}
                        current={q ? {
                          amount: String(q.amountCents / 100), delay: q.delay ?? "", note: q.note ?? "", conditions: q.conditions ?? "", vatBp: q.vatBp, revision: q.revision, fileName: q.fileName,
                          validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : "",
                          lines: readLines(q.lines).map((l) => ({ label: l.label, qty: l.qty, unit: String(l.unitCents / 100) })),
                        } : undefined}
                      />
                      {!q && !declined && (
                        <form action={declineRfq}>
                          <input type="hidden" name="orgId" value={id} />
                          <input type="hidden" name="rfqId" value={r.id} />
                          <button className="link danger">Décliner la demande</button>
                        </form>
                      )}
                    </>
                  )}
                  {q?.status === "retained" && <p className="notice ok">{r.organization.name} a retenu votre devis. Échangez ci-dessous pour préparer la prestation.</p>}
                  {(r.status === "sent" || (r.status === "awarded" && q?.status === "retained") || r.messages.length > 0) && (
                    <details className="rfq-thread" open={r.messages.length > 0}>
                      <summary>
                        <strong>Questions et échanges avec {r.organization.name}</strong>
                        <span className="muted text-xs">{r.messages.length ? `${r.messages.length} message${r.messages.length > 1 ? "s" : ""}` : "posez une question sur le besoin"}</span>
                        {r.messages.at(-1) && !r.messages.at(-1)!.fromSupplier && <span className="pill electric">Nouveau message</span>}
                      </summary>
                      <Thread messages={r.messages} meId={user.id} />
                      {(r.status === "sent" || q?.status === "retained") && !declined && (
                        <RfqMessageForm orgId={id} rfqId={r.id} supplierId={id} placeholder={`Votre question à ${r.organization.name}…`} />
                      )}
                    </details>
                  )}
                </section>
              );
            })}
          </>
        )}
      </main>
    </>
  );
}
