import { aiEnabled } from "@/lib/ai";
import { EditEventForm, EventReviewForm, ProgramForm } from "@/components/EventForms";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, Building2, CalendarDays, Pencil, ClipboardCheck, Euro, FileDown, FolderOpen, Gift, ListOrdered, MapPin, Megaphone, QrCode, ShieldCheck, Star, Truck, Users } from "lucide-react";
import { SectionHead } from "@/components/UI";
import { StatusPill } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { BENEFIT_CATALOG, COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, EVENT_TYPES, eventScope, eventTypeLabel, FORMAT_LABEL, formatDuration, needsOnlineLink, orgEventStatus, toParisInput } from "@/lib/events";
import { isSuspendedOrg } from "@/lib/org-roles";
import { cancelEvent, deleteEventDraft, setEventAgency, setEventFlag, submitEventReview } from "@/lib/event-actions";
import { needsReview, REVIEW_LABEL, REVIEW_TONE, reviewAllowsPublish, type ReviewStatus } from "@/lib/event-review";
import { FOUR_EYES_BLOCKED, fourEyes } from "@/lib/four-eyes";
import { deletableDraft, everPublished } from "@/lib/event-drafts";
import { EVENT_NOT_PUBLISHABLE, eventPublishable } from "@/lib/projects";
import { BillingNotice } from "@/components/BillingNotice";
import { engagementBlock } from "@/lib/billing";
import { applyQuoteToBenefit } from "@/lib/rfq-actions";
import { RFQ_STATUS, rfqDisplayStatus, rfqView, SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";
import { perHeadLabel, perParticipant, quoteTtc } from "@/lib/quotes";
import { costPerHead, eventHospitality } from "@/lib/indicators";
import { complianceSettings, hospitalityRegime, REGIME_LABEL, regimeReason } from "@/lib/compliance";
import { drPrefix } from "@/lib/professions";
import { checkinOpen } from "@/lib/checkin";
import { eventEnd, eventEnded, fmtRating, surveySummary } from "@/lib/event-followup";
import { ServiceOffers } from "@/components/ServiceForms";
import { cancelServiceOrder } from "@/lib/service-actions";
import { featuredUntil, newsletterAudienceCount, newsletterSendsThisMonth, ORDER_STATUS, orderStats } from "@/lib/services";
import { mailingSlot } from "@/lib/newsletter";
import { ConfirmButton } from "@/components/ConfirmButton";
import { conversion, reportParts } from "@/lib/service-report";
import { groupOrders, packItemStatus, packSaving, packStatus } from "@/lib/service-pack";
import { SendNowButton } from "@/components/FollowupForms";
import { TableWrap } from "@/components/TableWrap";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, fmtTime, intlLocale } from "@/lib/i18n";

/** Prestations dont le coût par participant se rapproche d'une hospitalité déclarée (repas, nuitée). */
const HOSPITALITY_CATS = ["restauration", "hebergement"];

/**
 * Fiche d'un événement côté organisation : page de l'événement (mode « page »), onglet « Événement » d'un dossier
 * (« dossier » : tout sauf les services de communication) ou onglet « Marketing » (« marketing » : les services seuls).
 * `retour` : adresse de l'onglet du dossier, où ramènent les actions qui redirigent (publication).
 */
export async function EventWorkspace({ orgId: id, eventId, publie, mode = "page", retour, expertsHref }: { orgId: string; eventId: string; publie?: string; mode?: "page" | "dossier"; retour?: string; expertsHref?: string }) {
  const { t, locale } = await getT();
  const { org, roles, user } = await requireMembership(id, [...EVENT_MANAGER_ROLES, "CONFORMITE"]);
  const isOrganizer = roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r));
  // Rôle Conformité seul : fiche en lecture (hospitalités, inscrits, bilan), sans aucune action.
  const readOnly = !roles.some((r) => EVENT_MANAGER_ROLES.includes(r));
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: id, ...(readOnly ? {} : eventScope(user, roles)) },
    include: {
      agency: { select: { name: true } },
      project: {
        select: {
          id: true, title: true, status: true,
          experts: { where: { status: { not: "DECLINE" } }, include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } },
        },
      },
      benefits: { include: { _count: { select: { accepted: true } } } },
      registrations: { include: { user: true, benefits: { include: { benefit: true } } }, orderBy: { createdAt: "asc" } },
      _count: { select: { registrations: true, rfqs: true, calls: true, serviceOrders: true } },
      surveys: { orderBy: { createdAt: "desc" } },
      serviceOrders: { include: { offer: { select: { kind: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!event) notFound();
  const calls = isOrganizer
    ? await db.openCall.findMany({
        where: { organizationId: id, eventId },
        include: { applications: { select: { status: true, practitioner: { select: { profession: true, user: { select: { firstName: true, lastName: true } } } } } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const [rfqs, agencies] = await Promise.all([
    db.rfq.findMany({
      where: { organizationId: id, eventId },
      include: { _count: { select: { suppliers: true } }, suppliers: { select: { supplierId: true } }, quotes: { select: { id: true, amountCents: true, vatBp: true, ttcCents: true, status: true, supplierId: true, supplier: { select: { name: true } } }, orderBy: { amountCents: "asc" } } },
      orderBy: { createdAt: "asc" },
    }).then((rs) => {
      // Agence consultée sur une demande de son événement : seulement son propre devis (confidentialité des offres).
      const own = user.memberships.filter((m) => m.organization.kind === "PRESTATAIRE").map((m) => m.organizationId);
      // Meilleure offre d'abord, sur le TTC (les lignes peuvent avoir des taux de TVA différents).
      return rs.map((r) => rfqView({ ...r, quotes: [...r.quotes].sort((a, b) => quoteTtc(a) - quoteTtc(b)), messages: [] as { supplierId: string }[] }, own));
    }),
    // Agences proposées : les agences événementielles référencées, et celles déjà mandatées.
    isOrganizer
      ? db.organization.findMany({
          where: {
            kind: "PRESTATAIRE",
            OR: [
              { listed: true, verification: "VERIFIED", supplierCategories: { has: "evenementiel" } },
              { mandatesReceived: { some: { mandatorId: id, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } } },
            ],
          },
          select: { id: true, name: true, mandatesReceived: { where: { mandatorId: id, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, select: { id: true } } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const settings = complianceSettings(org.complianceSettings);
  const experts = event.project?.experts ?? [];
  const participants = event.internal ? experts.length : event.registrations.length;
  const expected = event.capacity ?? (participants || null);
  const askedCats = new Set(rfqs.filter((r) => r.status !== "cancelled").map((r) => r.category));
  // Catégories utiles selon le format : une visioconférence n'a besoin ni de salle ni d'hébergement.
  // Raccourcis vers les besoins logistiques courants ; les autres catégories restent accessibles par « Demander des devis ».
  const shortcutIds = event.format === "DISTANCIEL" ? ["audiovisuel", "communication"] : ["salle", "restauration", "hebergement", "transport", "audiovisuel"];
  const usefulCats = SUPPLIER_CATEGORIES.filter((c) => shortcutIds.includes(c.id) && !askedCats.has(c.id));
  const engagedTtc = rfqs.reduce((s, r) => { const k = r.quotes.find((q) => q.status === "retained"); return s + (k ? quoteTtc(k) : 0); }, 0);
  // Accueil et bilan : présence au pointage, coût réel, hospitalités à déclarer.
  const now = new Date();
  // Commencé n'est pas terminé : pointage pendant l'événement ; absents, bilan, attestations et avis après la fin.
  const isPast = event.startsAt < now;
  const ended = eventEnded(event, now);
  const canPoint = !event.internal && checkinOpen(event.startsAt, now);
  const present = event.registrations.filter((r) => r.checkedInAt);
  // Une seule règle de présence (en-tête, bilan, Statistiques) : après l'événement pointé, les absents sont exclus.
  const hosp = eventHospitality(event.registrations, ended);
  const pointed = hosp.known;
  const hospOf = (rs: typeof event.registrations) => rs.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);
  const absentsWithBenefits = pointed ? event.registrations.filter((r) => !r.checkedInAt && r.benefits.length > 0) : [];
  const hospConsumed = hosp.cents;
  const realCost = hospConsumed + engagedTtc;
  const isCompliance = roles.some((r) => COMPLIANCE_ROLES.includes(r));
  // Rappel de la veille, puis remerciement (attestation, questionnaire) : automatiques, ou envoyés d'un clic.
  const reminded = event.registrations.filter((r) => r.reminderSentAt);
  const followed = event.registrations.filter((r) => r.followUpSentAt);
  const lastSent = (rs: typeof event.registrations, k: "reminderSentAt" | "followUpSentAt") => rs.reduce<Date | null>((m, r) => (r[k] && (!m || r[k]! > m) ? r[k] : m), null);
  const survey = surveySummary(event.surveys);
  const offers = isOrganizer && !event.internal ? await db.serviceOffer.findMany({ where: { active: true }, orderBy: { position: "asc" } }) : [];
  // Services proposés ; un pack affiche le prix des services séparés et n'est commandable que si aucun n'est en cours.
  const openFor = (offerId: string) => event.serviceOrders.some((x) => x.offerId === offerId && ["demandee", "planifiee"].includes(x.status));
  // E-mailing (seul ou dans un pack) : l'audience actuelle est annoncée, et la commande impossible si elle est nulle.
  const audience = offers.some((o) => o.kind === "newsletter") ? await newsletterAudienceCount() : 0;
  // Plafond mensuel de la lettre : prochain envoi le 1er du mois suivant ; e-mailing indisponible si l'événement a lieu avant.
  const slot = offers.some((o) => o.kind === "newsletter") ? mailingSlot(await newsletterSendsThisMonth(), event.startsAt, now) : null;
  const offerCards = offers.map((o) => {
    const items = o.kind === "pack" ? offers.filter((x) => o.includes.includes(x.code)) : [];
    const mailing = o.kind === "newsletter" || items.some((x) => x.kind === "newsletter");
    const separate = items.length === o.includes.length ? items.reduce((n, x) => n + x.priceCents, 0) : 0;
    return {
      id: o.id, label: t(o.label), description: o.description ? t(o.description) : o.description, price: t("{amount} HT", { amount: fmtEur(locale, o.priceCents) }), pack: o.kind === "pack",
      compareAt: o.kind === "pack" && separate > o.priceCents ? t("{amount} HT", { amount: fmtEur(locale, separate) }) : undefined,
      saving: o.kind === "pack" && separate > o.priceCents ? t("{amount} HT", { amount: fmtEur(locale, packSaving(items.map((x) => x.priceCents), o.priceCents)) }) : undefined,
      ordered: o.kind === "pack" ? items.length > 0 && items.every((x) => openFor(x.id)) : openFor(o.id),
      blocked: o.kind === "pack" && items.some((x) => openFor(x.id)),
      audience: mailing ? audience : undefined,
      // Indisponible : e-mailing sans audience, ou plafond de la lettre atteint jusqu'après l'événement.
      unavailable: mailing && audience === 0 ? t("Indisponible : audience nulle.") : mailing && slot?.tooLate ? t("Indisponible avant l'événement : plafond de la lettre atteint.") : undefined,
      note: mailing && slot?.capped ? slot.message! : undefined,
      minDate: mailing && slot?.capped && !slot.tooLate ? slot.nextAt!.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }) : undefined,
    };
  }).filter((o) => !o.pack || o.compareAt != null || o.ordered);
  // Carte « Votre événement est en ligne » : seulement ce qui peut être commandé (ni pack ni e-mailing indisponible).
  const orderable = offerCards.filter((o) => !o.ordered && !o.blocked && !o.unavailable);
  const pack = orderable.find((o) => o.pack);
  const justPublished = publie === "1" && isOrganizer && !event.internal && !!event.publishedAt && !event.serviceOrders.some((x) => ["demandee", "planifiee"].includes(x.status));
  const serviceStats = isOrganizer ? await orderStats(event.serviceOrders.filter((o) => o.status === "realisee")) : new Map();
  /** Une commande de service : libellé, prix, dates, bilan ; « Annuler » tant qu'elle n'est pas planifiée (hors pack). */
  const ServiceOrderRow = async ({ o, inPack = false }: { o: (typeof event.serviceOrders)[number]; inPack?: boolean }) => {
    const { t, locale } = await getT();
    const stats = serviceStats.get(o.id);
    const until = featuredUntil(o, now);
    return (
      <li className="flex-between service-order">
        <span>
          <strong>{t(o.label)}</strong> · {t("{amount} HT", { amount: fmtEur(locale, o.priceCents) })}{inPack ? <span className="text-xs muted">{" "}{t("(part du pack)")}</span> : null}
          <span className="text-xs muted">{" "}{t("· commandé le {date}", { date: fmtDate(locale, o.createdAt) })}{o.plannedAt && o.status === "planifiee" ? ` ${t("· prévu le {date}", { date: fmtDate(locale, o.plannedAt) })}` : ""}{o.doneAt ? ` ${t("· réalisé le {date}", { date: fmtDate(locale, o.doneAt) })}` : ""}</span>
          {o.adminNote && <span className="text-xs muted"> · {o.adminNote}</span>}
          {o.resultUrl && <> · <a href={o.resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs">{t("voir le résultat")}</a></>}
        </span>
        {stats && (
          <span className="service-stats" aria-label={t("Bilan du service")}>
            {reportParts(stats, o.offer.kind).map((p) => {
              const [n, ...rest] = p.key.replace("{n}", p.n.toLocaleString(intlLocale(locale))).split(" ");
              return <span key={p.key} className="service-stat"><strong>{n}</strong> {rest.join(" ")}</span>;
            })}
            {conversion(stats) != null && <span className="service-stat"><strong>{conversion(stats)} %</strong>{" "}{t("des visiteurs inscrits")}</span>}
            {stats.since != null && <span className="service-stat"><strong>{stats.since}</strong>{" "}{t(stats.since > 1 ? "inscriptions au total depuis le {date}" : "inscription au total depuis le {date}", { date: fmtDate(locale, o.doneAt!) })}</span>}
          </span>
        )}
        <span className="actions" style={{ marginTop: 0 }}>
          {until ? <span className="pill electric">{t("En cours jusqu'au {date}", { date: fmtDate(locale, until) })}</span> : <span className={`pill ${ORDER_STATUS[o.status]?.tone ?? ""}`}>{t(ORDER_STATUS[o.status]?.label ?? o.status)}</span>}
          {o.status === "demandee" && !inPack && (
            <form action={cancelServiceOrder}><input type="hidden" name="orgId" value={id} /><input type="hidden" name="orderId" value={o.id} /><button className="link danger">{t("Annuler")}</button></form>
          )}
        </span>
      </li>
    );
  };
  const newRfq = (cat?: string) => `/organisations/${id}/prestataires?onglet=nouvelle&evenement=${eventId}${cat ? `&cat=${cat}` : ""}`;
  // Retiré de l'agenda après publication : ce n'est pas un brouillon.
  const withdrawn = !event.publishedAt && !event.internal && !event.cancelledAt && (await everPublished(event.id));
  // États communs (en cours, passé, complet…) ; masqué pendant la suspension de l'organisation.
  const status = orgEventStatus(event, event._count.registrations, { suspended: isSuspendedOrg(org), withdrawn }, now);
  // Modification : les hospitalités déjà acceptées par un inscrit sont figées ; un brouillon jamais publié se supprime.
  const frozenBenefits = event.benefits.some((b) => b._count.accepted > 0);
  const canDelete = isOrganizer && (await deletableDraft(event));
  const missingLink = !event.cancelledAt && needsOnlineLink(event, now);
  const publishBlocked = !readOnly && !event.publishedAt && !event.internal ? await engagementBlock(id, "evenement") : null;
  const duration = event.durationMinutes ? formatDuration(event.durationMinutes, locale) : null;
  // Validation par la conformité (organisations qui l'exigent) : lieu, date, programme, hospitalités, avant publication.
  const review = needsReview(org, event) && !event.cancelledAt ? ((event.reviewStatus as ReviewStatus | null) ?? null) : undefined;
  const reviewed = review !== undefined;
  // Événement d'un dossier pas encore validé : la conformité l'examine avec le dossier.
  const withDossier = reviewed && review == null && !!event.project && !eventPublishable(event.project.status);
  const reviewPeople = reviewed ? await db.user.findMany({ where: { id: { in: [event.reviewSubmittedById, event.reviewedById].filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const personName = (uid: string | null) => { const p = reviewPeople.find((u) => u.id === uid); return p ? `${p.firstName} ${p.lastName}` : null; };
  const reviewRule = review === "submitted" && isCompliance && event.reviewSubmittedById ? await fourEyes(new Set([event.reviewSubmittedById]), id, user.id, COMPLIANCE_ROLES) : "ok";
  const canPublishReview = reviewAllowsPublish(org, event);

  const Flag = ({ flag, label, ghost, disabled }: { flag: string; label: string; ghost?: boolean; disabled?: boolean }) => (
    <form action={setEventFlag}>
      <input type="hidden" name="orgId" value={id} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="flag" value={flag} />
      {retour && <input type="hidden" name="retour" value={retour} />}
      <button className={ghost ? "btn ghost" : "btn"} disabled={disabled}>{label}</button>
    </form>
  );

  /** Services de communication KolBase : avec l'événement, sur sa page comme dans l'onglet Événement du dossier. */
  const servicesSection = isOrganizer && !event.internal && (offers.length > 0 || event.serviceOrders.length > 0) ? (
              <section className="card stack-sm" aria-labelledby="services">
                <SectionHead icon={Megaphone} id="services" title={t("Faire connaître l'événement")} desc={t("Services réalisés par l'équipe KolBase, facturés une fois réalisés (prix HT). Chaque service est mesuré : visiteurs et inscriptions obtenus, bilan envoyé par e-mail une semaine après.")} />
                {event.serviceOrders.length > 0 && (
                  <ul className="plain stack-sm">
                    {groupOrders(event.serviceOrders).map((g) => {
                      if (!g.pack) return <ServiceOrderRow key={g.orders[0].id} o={g.orders[0]} />;
                      // Pack : une ligne « Pack visibilité — 990 € HT », le détail des services se déplie.
                      const ps = packStatus(g.orders.map((o) => packItemStatus(o, now)));
                      const total = g.orders.reduce((n, o) => n + o.priceCents, 0);
                      const cancellable = g.orders.every((o) => o.status === "demandee");
                      return (
                        <li key={g.orders[0].id} className="service-order service-pack-order stack-sm">
                          <div className="flex-between">
                            <span>
                              <strong>{g.pack} — {fmtEur(locale, total)}{" "}{t("HT")}</strong>
                              <span className="text-xs muted">{" "}{t("· {orders} services · commandé le {date}", { orders: g.orders.length, date: fmtDate(locale, g.orders[0].createdAt) })}{ps.status === "en_cours" ? ` ${t(ps.done > 1 ? "· {done} sur {total} réalisés" : "· {done} sur {total} réalisé", { done: ps.done, total: ps.total })}` : ""}</span>
                            </span>
                            <span className="actions" style={{ marginTop: 0 }}>
                              <span className={`pill ${ps.status === "en_cours" ? "electric" : ORDER_STATUS[ps.status]?.tone ?? ""}`}>{ps.status === "en_cours" ? t("En cours") : t(ORDER_STATUS[ps.status]?.label ?? ps.status)}</span>
                              {cancellable && (
                                <form action={cancelServiceOrder}>
                                  <input type="hidden" name="orgId" value={id} />
                                  <input type="hidden" name="orderId" value={g.orders[0].id} />
                                  <ConfirmButton className="link danger" confirm={t("annuler le pack ({orders} services)", { orders: g.orders.length })} summary={<>{t("Les {orders} services du pack sont annulés ensemble : {join}. Le prix réduit ne vaut que pour le pack entier.", { orders: g.orders.length, join: g.orders.map((o) => o.label).join(", ") })}</>}>
                                    {t("Annuler le pack")}
                                  </ConfirmButton>
                                </form>
                              )}
                            </span>
                          </div>
                          <details className="older">
                            <summary>{t("Détail des services du pack")}</summary>
                            <ul className="plain stack-sm">{g.orders.map((o) => <ServiceOrderRow key={o.id} o={o} inPack />)}</ul>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!event.publishedAt ? (
                  <p className="hint">{t("Publiez l'événement dans l'agenda pour commander ces services.")}</p>
                ) : isPast ? null : (
                  <ServiceOffers
                    orgId={id}
                    eventId={eventId}
                    maxDate={event.startsAt.toISOString().slice(0, 10)}
                    offers={offerCards}
                  />
                )}
              </section>
  ) : null;

  return (
    <>
        {mode === "page" && (<p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / {readOnly ? <Link href={`/organisations/${id}/hospitalites`}>{t("Hospitalités")}</Link> : <Link href={`/organisations/${id}/evenements`}>{t("Événements")}</Link>}</p>)}

        <header className={`page-hero${mode === "page" ? "" : " event-hero"}`}>
          <div className="hero-top">
            <span className="eyebrow-sm">{t(eventTypeLabel(event.typeId))}{event.therapeuticArea ? ` · ${event.therapeuticArea}` : ""} · {t(FORMAT_LABEL[event.format])}</span>
            <span className={`pill ${status.tone}`}>{t(status.label)}</span>
          </div>
          {mode === "page" ? <h1>{event.title}</h1> : <h2 className="event-hero-title">{event.title}</h2>}
          {event.description && <p className="lead">{event.description}</p>}
          <dl className="hero-facts">
            <div>
              <dt><CalendarDays size={13} />{" "}{t("Date")}</dt>
              <dd>{fmtDate(locale, event.startsAt)}<small>à {fmtTime(locale, event.startsAt)}{duration ? ` · ${duration}` : ""}</small></dd>
            </div>
            <div>
              <dt><MapPin size={13} />{" "}{t("Lieu")}</dt>
              <dd>{event.format === "DISTANCIEL" ? t("En ligne") : event.city ?? t("À définir")}<small>{event.format === "DISTANCIEL" ? (event.onlineUrl ? t("lien de connexion renseigné") : t("lien de connexion à ajouter")) : event.venue ?? (event.format === "HYBRIDE" ? t("et en ligne") : t("lieu à préciser"))}{event.format === "HYBRIDE" && event.venue ? (event.onlineUrl ? t(" · lien renseigné") : t(" · lien à ajouter")) : ""}</small></dd>
            </div>
            <div>
              <dt><Users size={13} />{" "}{t("Participants")}</dt>
              <dd>{participants}{event.capacity ? ` / ${event.capacity}` : ""}<small>{event.internal ? (event.project ? t("experts du dossier lié") : t("réunion interne")) : t("inscrits")}</small></dd>
            </div>
            {!event.internal && (
              <div>
                <dt><Gift size={13} />{" "}{t("Hospitalités")}</dt>
                <dd>{fmtEur(locale, hosp.cents)}{" "}{t("TTC")}<small>{t(hosp.beneficiaries > 1 ? "{beneficiaries} bénéficiaires" : "{beneficiaries} bénéficiaire", { beneficiaries: hosp.beneficiaries })}{hosp.known ? ` ${t(hosp.beneficiaries > 1 ? "présents · consommées" : "présent · consommées")}` : t(" · valeur déclarée")}</small></dd>
              </div>
            )}
            <div>
              <dt><Truck size={13} />{" "}{t("Logistique")}</dt>
              <dd>{engagedTtc ? t("{amount} TTC", { amount: fmtEur(locale, engagedTtc) }) : t(rfqs.length > 1 ? "{rfqs} demandes" : "{rfqs} demande", { rfqs: rfqs.length })}<small>{engagedTtc ? t("devis retenus") : rfqs.length ? t("devis en cours") : t("aucun devis demandé")}</small></dd>
            </div>
          </dl>
        </header>

        {justPublished && orderable.length > 0 && (
          <section className="card published-offer" aria-labelledby="publie">
            <Megaphone size={26} strokeWidth={1.6} aria-hidden />
            <div>
              <h2 id="publie">{t("Votre événement est en ligne dans l'agenda de KolBase")}</h2>
              <p className="muted">
                {t("Faites-le connaître auprès des praticiens membres : {join}.", { join: orderable.filter((o) => !o.pack).map((o) => o.label.charAt(0).toLowerCase() + o.label.slice(1)).join(", ") })}
                {pack ? <> {pack.label} : <strong>{pack.price}</strong>{" "}{t("au lieu de {compareAt}.", { compareAt: pack.compareAt })}</> : null}
              </p>
            </div>
            <a className="btn" href="#services">{t("Voir les services")}</a>
          </section>
        )}

        {publishBlocked && <BillingNotice orgId={id} motive="evenement" objet={eventId} />}

        {readOnly && <p className="notice">{t("Lecture seule (rôle Conformité) : les modifications de l'événement relèvent de l'équipe Projets ou d'un administrateur.")}</p>}
        {!isOrganizer && !readOnly && <p className="notice ok">{t("Événement confié à {agency} par {org}.", { agency: event.agency?.name ?? t("votre agence"), org: org.name })}</p>}

        {missingLink && (
          <p className="notice error" role="alert">
            {t("Lien de connexion manquant : l'événement commence le {date} à {date2} et les inscrits ne peuvent pas se connecter.", { date: fmtDate(locale, event.startsAt), date2: fmtTime(locale, event.startsAt) })}{" "}{!readOnly && <a href="#modifier">{t("Ajouter le lien de connexion")}</a>}
          </p>
        )}

        {ended && !event.internal && !event.cancelledAt && (
          <section className="card stack-sm bilan" aria-labelledby="bilan">
            <div className="card-head">
              <div>
                <SectionHead icon={ClipboardCheck} id="bilan" title={t("Bilan de l'événement")} />
                <p className="muted">{pointed ? t("D'après le pointage à l'accueil et les devis retenus.") : t("Aucun participant pointé : la présence n'est pas connue, les chiffres portent sur les inscrits.")}</p>
              </div>
              {!readOnly && <a className="btn ghost small" href={`/organisations/${id}/evenements/${eventId}/emargement`}><FileDown size={14} />{" "}{t("Feuille d'émargement")}</a>}
            </div>
            <dl className="hero-facts">
              <div><dt><Users size={13} />{" "}{t("Présents")}</dt><dd>{pointed ? `${present.length} / ${event.registrations.length}` : "—"}<small>{pointed && event.registrations.length ? t("{round} % des inscrits", { round: Math.round((present.length / event.registrations.length) * 100) }) : t(event.registrations.length > 1 ? "{registrations} inscrits" : "{registrations} inscrit", { registrations: event.registrations.length })}</small></dd></div>
              <div><dt><Euro size={13} />{" "}{t("Coût réel")}</dt><dd>{fmtEur(locale, realCost)}{" "}{t("TTC")}<small>{t("hospitalités et prestataires")}</small></dd></div>
              <div><dt><Euro size={13} />{" "}{t("Par")}{" "}{pointed ? t("présent") : t("inscrit")}</dt><dd>{hosp.headcount ? `${fmtEur(locale, Math.round(realCost / hosp.headcount))} TTC` : "—"}<small>{pointed ? t("coût réel rapporté aux présents") : t("coût réel rapporté aux inscrits")}</small></dd></div>
              <div><dt><Gift size={13} />{" "}{t("Hospitalités")}</dt><dd>{fmtEur(locale, hospConsumed)}{" "}{t("TTC")}<small>{pointed ? t("consommées par les présents") : t("acceptées par les inscrits")}</small></dd></div>
            </dl>
            {absentsWithBenefits.length > 0 && (
              <p className="notice warn">
                {t(absentsWithBenefits.length > 1 ? "{absentsWithBenefits} inscrits absents au pointage avaient accepté des hospitalités ({montant} TTC) : non consommées, elles ne sont pas déclarées." : "{absentsWithBenefits} inscrit absent au pointage avait accepté des hospitalités ({montant} TTC) : non consommées, elles ne sont pas déclarées.", { absentsWithBenefits: absentsWithBenefits.length, montant: fmtEur(locale, hospOf(absentsWithBenefits)) })}
                {isCompliance && <> <Link href={`/organisations/${id}/hospitalites`}>{t("Hospitalités à déclarer")}</Link></>}
              </p>
            )}
            {!readOnly && <p className="hint"><Link href={`/organisations/${id}/evenements/${eventId}/pointage`}>{t("Corriger le pointage")}</Link>{" "}{t("si une arrivée n'a pas été enregistrée.")}</p>}
            <div className="followup-row">
              <div>
                <strong>{t("Attestations et questionnaire")}</strong>
                <p className="muted text-sm">
                  {followed.length
                    ? t(pointed ? (followed.length > 1 ? "Envoyés le {date} à {followed} participants présents." : "Envoyés le {date} à {followed} participant présent.") : followed.length > 1 ? "Envoyés le {date} à {followed} participants." : "Envoyés le {date} à {followed} participant.", { date: fmtDate(locale, lastSent(followed, "followUpSentAt")!), followed: followed.length })
                    : ended
                      ? t(pointed ? "Envoi automatique une heure après la fin : remerciement, attestation de présence et questionnaire de satisfaction." : "Envoi automatique une heure après la fin : remerciement, questionnaire de satisfaction.")
                      : t("Envoyés automatiquement une heure après la fin de l'événement.")}
                </p>
              </div>
              <div className="actions">
                {pointed && !readOnly && <a className="btn ghost small" href={`/organisations/${id}/evenements/${eventId}/attestations`}><FileDown size={14} />{" "}{t("Attestations (PDF)")}</a>}
                {!readOnly && ended && followed.length < (pointed ? present.length : event.registrations.length) && <SendNowButton kind="followups" orgId={id} eventId={eventId} label={followed.length ? t("Envoyer aux autres participants") : t("Envoyer maintenant")} />}
              </div>
            </div>
          </section>
        )}

        {ended && !event.internal && (
          <section className="card stack-sm" aria-labelledby="avis">
            <SectionHead icon={Star} id="avis" title={t("Avis des participants")} />
            {survey.count === 0 ? (
              <p className="muted">{t("Aucune réponse pour l'instant.")}{followed.length ? "" : t(" Le questionnaire part avec le remerciement, après l'événement.")}</p>
            ) : (
              <>
                <dl className="hero-facts">
                  <div><dt>{t("Satisfaction globale")}</dt><dd>{fmtRating(survey.overall)} / 5<small>{t(survey.count > 1 ? "{count} réponses" : "{count} réponse", { count: survey.count })}{followed.length ? ` ${t(followed.length > 1 ? "sur {followed} envois" : "sur {followed} envoi", { followed: followed.length })}` : ""}</small></dd></div>
                  <div><dt>{t("Contenu scientifique")}</dt><dd>{fmtRating(survey.content)} / 5</dd></div>
                  <div><dt>{t("Organisation et accueil")}</dt><dd>{fmtRating(survey.logistics)} / 5</dd></div>
                </dl>
                {event.surveys.some((r) => r.comment) && (
                  <ul className="survey-comments">
                    {event.surveys.filter((r) => r.comment).map((r) => <li key={r.id}><span className="rating">{"★".repeat(r.overall)}</span> « {r.comment} »</li>)}
                  </ul>
                )}
                <p className="hint">{t("Réponses anonymes : le nom des participants n'est pas communiqué.")}</p>
              </>
            )}
          </section>
        )}

        <div className="page-grid">
          <div className="page-main">
            {!readOnly && !event.cancelledAt && <details className="card edit-block" id="modifier" open={missingLink}>
              <summary><SectionHead icon={Pencil} title={t("Modifier l'événement")} desc={t("Titre, date, lieu, format et hospitalités proposées.")} /></summary>
              <EditEventForm
                orgId={id}
                eventId={eventId}
                types={EVENT_TYPES.map((tk) => ({ value: tk.id, label: t(tk.label) }))}
                formats={Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label: t(label) }))}
                catalog={BENEFIT_CATALOG}
                registrations={event.registrations.length}
                frozen={frozenBenefits ? event.benefits.map((b) => ({ catalogId: b.catalogId, label: b.label, valueCents: b.valueCents })) : undefined}
                limits={settings}
                initial={{
                  title: event.title, typeId: event.typeId, therapeuticArea: event.therapeuticArea ?? "", description: event.description ?? "",
                  startsAt: toParisInput(event.startsAt), durationMinutes: event.durationMinutes != null ? String(event.durationMinutes) : "",
                  format: event.format, capacity: event.capacity != null ? String(event.capacity) : "", city: event.city ?? "", postalCode: event.postalCode ?? "", venue: event.venue ?? "",
                  onlineUrl: event.onlineUrl ?? "", benefits: event.benefits.map((b) => ({ catalogId: b.catalogId, valueCents: b.valueCents })),
                }}
              />
            </details>}

            <section className="card logistics" aria-labelledby="logistique-titre">
              <SectionHead icon={Truck} id="logistique-titre" title={t("Logistique et prestataires")} desc={t("Consultez les prestataires référencés, comparez leurs devis détaillés et retenez la meilleure offre : le coût par participant est rapproché des seuils d'hospitalité.")}>
                {!readOnly && <Link className="btn small" href={newRfq()}>{t("Demander des devis")}</Link>}
              </SectionHead>
              {rfqs.length > 0 && (
                <ul className="logistics-list">
                  {rfqs.map((r) => {
                    const st = RFQ_STATUS[rfqDisplayStatus(r)];
                    const kept = r.quotes.find((q) => q.status === "retained");
                    const ref = kept ?? r.quotes[0];
                    const ttc = ref ? quoteTtc(ref) : 0;
                    // Valeur et seuils : le prix par couvert commandé ; le coût par présent, après l'événement, pour information.
                    const head = costPerHead(ttc, r.headcount ?? expected, present.length, ended);
                    const pp = ref ? perParticipant(r.category, ttc, r.headcount ?? expected, settings) : null;
                    return (
                      <li key={r.id}>
                        <div className="logistics-row">
                          <div>
                            <strong>{t(supplierCategoryLabel(r.category))}</strong>
                            <div className="muted text-sm">
                              {r.conflicted
                                ? `${t("Votre organisation est consultée : l'organisation conduit cette demande")}${ref ? ` · ${t("votre devis {montant} TTC", { montant: fmtEur(locale, ttc) })}` : ""}`
                                : <>
                                    {t(r._count.suppliers > 1 ? "{quotes} devis sur {suppliers} prestataires consultés" : "{quotes} devis sur {suppliers} prestataire consulté", { quotes: r.quotes.length, suppliers: r._count.suppliers })}
                                    {ref ? ` · ${kept ? t("retenu : {name}", { name: kept.supplier.name }) : "meilleure offre"} ${fmtEur(locale, ttc)} TTC` : ""}
                                  </>}
                            </div>
                            {pp && <div className={`text-xs ${pp.over ? "warn-text" : "muted"}`}>{t("≈ {amount} € TTC {per}", { amount: pp.each.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 }), per: t(perHeadLabel(r.category)) })}{pp.limit ? (pp.over ? ` ${t("· au-dessus du seuil {of} ({max} € TTC)", { of: t(pp.limit.of), max: pp.limit.max })}` : ` ${t("· sous le seuil {of}", { of: t(pp.limit.of) })}`) : ""}</div>}
                            {ref && head.perPresent != null && <div className="text-xs muted">{t("Pour information : {toLocaleString} € TTC par présent ({present} au pointage)", { toLocaleString: head.perPresent.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 }), present: present.length })}</div>}
                          </div>
                          <span className={`pill ${st.tone}`}>{t(st.label)}</span>
                          {!readOnly && <Link className="btn ghost small" href={`/organisations/${id}/prestataires?onglet=demandes#rfq-${r.id}`}>{kept ? t("Voir") : t("Comparer")}</Link>}
                        </div>
                        {isOrganizer && kept && pp && HOSPITALITY_CATS.includes(r.category) && event.benefits.length > 0 && (
                          <form action={applyQuoteToBenefit} className="apply-benefit">
                            <input type="hidden" name="orgId" value={id} />
                            <input type="hidden" name="quoteId" value={kept.id} />
                            <span className="text-sm">{t("Reporter le prix {perHeadLabel} dans la valeur déclarée", { perHeadLabel: t(perHeadLabel(r.category)) })}</span>
                            <select name="benefitId" aria-label={t("Hospitalité concernée")}>
                              {event.benefits.map((b) => <option key={b.id} value={b.id}>{t("{label} (déclaré {montant} TTC)", { label: b.label, montant: fmtEur(locale, b.valueCents) })}</option>)}
                            </select>
                            <input name="value" inputMode="decimal" defaultValue={pp.each.toFixed(2).replace(".", ",")} aria-label={t("Valeur par participant (€ TTC)")} />
                            <span className="text-sm">{t("€ TTC")}</span>
                            <button className="btn ghost small">{t("Mettre à jour")}</button>
                            <span className="hint">{t("Si le devis couvre plusieurs prestations, répartissez sa valeur. Les inscriptions déjà déclarées gardent la leur.")}</span>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {usefulCats.length > 0 && (
                <div className="chips">
                  <span className="muted text-sm">{rfqs.length ? t("Autres besoins :") : t("Besoins courants :")}</span>
                  {usefulCats.map((c) => <Link key={c.id} className="chip" href={newRfq(c.id)}>+ {t(c.label)}</Link>)}
                </div>
              )}
            </section>

            {isOrganizer && mode === "page" && (
              <section className="card stack-sm" aria-labelledby="intervenants-titre">
                <SectionHead icon={Users} id="intervenants-titre" title={t("Intervenants")} desc={event.project ? t("Publiez une opportunité rattachée à l'événement : les experts référencés candidatent, ceux que vous retenez rejoignent le dossier de l'événement.") : t("Publiez une opportunité rattachée à l'événement : les experts référencés candidatent, vous retenez, un dossier s'ouvre pour chaque intervenant.")}>
                  <Link className="btn ghost small" href={`/organisations/${id}/opportunites?evenement=${eventId}#nouvel-appel`}>{t("Publier une opportunité")}</Link>
                </SectionHead>
                {calls.length > 0 && (
                  <ul className="logistics-list">
                    {calls.map((c) => {
                      const kept = c.applications.filter((a) => a.status === "retained");
                      const pending = c.applications.filter((a) => a.status === "pending").length;
                      return (
                        <li key={c.id}>
                          <div className="logistics-row">
                            <div>
                              <strong>{c.title}</strong>
                              <div className="muted text-sm">
                                {kept.length}{c.slots ? ` / ${c.slots}` : ""}{" "}{t(kept.length > 1 ? "retenus" : "retenu")}
                                {kept.length ? ` : ${kept.map((a) => `${drPrefix(a.practitioner.profession)}${a.practitioner.user.lastName}`).join(", ")}` : ""}
                                {pending ? ` ${t(pending > 1 ? "· {pending} candidatures à examiner" : "· {pending} candidature à examiner", { pending })}` : ""}
                              </div>
                            </div>
                            <span className={`pill ${c.status !== "open" ? "done" : c.slots != null && kept.length >= c.slots ? "bad" : "ok"}`}>{c.status !== "open" ? t("Clôturé") : c.slots != null && kept.length >= c.slots ? t("Complet") : t("Ouvert")}</span>
                            <Link className="btn ghost small" href={`/organisations/${id}/opportunites/${c.id}`}>{t("Voir")}</Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {event.internal && mode === "dossier" && expertsHref && (
              <section className="card stack-sm" aria-labelledby="participants-titre">
                <SectionHead icon={Users} id="participants-titre" title={t("Participants")} desc={t("Réunion interne : les participants sont les experts du dossier ({n} sollicités, {m} engagés).", { n: experts.length, m: experts.filter((e) => e.status !== "ATT_EXPERTS").length })}>
                  <Link className="btn ghost small" href={expertsHref}>{t("Voir les experts")}</Link>
                </SectionHead>
                <p className="hint">{t("Les hospitalités offertes aux experts (repas, nuitée) relèvent de leur convention : précisez-les dans le dossier.")}</p>
              </section>
            )}
            {event.internal && !(mode === "dossier" && expertsHref) && (
              <section className="card stack-sm" aria-labelledby="participants-titre">
                <SectionHead icon={Users} id="participants-titre" title={t("Participants")} />
                {experts.length === 0 ? (
                  <p className="muted">{event.project ? t("Aucun expert engagé dans le dossier pour l'instant.") : t("Réunion interne sans dossier rattaché : les participants ne sont pas suivis ici.")}</p>
                ) : (
                  <ul className="plain stack-sm">
                    {experts.map((e) => (
                      <li key={e.id} className="flex-between">
                        <span>{drPrefix(e.practitioner.profession)}{e.practitioner.user.firstName} {e.practitioner.user.lastName}</span>
                        <span className={`pill ${e.status === "ATT_EXPERTS" ? "wait" : "ok"}`}>{e.status === "ATT_EXPERTS" ? t("Réponse attendue") : t("Engagé")}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="hint">{t("Les hospitalités offertes aux experts (repas, nuitée) relèvent de leur convention : précisez-les dans le dossier.")}</p>
              </section>
            )}

            {servicesSection}

            <section className="card" aria-labelledby="programme-titre">
              <SectionHead icon={ListOrdered} id="programme-titre" title={t("Programme")} desc={event.internal ? t("Ordre du jour, horaires et intervenants.") : t("Affiché sur la page publique de l'événement.")}>
                {!event.internal && event.publishedAt && event.program && <Link className="link text-sm" href={`/evenements/${event.id}`}>{t("voir sur la page publique")}</Link>}
              </SectionHead>
              {readOnly ? (event.program ? <p className="pre-line">{event.program}</p> : <p className="muted">{t("Aucun programme.")}</p>) : <ProgramForm orgId={id} eventId={eventId} program={event.program ?? ""} ai={aiEnabled()} />}
            </section>

            <section className="card" aria-labelledby="hospitalites-titre">
              <SectionHead icon={Gift} id="hospitalites-titre" title={t("Hospitalités proposées")} desc={t("Prestations offertes aux participants, avec le régime de chacune.")} />
              {event.benefits.length === 0 ? <p className="muted">{t("Aucune.")}</p> : (
                <>
                  {/* Régime par prestation, avec les seuils de l'organisation (participant exerçant en France). */}
                  <ul className="plain stack-sm">
                    {event.benefits.map((b) => {
                      const r = hospitalityRegime(settings, [b]);
                      return (
                        <li key={b.id} className="flex-between">
                          <span>{t(b.label)}</span>
                          <span className="muted">{t("{montant} TTC par personne", { montant: fmtEur(locale, b.valueCents) })}{" "}<span className={`pill ${r.regime === "autorisation" ? "wait" : "ok"}`} title={regimeReason(r, t, intlLocale(locale))}>{t(REGIME_LABEL[r.regime])}</span></span>
                        </li>
                      );
                    })}
                  </ul>
                  {(() => {
                    const all = hospitalityRegime(settings, event.benefits);
                    return (
                      <p className={all.regime === "autorisation" ? "notice warn" : "hint"}>
                        {t("Participant qui accepte toutes les prestations : convention")}{" "}{all.regime === "autorisation" ? t("soumise à autorisation de l'Ordre ({reason}), à demander au moins {authorizationDays} jours avant l'événement", { reason: regimeReason(all, t, intlLocale(locale)), authorizationDays: settings.authorizationDays }) : t("déclarée à l'Ordre (sous les seuils d'autorisation)")}.
                      </p>
                    );
                  })()}
                </>
              )}
            </section>
          </div>

          <aside className="page-aside">
            {reviewed && (
              <section className="card stack-sm review-card" id="validation" aria-labelledby="validation-titre">
                <SectionHead icon={ShieldCheck} id="validation-titre" title={t("Validation par la conformité")} tone={review === "changes" ? "danger" : review === "approved" ? "ok" : "warn"} />
                <p><span className={`pill ${review ? REVIEW_TONE[review] : withDossier ? "wait" : ""}`}>{review ? t(REVIEW_LABEL[review]) : withDossier ? t("Examiné avec le dossier") : t("À soumettre")}</span></p>
                {/* Points examinés : ce que la conformité valide, tel qu'il est aujourd'hui. */}
                <ul className="review-points">
                  <li><span>{t("Date")}</span> {fmtDate(locale, event.startsAt)} · {fmtTime(locale, event.startsAt)}</li>
                  <li><span>{t("Lieu")}</span> {event.format === "DISTANCIEL" ? t("À distance") : [event.venue, event.city].filter(Boolean).join(", ") || <em className="warn-text">{t("à préciser")}</em>}</li>
                  <li><span>{t("Programme")}</span> {event.program ? t("renseigné") : <em className="warn-text">{t("à compléter")}</em>}</li>
                  <li><span>{t("Hospitalités")}</span> {event.benefits.length === 0 ? t("aucune") : <>{t("jusqu'à {amount} TTC par personne", { amount: fmtEur(locale, event.benefits.reduce((s, b) => s + b.valueCents, 0)) })} · {t(REGIME_LABEL[hospitalityRegime(settings, event.benefits).regime])}</>}</li>
                </ul>
                {withDossier && <p className="hint">{t("Événement du dossier « {title} » : la conformité valide le lieu, la date, le programme et les hospitalités avec le dossier.", { title: event.project!.title })}</p>}
                {review == null && !withDossier && (
                  <>
                    <p className="hint">{t("La conformité valide le lieu, la date, le programme et les hospitalités avant la publication.")}</p>
                    {!readOnly ? (
                      <form action={submitEventReview}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <button className="btn small">{t("Soumettre à la conformité")}</button>
                      </form>
                    ) : <p className="hint">{t("Pas encore soumis par l'équipe qui organise l'événement.")}</p>}
                  </>
                )}
                {review === "submitted" && (
                  <>
                    <p className="text-sm">
                      {event.reviewSubmittedAt && (personName(event.reviewSubmittedById) ? t("Soumis le {date} par {name}.", { date: fmtDate(locale, event.reviewSubmittedAt), name: personName(event.reviewSubmittedById)! }) : t("Soumis le {date}.", { date: fmtDate(locale, event.reviewSubmittedAt) }))}
                      {event.reviewChanges.length > 0 && <> {t("Modifié après validation : {changes}.", { changes: event.reviewChanges.map((c) => t(c)).join(", ") })}</>}
                    </p>
                    {event.publishedAt && <p className="hint">{t("L'événement reste en ligne pendant l'examen des modifications.")}</p>}
                    {isCompliance
                      ? reviewRule === "blocked" ? <p className="notice warn">{t(FOUR_EYES_BLOCKED)}</p> : <EventReviewForm orgId={id} eventId={eventId} justify={reviewRule === "justify"} />
                      : <p className="hint">{t("En attente de la conformité : la publication sera possible une fois l'événement validé.")}</p>}
                  </>
                )}
                {review === "approved" && event.reviewedAt && (
                  <p className="text-sm">
                    {personName(event.reviewedById) ? t("Validé le {date} par {name}.", { date: fmtDate(locale, event.reviewedAt), name: personName(event.reviewedById)! }) : t("Validé le {date}.", { date: fmtDate(locale, event.reviewedAt) })}
                    {event.reviewNote && <> « {event.reviewNote} »</>}
                  </p>
                )}
                {review === "approved" && <p className="hint">{t("Un changement de date, de lieu, de format ou d'hospitalités renvoie l'événement à la conformité.")}</p>}
                {review === "changes" && (
                  <>
                    <p className="notice warn">
                      {event.reviewedAt && (personName(event.reviewedById) ? t("Modifications demandées le {date} par {name} :", { date: fmtDate(locale, event.reviewedAt), name: personName(event.reviewedById)! }) : t("Modifications demandées le {date} :", { date: fmtDate(locale, event.reviewedAt) }))}{" "}« {event.reviewNote} »
                    </p>
                    {!readOnly && (
                      <form action={submitEventReview}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <button className="btn small">{t("Soumettre de nouveau à la conformité")}</button>
                      </form>
                    )}
                  </>
                )}
              </section>
            )}
            <section className="card next-step">
              <span className="eyebrow-sm">{t("Diffusion")}</span>
              {event.cancelledAt ? (
                <>
                  <p className="next-hint">
                    {t("Événement annulé le {date}", { date: fmtDate(locale, event.cancelledAt) })}{event.cancelReason ? ` : ${event.cancelReason}` : ""}.{" "}
                    {t("Les inscrits ont été prévenus par e-mail ; la page de l'événement reste lisible à son adresse avec la mention « Événement annulé », hors de l'agenda.")}
                  </p>
                  <Link className="link" href={`/evenements/${event.id}`}>{t("voir la page de l'événement")}</Link>
                </>
              ) : event.internal ? (
                <>
                  <p className="next-hint">{t("Réunion interne : ni publication dans l'agenda, ni inscriptions en ligne.")}{event.project ? t(" Les participants sont les experts du dossier.") : ""}</p>
                  {isOrganizer && <div className="transitions-stack"><Flag flag="public" label={t("Ouvrir au public")} ghost /></div>}
                </>
              ) : (
                <>
                  <p className="next-hint">
                    {event.publishedAt && isSuspendedOrg(org)
                      ? t("Masqué pendant la suspension de l'organisation : l'événement n'est plus visible des praticiens ; les inscrits gardent leur inscription.")
                      : event.publishedAt ? <>{t("Publié dans")}{" "}<Link href={`/evenements/${event.id}`}>{t("l'agenda")}</Link>. {isPast ? t("Inscriptions closes depuis le début de l'événement.") : t(event.registrationOpen ? "Inscriptions ouvertes." : "Inscriptions fermées.")}</> : withdrawn ? t("Retiré de l'agenda : l'événement n'est plus visible des praticiens.") : t("Brouillon : l'événement n'est pas encore visible des praticiens.")}
                  </p>
                  {!readOnly && <div className="transitions-stack">
                    {event.publishedAt ? (
                      event.registrations.length === 0 ? <Flag flag="unpublish" label={t("Retirer de l'agenda")} ghost />
                      : ended ? null
                      : isOrganizer ? (
                        <form action={cancelEvent} className="stack-sm">
                          <input type="hidden" name="orgId" value={id} />
                          <input type="hidden" name="eventId" value={eventId} />
                          <input name="reason" required maxLength={500} aria-label={t("Motif de l'annulation (obligatoire)")} placeholder={t("Motif de l'annulation (obligatoire)")} />
                          <ConfirmButton
                            className="btn ghost"
                            confirm={t("annuler l'événement")}
                            summary={<>{event.registrations.length > 1 ? t("Les {registrations} inscrits reçoivent", { registrations: event.registrations.length }) : t("L'inscrit reçoit")}{" "}{t("un e-mail avec le motif ; les inscriptions et les hospitalités prévues sont annulées. L'événement quitte l'agenda et sa page affiche « Événement annulé ».")}</>}
                          >
                            {t("Annuler l'événement")}
                          </ConfirmButton>
                        </form>
                      ) : <span className="hint">{t("Événement avec des inscrits : son annulation relève de {name}.", { name: org.name })}</span>
                    ) : org.verification === "VERIFIED" ? (!eventPublishable(event.project?.status) ? <span className="hint">{t(EVENT_NOT_PUBLISHABLE)}</span> : !canPublishReview ? <span className="hint">{t("Publication possible une fois l'événement validé par la conformité.")}</span> : <Flag flag="publish" label={withdrawn ? t("Republier dans l'agenda") : t("Publier dans l'agenda")} disabled={!!publishBlocked} />) : <span className="hint">{t("Publication possible une fois l'organisation validée par KolBase.")}</span>}
                    {/* Inscriptions : seulement pour un événement publié, avant son début (un brouillon n'en reçoit pas). */}
                    {event.publishedAt && !isPast && (event.registrationOpen ? <Flag flag="close" label={t("Fermer les inscriptions")} ghost /> : <Flag flag="open" label={t("Rouvrir les inscriptions")} ghost />)}
                    {isOrganizer && !event.publishedAt && <Flag flag="internal" label={t("En faire une réunion interne")} ghost />}
                  </div>}
                </>
              )}
              {canDelete && (
                <form action={deleteEventDraft} className="transitions-stack">
                  <input type="hidden" name="orgId" value={id} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <ConfirmButton className="link danger" confirm={t("supprimer le brouillon")} summary={<>{t("« {title} » est supprimé définitivement, avec ses hospitalités prévues.", { title: event.title })}</>}>{t("Supprimer le brouillon")}</ConfirmButton>
                  <span className="hint">{t("Jamais publié, sans inscrit ni demande rattachée : il peut être supprimé.")}</span>
                </form>
              )}
            </section>

            {!event.internal && !ended && !event.cancelledAt && (
              <section className="card stack-sm">
                <SectionHead icon={QrCode} title={isPast ? t("Événement en cours") : t("Accueil le jour J")} />
                {isPast && <p className="notice">{t(event.registrations.length > 1 ? (present.length > 1 ? "{n} présents sur {m} inscrits." : "{n} présent sur {m} inscrits.") : "{n} présent sur {m} inscrit.", { n: present.length, m: event.registrations.length })}{" "}{t("Les retardataires peuvent encore être pointés ; les absents, le bilan et les attestations viennent après la fin, le {date} à {time}.", { date: fmtDate(locale, eventEnd(event)), time: fmtTime(locale, eventEnd(event)) })}</p>}
                <p className="muted text-sm">{t("Chaque inscrit a un badge (QR code) dans « Mes inscriptions ». Scannez-le avec l'appareil photo du téléphone, ou cherchez son nom dans la liste.")}</p>
                {!readOnly && <div className="transitions-stack">
                  <Link className={canPoint ? "btn" : "btn ghost"} href={`/organisations/${id}/evenements/${eventId}/pointage`}>{canPoint ? t("Ouvrir le pointage") : t("Préparer le pointage")}</Link>
                  <a className="btn ghost" href={`/organisations/${id}/evenements/${eventId}/emargement`}>{t("Feuille d'émargement (PDF)")}</a>
                </div>}
                <p className="muted text-sm reminder-status">
                  <Bell size={13} />{" "}
                  {reminded.length
                    ? t(reminded.length > 1 ? "Rappel envoyé le {date} à {date2} ({reminded} inscrits)." : "Rappel envoyé le {date} à {date2} ({reminded} inscrit).", { date: fmtDate(locale, lastSent(reminded, "reminderSentAt")!), date2: fmtTime(locale, lastSent(reminded, "reminderSentAt")!), reminded: reminded.length })
                    : t("Rappel envoyé automatiquement la veille aux inscrits : date, lieu, programme et badge.")}
                </p>
                {!readOnly && !isPast && event.registrations.length > reminded.length && <SendNowButton kind="reminders" orgId={id} eventId={eventId} label={reminded.length ? t("Prévenir les nouveaux inscrits") : t("Envoyer le rappel maintenant")} />}
              </section>
            )}

            {isOrganizer && (
              <section className="card stack-sm">
                <SectionHead icon={Building2} title={t("Agence")} />
                <p className="muted text-sm">
                  {event.agency ? t("Confié à {name} : son équipe gère cet événement avec son propre compte.", { name: event.agency.name }) : t("Géré par votre équipe. Vous pouvez le confier à une agence événementielle : elle est mandatée au passage et prévenue par e-mail.")}
                </p>
                {agencies.length > 0 && (
                  <form action={setEventAgency} className="form">
                    <input type="hidden" name="orgId" value={id} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <label>{t("Confier à")}
                      <select name="agencyId" defaultValue={event.agencyId ?? ""}>
                        <option value="">{t("— personne (géré en interne) —")}</option>
                        {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}{a.mandatesReceived.length ? "" : t(" (nouveau mandat)")}</option>)}
                      </select>
                    </label>
                    <button className="btn ghost small">{event.agency ? t("Changer") : t("Confier l'événement")}</button>
                  </form>
                )}
              </section>
            )}

            {mode === "page" && isOrganizer && event.project && (
              <section className="card stack-sm">
                <SectionHead icon={FolderOpen} title={t("Dossier lié")} />
                <Link href={`/organisations/${id}/dossiers/${event.project.id}`}><strong>{event.project.title}</strong></Link>
                <span><StatusPill status={event.project.status} /></span>
                <p className="hint">{t("Experts, conventions et conformité se suivent dans le dossier ; les devis retenus ici s'ajoutent à son budget.")}</p>
              </section>
            )}
          </aside>
        </div>

        {!event.internal && (
              <section className="card" aria-labelledby="inscrits-titre">
                <SectionHead icon={Users} id="inscrits-titre" title={t("Inscrits")} desc={event.registrations.length ? t(event.registrations.length > 1 ? "{n} inscriptions" : "{n} inscription", { n: event.registrations.length }) : undefined}>
                  {event.registrations.length > 0 && <a className="btn ghost small" href={`/organisations/${id}/evenements/${eventId}/export`}>{t("Exporter (CSV)")}</a>}
                </SectionHead>
                {event.registrations.length === 0 ? (
                  <p className="muted">{t("Aucune inscription pour l'instant.")}</p>
                ) : (
                  <TableWrap label={t("Inscrits")}>
                    <table className="table">
                      <thead><tr><th>{t("Nom")}</th><th>{t("Profession")}</th><th>{t("Structure")}</th><th>{t("Prestations acceptées")}</th><th>{t("Valeur TTC")}</th><th>{t("Inscrit le")}</th>{canPoint && <th>{t("Présence")}</th>}</tr></thead>
                      <tbody>
                        {event.registrations.map((r) => (
                          <tr key={r.id}>
                            <td data-label="Nom">{r.user.firstName} {r.user.lastName}</td>
                            <td data-label="Profession">{r.profession ? t(r.profession) : "—"}</td>
                            <td data-label="Structure">{r.structure ?? "—"}</td>
                            <td data-label="Prestations acceptées">{r.benefits.map((b) => t(b.benefit.label)).join(", ") || t("Aucune")}</td>
                            <td data-label="Valeur TTC">{fmtEur(locale, r.benefits.reduce((s, b) => s + b.valueCents, 0))}{" "}{t("TTC")}</td>
                            <td data-label="Inscrit le">{fmtDate(locale, r.createdAt)}</td>
                            {canPoint && <td data-label="Présence">{r.checkedInAt ? <><span className="pill ok">{fmtTime(locale, r.checkedInAt)}</span>{ended && !readOnly && <> <a className="link" href={`/organisations/${id}/evenements/${eventId}/attestations?inscription=${r.id}`}>{t("attestation")}</a></>}</> : ended && pointed ? <span className="pill wait">{t("Absent")}</span> : "—"}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </section>
        )}
    </>
  );
}
