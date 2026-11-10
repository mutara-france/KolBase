import { SectionHead, PageHead } from "@/components/UI";
import { BannerForm, BookForm, OfferForm, PhotoForm, ReviewReplyForm } from "@/components/BookForms";
import { removeSupplierBanner, removeSupplierOffer, removeSupplierPhoto } from "@/lib/book-actions";
import { bannerSrc, delayLabel, OFFER_UNITS, PHOTO_MAX, photoSrc, readCapacities, supplierBook } from "@/lib/supplier-book";
import { capacityFields, equipmentOptions } from "@/lib/supplier-profiles";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock, ExternalLink, Gauge, ImageIcon, Images, Package, Star, TrendingUp } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SupplierProfileForm } from "@/components/RfqForms";
import { BillingNotice } from "@/components/BillingNotice";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";
import { getT } from "@/lib/i18n/server";
import { fmtEur, intlLocale } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Ma page prestataire")} — KolBase` };
}

/** La page d'un prestataire auprès des organisations : bannière, fiche, capacités, réalisations, catalogue, et ses indicateurs. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { org, isAdmin } = await requireMembership(id);
  if (org.kind !== "PRESTATAIRE") redirect(`/organisations/${id}`);
  const [book, photos, offers] = await Promise.all([
    supplierBook(id, true),
    db.organizationPhoto.findMany({ where: { organizationId: id }, select: { id: true, caption: true, createdAt: true }, orderBy: { position: "asc" } }),
    db.supplierOffer.findMany({ where: { organizationId: id }, orderBy: { createdAt: "asc" } }),
  ]);
  const loc = intlLocale(locale);

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <PageHead title={t("Ma page prestataire")} desc={t("Ce que voient les organisations avant de vous demander un devis : bannière, catégories, capacités, réalisations et forfaits.")}>
          <Link className="btn ghost" href={`/structures/${id}`}><ExternalLink size={15} /> {t("Voir ma page publique")}</Link>
        </PageHead>
        <BillingNotice orgId={id} motive="reponse" />
        <section className="card stack-sm">
          <SectionHead icon={Gauge} title={t("Vos indicateurs")} desc={t("Calculés à partir de votre activité sur KolBase ; les organisations voient la note, le délai et le taux de réponse.")} />
          <dl className="hero-facts">
            <div><dt><Star size={13} /> {t("Note moyenne")}</dt><dd>{book.rating != null ? `${book.rating.toFixed(1).replace(".", ",")} / 5` : "—"}<small>{t(book.reviews.length > 1 ? "{reviews} avis vérifiés" : "{reviews} avis vérifié", { reviews: book.reviews.length })}</small></dd></div>
            <div><dt><TrendingUp size={13} /> {t("Taux de réponse")}</dt><dd>{book.responseRate != null ? `${book.responseRate} %` : "—"}<small>{t("{answered} devis sur {invites} demandes", { answered: book.answered, invites: book.invites })}</small></dd></div>
            <div><dt><Clock size={13} /> {t("Délai de réponse")}</dt><dd>{delayLabel(book.delayHours, locale) ?? "—"}<small>{t("médian")}</small></dd></div>
            <div><dt><CheckCircle2 size={13} /> {t("Prestations")}</dt><dd>{book.retained}<small>{t("retenues via KolBase")}</small></dd></div>
          </dl>
          {book.market.map((m) => (
            <p key={m.category} className={`text-sm ${m.mine > m.median * 1.15 ? "warn-text" : ""}`}>
              {t("{supplierCategoryLabel} : votre prix médian est de {toLocaleString} € TTC par participant, pour une médiane de {toLocaleString2} € TTC sur {count} devis de la catégorie (données anonymisées).", { supplierCategoryLabel: t(supplierCategoryLabel(m.category)), toLocaleString: m.mine.toLocaleString(loc, { maximumFractionDigits: 2 }), toLocaleString2: m.median.toLocaleString(loc, { maximumFractionDigits: 2 }), count: m.count })}
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
            <section className="card stack-sm">
              <SectionHead icon={ImageIcon} title={t("Bannière")} desc={t("L'image large en tête de votre page et de votre carte dans l'annuaire des prestataires.")} />
              <BannerForm orgId={id} current={bannerSrc(org)} onRemove={removeSupplierBanner} />
            </section>
            <BookForm
              orgId={id}
              capacities={readCapacities(org.capacities)}
              equipment={org.equipment}
              groups={org.supplierCategories.map((c) => ({
                category: c,
                label: supplierCategoryLabel(c),
                fields: capacityFields(org.supplierCategories).find((g) => g.category === c)?.fields ?? [],
                options: equipmentOptions(org.supplierCategories).find((g) => g.category === c)?.options ?? [],
              })).filter((g) => g.fields.length + g.options.length > 0)}
              accessible={org.accessible}
              priceHint={org.priceHint ?? ""}
            />
            <section className="card stack-sm">
              <SectionHead icon={Images} title={t("Réalisations ({photos}/{PHOTO_MAX})", { photos: photos.length, PHOTO_MAX })} desc={t("Vos réalisations en images (buffets, salles, installations, supports…), avec une légende : elles s'affichent sur votre page.")} />
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
            {book.reviews.length > 0 && (
              <section className="card stack-sm">
                <SectionHead icon={Star} title={t("Avis reçus")} desc={t("Les avis laissés par vos clients après une prestation. Vous pouvez répondre publiquement à chacun : la réponse s'affiche sous l'avis, sur votre page.")} />
                {book.reviews.map((r) => (
                  <div key={r.id} className="review stack-xs">
                    <span><span className="rating">{Array.from({ length: r.rating }, (_, i) => <Star key={i} size={14} />)}</span> <strong>{r.client.name}</strong> <span className="muted text-xs">{r.createdAt.toLocaleDateString(loc, { month: "long", year: "numeric", timeZone: "Europe/Paris" })}</span></span>
                    {r.comment ? <p className="text-sm">{r.comment}</p> : <p className="muted text-sm">{t("Sans commentaire.")}</p>}
                    <ReviewReplyForm orgId={id} reviewId={r.id} current={r.reply} />
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
