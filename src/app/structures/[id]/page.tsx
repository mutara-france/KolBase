import Link from "next/link";
import { logoSrc } from "@/lib/logos";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Lock, Mail, MapPin, ShieldCheck, Star } from "lucide-react";
import { CAPACITY_LABEL, delayLabel, OFFER_UNITS, photoSrc, readCapacities, supplierBook } from "@/lib/supplier-book";
import { supplierCategoryLabel } from "@/lib/suppliers";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { CallCard, EventCard } from "@/components/PublicCards";
import { db } from "@/lib/db";
import { getCurrentUser, viaMandate } from "@/lib/auth";
import { ORG_KIND_LABEL, orgIsPublic } from "@/lib/orgs";
import { canSee, companyVisibility, type Viewer } from "@/lib/visibility";
import { FollowButton } from "@/components/FollowButton";
import { callFull, SIGNED_STATUSES } from "@/lib/projects";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { isDemoOrgId } from "@/lib/demo";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getT();
  const o = await db.organization.findFirst({ where: { id, listed: true, verification: "VERIFIED" }, select: { name: true, kind: true, about: true } });
  if (!o) return { title: t("Organisation — KolBase"), robots: { index: false } };
  const description = (o.about ?? t("{name} sur KolBase.", { name: o.name })).slice(0, 160);
  return {
    title: `${o.name} — ${t(ORG_KIND_LABEL[o.kind])} — KolBase`,
    description,
    alternates: { canonical: `/structures/${id}` },
    openGraph: { type: "website", siteName: "KolBase", url: `/structures/${id}`, title: `${o.name} — ${t(ORG_KIND_LABEL[o.kind])}`, description },
    ...(isDemoOrgId(id) ? { robots: { index: false } } : {}),
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, { t, locale }] = await Promise.all([getCurrentUser(), getT()]);
  // Membre de l'organisation (pas une agence qui y accède par son mandat : elle ne gère pas la fiche).
  const isMember = !!user?.memberships.some((m) => m.organizationId === id && !viaMandate(m));
  const viewer: Viewer = isMember ? "proprietaire" : user ? "membre" : "public";
  const now = new Date();
  const o = await db.organization.findFirst({
    where: { id, ...(isMember ? {} : { listed: true, verification: "VERIFIED" }) },
    include: {
      openCalls: { where: { status: "open", OR: [{ deadline: null }, { deadline: { gte: now } }] }, orderBy: { deadline: "asc" }, include: { _count: { select: { applications: { where: { status: "retained" } } } } } },
      events: { where: { publishedAt: { not: null }, startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, include: { _count: { select: { registrations: true } } } },
      // Collaborations : les dossiers signés seulement, comme la fiche expert.
      _count: { select: { projects: { where: { status: { in: SIGNED_STATUSES } } } } },
    },
  });
  if (!o) notFound();
  const v = companyVisibility(o.visibility);
  const isSupplier = o.kind === "PRESTATAIRE";
  const [book, photos, offers] = isSupplier
    ? await Promise.all([
        supplierBook(o.id),
        db.organizationPhoto.findMany({ where: { organizationId: o.id }, select: { id: true, caption: true, createdAt: true }, orderBy: { position: "asc" } }),
        db.supplierOffer.findMany({ where: { organizationId: o.id }, orderBy: { unitCents: "asc" } }),
      ])
    : [null, [], []];
  const caps = readCapacities(o.capacities);
  const lock = (label: string) => (
    <p className="hidden-note"><Lock size={13} /> {t("{label} : réservé aux membres connectés.", { label })} {viewer === "public" && <Link href={`/connexion?next=${encodeURIComponent(`/structures/${o.id}`)}`}>{t("Se connecter")}</Link>}</p>
  );

  return (
    <>
      <SiteHeader variant={user ? "app" : "public"} />
      <main className={user ? "" : "landing"}>
        <div className={user ? "stack" : "public-section stack"}>
          <Link href="/structures" className="back-link"><ArrowLeft size={14} /> {t("Toutes les organisations")}</Link>
          {/* Aperçu par un membre : la page n'est pas encore (ou plus) visible du public. */}
          {isMember && !orgIsPublic(o) && (
            <p className="notice warn" role="status">
              {o.verification === "SUSPENDED"
                ? t("Cette page n'est pas visible du public : l'organisation est suspendue par KolBase.")
                : o.verification !== "VERIFIED"
                ? t("Cette page n'est pas visible du public : elle le sera dès que KolBase aura validé l'organisation.")
                : t("Cette page n'est pas visible du public : l'organisation est retirée de l'annuaire.")}{" "}
              {!isSupplier && o.verification === "VERIFIED" && <Link href={`/organisations/${o.id}/membres?onglet=organisation`}>{t("La rendre visible")}</Link>}
            </p>
          )}
          <section className="card profile-hero">
            <Avatar name={o.name} size={76} square src={logoSrc(o)} />
            <div className="grow">
              <span className="sector-tag">{t(ORG_KIND_LABEL[o.kind])}</span>
              <h1 className="profile-name">{o.name}</h1>
              <p className="text-sm">{[o.sector ? t(o.sector) : null, o.headquarters].filter(Boolean).join(" · ")}</p>
            </div>
            {isMember ? <Link className="btn ghost" href={`/organisations/${o.id}`}>{t("Gérer l'organisation")}</Link> : <FollowButton type="organization" id={o.id} userId={user?.id ?? null} label={t("cette organisation")} />}
          </section>
          {isSupplier && book && (
            <>
              <div className="stats-row">
                <div className="stat-card"><div className="stat-value">{book.rating != null ? <span className="rating"><Star size={20} /> {book.rating.toFixed(1).replace(".", ",")}</span> : "—"}</div><div className="stat-label">{t(book.reviews.length > 1 ? "{n} avis vérifiés" : "{n} avis vérifié", { n: book.reviews.length })}</div></div>
                <div className="stat-card"><div className="stat-value">{delayLabel(book.delayHours, locale) ?? "—"}</div><div className="stat-label">{t("Délai de réponse médian")}</div></div>
                <div className="stat-card"><div className="stat-value">{book.responseRate != null ? `${book.responseRate} %` : "—"}</div><div className="stat-label">{t("Taux de réponse aux demandes")}</div></div>
                <div className="stat-card"><div className="stat-value tone-electric">{book.references.length}</div><div className="stat-label">{t("Prestations réalisées via KolBase")}</div></div>
              </div>
              {photos.length > 0 && (
                <div className="gallery">
                  {photos.map((ph) => (
                    <figure key={ph.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoSrc(ph)} alt={ph.caption ?? o.name} loading="lazy" />
                      {ph.caption && <figcaption>{ph.caption}</figcaption>}
                    </figure>
                  ))}
                </div>
              )}
              <div className="grid-2">
                <section className="card stack-sm">
                  <h2 className="section-title">{t("Présentation")}</h2>
                  {o.about ? <p>{o.about}</p> : <p className="muted">{t("Pas encore de présentation.")}</p>}
                  {o.supplierCategories.length > 0 && <div className="tags">{o.supplierCategories.map((c) => <span key={c} className="tag">{t(supplierCategoryLabel(c))}</span>)}</div>}
                  {o.coverage && <p className="meta-line"><MapPin size={12} /> {t("Zone couverte : {zone}", { zone: o.coverage })}</p>}
                  {Object.keys(caps).length > 0 && (
                    <ul className="plain text-sm">
                      {(Object.keys(caps) as (keyof typeof caps)[]).map((k) => <li key={k}><strong>{caps[k]}</strong> {t(CAPACITY_LABEL[k])}</li>)}
                    </ul>
                  )}
                  {(o.equipment.length > 0 || o.accessible) && (
                    <div className="tags">{[...o.equipment, ...(o.accessible ? ["Accessible PMR"] : [])].map((e) => <span key={e} className="tag">{t(e)}</span>)}</div>
                  )}
                </section>
                <section className="card stack-sm">
                  <h2 className="section-title">{t("Tarifs indicatifs")}</h2>
                  {o.priceHint && <p>{o.priceHint}</p>}
                  {offers.length > 0 ? (
                    <ul className="offer-list">
                      {offers.map((f) => <li key={f.id}><span>{f.label}</span><span><strong>{t("{amount} HT", { amount: (f.unitCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) })}</strong> <span className="muted text-sm">{t(OFFER_UNITS[f.unit as keyof typeof OFFER_UNITS] ?? f.unit)}</span></span></li>)}
                    </ul>
                  ) : !o.priceHint && <p className="muted">{t("Sur devis.")}</p>}
                  <p className="hint">{t("Les organisations consultent ce prestataire depuis « Prestataires et devis » : il répond par un devis détaillé.")}</p>
                </section>
              </div>
              <section className="card stack-sm">
                <h2 className="section-title">{t("Références")}</h2>
                {book.references.length === 0 ? <p className="muted">{t("Pas encore de prestation réalisée via KolBase.")}</p> : (
                  <ul className="plain stack-sm">
                    {book.references.slice(0, 10).map((r, i) => (
                      <li key={i} className="text-sm">
                        {t(supplierCategoryLabel(r.category))}{r.city ? ` · ${r.city}` : ""} · {r.date.toLocaleDateString(locale === "en" ? "en-GB" : "fr-FR", { month: "long", year: "numeric", timeZone: "Europe/Paris" })}{r.headcount ? ` · ${t("{n} participants", { n: r.headcount })}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="hint">{t("Événements scientifiques organisés via KolBase ; le nom des clients n'est pas affiché.")}</p>
              </section>
              <section className="card stack-sm">
                <h2 className="section-title">{t("Avis vérifiés")}</h2>
                {book.reviews.length === 0 ? <p className="muted">{t("Aucun avis pour l'instant.")}</p> : book.reviews.map((r) => (
                  <div key={r.id} className="review">
                    <span><span className="rating">{Array.from({ length: r.rating }, (_, i) => <Star key={i} size={14} />)}</span> <strong>{t("Organisation cliente")}</strong> <span className="muted text-xs">{r.createdAt.toLocaleDateString(locale === "en" ? "en-GB" : "fr-FR", { month: "long", year: "numeric", timeZone: "Europe/Paris" })}</span></span>
                    {r.comment && <p className="text-sm">{r.comment}</p>}
                  </div>
                ))}
                <p className="hint">{t("Avis laissés uniquement par les organisations qui ont retenu ce prestataire, après la prestation ; le nom des clients n'est pas affiché.")}</p>
              </section>
            </>
          )}
          {!isMember && !isSupplier && user?.practitioner?.listed && (
            <section className="card actions spread">
              <p className="muted text-sm" style={{ margin: 0, flex: "1 1 260px" }}>{t("Un projet de formation, d'étude ou d'intervention pour {org} ? Proposez-le : l'organisation peut l'accepter et ouvrir un dossier avec vous.", { org: o.name })}</p>
              <Link className="btn secondary" href={`/propositions/nouvelle?organisation=${o.id}`}>{t("Proposer un projet")}</Link>
            </section>
          )}
          {!isSupplier && <div className="stats-row">
            <div className="stat-card"><div className="stat-value">{o.openCalls.filter((c) => !callFull(c)).length}</div><div className="stat-label">{t("Opportunités ouvertes")}</div></div>
            <div className="stat-card"><div className="stat-value tone-electric">{o.events.length}</div><div className="stat-label">{t("Événements à venir")}</div></div>
            <div className="stat-card"><div className="stat-value">{o._count.projects}</div><div className="stat-label">{t("Collaborations")}</div></div>
          </div>}
          {isSupplier ? (
            <section className="card">
              <h2 className="section-title"><Mail size={15} /> {t("Contact")}</h2>
              {v.contact === "masque" && viewer !== "proprietaire" ? <p className="muted">{t("Non communiqué.")}</p> : canSee(v.contact, viewer) ? <p>{o.contactEmail ? <a href={`mailto:${o.contactEmail}`}>{o.contactEmail}</a> : t("Non renseigné.")}</p> : lock(t("Contact"))}
            </section>
          ) : <div className="grid-2">
            <section className="card">
              <h2 className="section-title">{t("Présentation")}</h2>
              {o.about ? <p>{o.about}</p> : <p className="muted">{t("Pas encore de présentation.")}</p>}
              {v.areas !== "masque" && (canSee(v.areas, viewer) ? <div className="tags mt-2">{o.areas.map((a) => <span key={a} className="tag">{t(a)}</span>)}</div> : lock(t("Aires d'intervention")))}
            </section>
            <section className="card">
              <h2 className="section-title"><ShieldCheck size={15} /> {t("Politique de collaboration")}</h2>
              {v.policy === "masque" && viewer !== "proprietaire" ? <p className="muted">{t("Non communiquée.")}</p> : canSee(v.policy, viewer) ? <p>{o.policy ?? t("Non renseignée.")}</p> : lock(t("Politique de conformité"))}
              <div className="hairline mt-3 mb-3" />
              <h2 className="section-title"><Mail size={15} /> {t("Contact partenariats")}</h2>
              {v.contact === "masque" && viewer !== "proprietaire" ? <p className="muted">{t("Non communiqué.")}</p> : canSee(v.contact, viewer) ? <p>{o.contactEmail ? <a href={`mailto:${o.contactEmail}`}>{o.contactEmail}</a> : t("Non renseigné.")}</p> : lock(t("Contact"))}
            </section>
          </div>}
          {!isSupplier && v.projets !== "masque" && (
            <section>
              <div className="section-head"><div><div className="eyebrow mb-1">{t("Opportunités")}</div><h2 className="section-h2">{t("Ouvertes aux praticiens")}</h2></div></div>
              {canSee(v.projets, viewer) ? (
                o.openCalls.length === 0 ? <p className="muted">{t("Aucune opportunité ouverte.")}</p> : (
                  // Appel complet : « Complet », sans bouton ; « Candidater » aux praticiens, « Se connecter » aux visiteurs.
                  <div className="grid-2">{o.openCalls.map((c) => <CallCard key={c.id} c={{ ...c, poster: o.name, posterLogo: logoSrc(o), open: true, full: callFull(c) }} action={callFull(c) ? undefined : user?.practitioner ? <Link className="btn secondary" href={`/opportunites/${c.id}`}>{t("Candidater")}</Link> : !user ? <Link className="btn secondary" href={`/connexion?next=${encodeURIComponent(`/opportunites/${c.id}`)}`}>{t("Se connecter pour candidater")}</Link> : undefined} />)}</div>
                )
              ) : lock(t("Opportunités ouvertes"))}
            </section>
          )}
          {!isSupplier && <section>
            <div className="section-head"><div><div className="eyebrow mb-1">{t("Agenda")}</div><h2 className="section-h2">{t("Événements à venir")}</h2></div></div>
            {o.events.length === 0 ? <p className="muted"><Clock size={13} /> {t("Aucun événement à venir.")}</p> : (
              <>
                <div className="grid-3">{o.events.slice(0, 12).map((e) => <EventCard key={e.id} ev={{ ...e, organization: { name: o.name }, registrations: e._count.registrations }} compact />)}</div>
                {o.events.length > 12 && (() => {
                  const [before, after] = t("Et {n} autres événements à venir sur la page {link}.", { n: o.events.length - 12 }).split("{link}");
                  return <p className="muted text-sm">{before}<Link href="/evenements">{t("Événements")}</Link>{after}</p>;
                })()}
              </>
            )}
          </section>}
        </div>
      </main>
    </>
  );
}
