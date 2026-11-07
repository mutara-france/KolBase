import { SectionHead, PageHead, EmptyState } from "@/components/UI";
import { BookForm, OfferForm, PhotoForm } from "@/components/BookForms";
import { removeSupplierOffer, removeSupplierPhoto } from "@/lib/book-actions";
import { delayLabel, EQUIPMENT, OFFER_UNITS, PHOTO_MAX, photoSrc, readCapacities, supplierBook } from "@/lib/supplier-book";
import { aiEnabled } from "@/lib/ai";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Gauge, Images, Package, Receipt } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { QuoteForm, RfqMessageForm, SupplierProfileForm } from "@/components/RfqForms";
import { Thread } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { QUOTE_STATUS, SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";
import { declineRfq } from "@/lib/rfq-actions";
import { lineVat, quoteTtc, readLines } from "@/lib/quotes";
import { storageEnabled } from "@/lib/storage";
import { BillingNotice } from "@/components/BillingNotice";
import { ConfirmButton } from "@/components/ConfirmButton";
import { billingBlocked } from "@/lib/billing";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Demandes de devis")} — KolBase` };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string }> }) {
  const { t, locale } = await getT();
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
  const tabs = [["en-cours", t("En cours ({n})", { n: current.length })], ["toutes", t("Toutes ({n})", { n: invites.length })], ["fiche", t("Mon book")]] as const;
  const book = onglet === "fiche" ? await supplierBook(id, true) : null;
  const [photos, offers] = await Promise.all([
    onglet === "fiche" ? db.organizationPhoto.findMany({ where: { organizationId: id }, select: { id: true, caption: true, createdAt: true }, orderBy: { position: "asc" } }) : Promise.resolve([]),
    db.supplierOffer.findMany({ where: { organizationId: id }, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <PageHead title={t("Demandes de devis")} desc={t("Les demandes des organisations : répondez par un devis détaillé, échangez, suivez vos prestations retenues.")} />
        <BillingNotice orgId={id} motive="reponse" />
        {!org.listed && <p className="notice warn">{t("Votre organisation n'apparaît pas dans l'annuaire des prestataires. Complétez la fiche prestataire pour être consulté.")}</p>}
        <div className="stats">
          <div className="card stat"><span className="muted">{t("À traiter")}</span><strong>{todo.length}</strong></div>
          <div className="card stat"><span className="muted">{t("Devis retenus")}</span><strong>{won.length}</strong></div>
          <div className="card stat"><span className="muted">{t("Montant retenu")}</span><strong>{fmtEur(locale, won.reduce((s, i) => s + i.rfq.quotes[0].amountCents, 0))}{" "}{t("HT")}</strong></div>
        </div>
        <nav className="tabs">
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>

        {onglet === "fiche" && book ? (
          <>
            <section className="card stack-sm">
              <div className="card-head">
                <div>
                  <SectionHead icon={Gauge} title={t("Vos indicateurs")} desc={t("Calculés à partir de votre activité sur KolBase ; les organisations voient la note, le délai et le taux de réponse.")} />
                </div>
                <Link className="btn ghost" href={`/structures/${id}`}>{t("Voir ma page publique")}</Link>
              </div>
              <dl className="hero-facts">
                <div><dt>{t("Note moyenne")}</dt><dd>{book.rating != null ? `${book.rating.toFixed(1).replace(".", ",")} / 5` : "—"}<small>{t(book.reviews.length > 1 ? "{reviews} avis vérifiés" : "{reviews} avis vérifié", { reviews: book.reviews.length })}</small></dd></div>
                <div><dt>{t("Taux de réponse")}</dt><dd>{book.responseRate != null ? `${book.responseRate} %` : "—"}<small>{t("{answered} devis sur {invites} demandes", { answered: book.answered, invites: book.invites })}</small></dd></div>
                <div><dt>{t("Délai de réponse")}</dt><dd>{delayLabel(book.delayHours) ?? "—"}<small>{t("médian")}</small></dd></div>
                <div><dt>{t("Prestations")}</dt><dd>{book.retained}<small>{t("retenues via KolBase")}</small></dd></div>
              </dl>
              {book.market.map((m) => (
                <p key={m.category} className={`text-sm ${m.mine > m.median * 1.15 ? "warn-text" : ""}`}>
                  {t("{supplierCategoryLabel} : votre prix médian est de {toLocaleString} € TTC par participant, pour une médiane de {toLocaleString2} € TTC sur {count} devis de la catégorie (données anonymisées).", { supplierCategoryLabel: t(supplierCategoryLabel(m.category)), toLocaleString: m.mine.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 }), toLocaleString2: m.median.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 }), count: m.count })}
                </p>
              ))}
            </section>
            <SupplierProfileForm
              orgId={id}
              categories={SUPPLIER_CATEGORIES.map((c) => ({ id: c.id, label: t(c.label) }))}
              current={{ categories: org.supplierCategories, coverage: org.coverage ?? "", listed: org.listed }}
              canEdit={isAdmin}
            />
            {isAdmin && (
              <>
                <BookForm orgId={id} capacities={readCapacities(org.capacities)} equipment={org.equipment} options={EQUIPMENT} accessible={org.accessible} priceHint={org.priceHint ?? ""} />
                <section className="card stack-sm">
                  <SectionHead icon={Images} title={t("Photos ({photos}/{PHOTO_MAX})", { photos: photos.length, PHOTO_MAX })} desc={t("Vos salles, vos réalisations : les photos apparaissent en tête de votre page publique.")} />
                  {photos.length > 0 && (
                    <div className="gallery">
                      {photos.map((ph) => (
                        <figure key={ph.id}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photoSrc(ph)} alt={ph.caption ?? ""} loading="lazy" />
                          <figcaption>
                            <span>{ph.caption ?? t("Sans légende")}</span>
                            <form action={removeSupplierPhoto}><input type="hidden" name="orgId" value={id} /><input type="hidden" name="photoId" value={ph.id} /><button className="link danger">{t("Retirer")}</button></form>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                  {photos.length < PHOTO_MAX && <PhotoForm orgId={id} />}
                </section>
                <section className="card stack-sm">
                  <SectionHead icon={Package} title={t("Catalogue de forfaits")} desc={t("Vos prestations courantes et leur prix : vous les ajoutez en un clic à vos devis, et les organisations voient vos prix « à partir de ».")} />
                  {offers.length > 0 && (
                    <ul className="offer-list">
                      {offers.map((o) => (
                        <li key={o.id}>
                          <span>{o.label}</span>
                          <span className="actions">
                            <strong>{t("{amount} HT", { amount: fmtEur(locale, o.unitCents) })}</strong> <span className="muted text-sm">{t(OFFER_UNITS[o.unit as keyof typeof OFFER_UNITS] ?? o.unit)}</span>
                            <form action={removeSupplierOffer}><input type="hidden" name="orgId" value={id} /><input type="hidden" name="offerId" value={o.id} /><button className="link danger">{t("Retirer")}</button></form>
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
            {shown.length === 0 && <div className="card empty"><EmptyState icon={Receipt} title={`${t("Aucune demande")} ${onglet === "en-cours" ? t("en cours") : t("reçue")}.`}>{t("Les organisations vous adressent leurs demandes de devis depuis votre fiche prestataire.")}</EmptyState></div>}
            {shown.map(({ rfq: r, declined }) => {
              const q = r.quotes[0];
              const closed = r.status !== "sent";
              return (
                <section key={r.id} className="card">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow-sm">{t(supplierCategoryLabel(r.category))} · {r.organization.name}</div>
                      <h2>{r.event?.title ?? t("Demande de devis")}</h2>
                      <div className="muted">
                        {r.event ? `${fmtDate(locale, r.event.startsAt)}${r.event.venue ? ` · ${r.event.venue}` : ""}` : ""}
                        {r.city ? ` · ${r.city}` : ""}{r.headcount ? ` ${t("· {headcount} participants", { headcount: r.headcount })}` : ""}
                      </div>
                    </div>
                    {/* Demande annulée par le client : « Annulée », même si un devis avait été envoyé. */}
                    <span className={`pill ${r.status === "cancelled" ? "bad" : q ? (q.status === "retained" ? "ok" : q.status === "rejected" ? "done" : "electric") : declined ? "done" : "wait"}`}>
                      {r.status === "cancelled" ? t("Annulée") : q ? t(QUOTE_STATUS[q.status]) : r.status === "awarded" ? t("Attribuée à un autre prestataire") : declined ? t("Déclinée") : t("Devis attendu")}
                    </span>
                  </div>
                  <p>{r.needs}</p>
                  <div className="kv">
                    <div><span>{t("Reçue le")}</span><span>{r.sentAt ? fmtDate(locale, r.sentAt) : "—"}</span></div>
                    <div><span>{t("Réponse attendue")}</span><span>{r.deadline ? fmtDate(locale, r.deadline) : t("à définir")}</span></div>
                    {q && <div><span>{t("Votre devis")}{q.revision > 1 ? ` ${t("(version {revision})", { revision: q.revision })}` : ""}</span><span>{fmtEur(locale, q.amountCents)}{" "}{t("HT")}{" · "}{fmtEur(locale, quoteTtc(q))}{" "}{t("TTC")}</span></div>}
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
                          lines: readLines(q.lines).map((l) => ({ label: l.label, qty: l.qty, unit: String(l.unitCents / 100), vatBp: lineVat(l, q.vatBp) })),
                        } : undefined}
                      />
                      {!q && !declined && (
                        <form action={declineRfq} className="stack-sm">
                          <input type="hidden" name="orgId" value={id} />
                          <input type="hidden" name="rfqId" value={r.id} />
                          <details>
                            <summary className="link danger">{t("Décliner la demande")}</summary>
                            <label>{t("Motif (facultatif, transmis à {name})", { name: r.organization.name })}<input name="note" maxLength={500} placeholder={t("Indisponible à cette date, hors de notre zone…")} /></label>
                            <ConfirmButton className="btn ghost small" confirm={t("décliner la demande")} summary={<>{t("{name} est prévenue par e-mail ; vous pourrez encore envoyer un devis tant que la demande est ouverte.", { name: r.organization.name })}</>}>
                              {t("Décliner")}
                            </ConfirmButton>
                          </details>
                        </form>
                      )}
                    </>
                  )}
                  {q?.status === "retained" && <p className="notice ok">{t("{name} a retenu votre devis. Échangez ci-dessous pour préparer la prestation.", { name: r.organization.name })}</p>}
                  {(r.status === "sent" || (r.status === "awarded" && q?.status === "retained") || r.messages.length > 0) && (
                    <details className="rfq-thread" open={r.messages.length > 0}>
                      <summary>
                        <strong>{t("Questions et échanges avec {name}", { name: r.organization.name })}</strong>
                        <span className="muted text-xs">{r.messages.length ? t(r.messages.length > 1 ? "{messages} messages" : "{messages} message", { messages: r.messages.length }) : t("posez une question sur le besoin")}</span>
                        {r.messages.at(-1) && !r.messages.at(-1)!.fromSupplier && <span className="pill electric">{t("Nouveau message")}</span>}
                      </summary>
                      <Thread messages={r.messages} meId={user.id} />
                      {(r.status === "sent" || q?.status === "retained") && !declined && (
                        <RfqMessageForm orgId={id} rfqId={r.id} supplierId={id} placeholder={t("Votre question à {name}…", { name: r.organization.name })} />
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
