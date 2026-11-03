import { aiEnabled } from "@/lib/ai";
import { ProgramForm } from "@/components/EventForms";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, CalendarDays, ClipboardCheck, Euro, FileDown, Gift, MapPin, Megaphone, QrCode, Star, Truck, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusPill } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventScope, eventTypeLabel, formatDate, formatEUR, formatTime, FORMAT_LABEL } from "@/lib/events";
import { setEventAgency, setEventFlag } from "@/lib/event-actions";
import { applyQuoteToBenefit } from "@/lib/rfq-actions";
import { RFQ_STATUS, rfqDisplayStatus, SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";
import { perParticipant, withVat } from "@/lib/quotes";
import { complianceSettings } from "@/lib/compliance";
import { drPrefix } from "@/lib/professions";
import { checkinOpen } from "@/lib/checkin";
import { eventEnded, fmtRating, surveySummary } from "@/lib/event-followup";
import { ServiceOffers } from "@/components/ServiceForms";
import { cancelServiceOrder } from "@/lib/service-actions";
import { ORDER_STATUS, orderStats } from "@/lib/services";
import { conversion, reportParts } from "@/lib/service-report";
import { SendNowButton } from "@/components/FollowupForms";

export const metadata = { title: "Événement — KolBase" };

/** Prestations dont le coût par participant se rapproche d'une hospitalité déclarée (repas, nuitée). */
const HOSPITALITY_CATS = ["restauration", "hebergement"];

export default async function Page({ params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const { org, roles, user } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const isOrganizer = roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r));
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: id, ...eventScope(user, roles) },
    include: {
      agency: { select: { name: true } },
      project: {
        select: {
          id: true, title: true, status: true,
          experts: { where: { status: { not: "DECLINE" } }, include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } },
        },
      },
      benefits: true,
      registrations: { include: { user: true, benefits: { include: { benefit: true } } }, orderBy: { createdAt: "asc" } },
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
      include: { _count: { select: { suppliers: true } }, quotes: { select: { id: true, amountCents: true, vatBp: true, status: true, supplier: { select: { name: true } } }, orderBy: { amountCents: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    // Agences proposées : les agences événementielles référencées, et celles déjà mandatées.
    isOrganizer
      ? db.organization.findMany({
          where: {
            kind: "PRESTATAIRE",
            OR: [
              { listed: true, supplierCategories: { has: "evenementiel" } },
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
  const totalCents = event.registrations.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);
  const withBenefits = event.registrations.filter((r) => r.benefits.length > 0).length;
  const askedCats = new Set(rfqs.filter((r) => r.status !== "cancelled").map((r) => r.category));
  // Catégories utiles selon le format : une visioconférence n'a besoin ni de salle ni d'hébergement.
  // Raccourcis vers les besoins logistiques courants ; les autres catégories restent accessibles par « Demander des devis ».
  const shortcutIds = event.format === "DISTANCIEL" ? ["audiovisuel", "communication"] : ["salle", "restauration", "hebergement", "transport", "audiovisuel"];
  const usefulCats = SUPPLIER_CATEGORIES.filter((c) => shortcutIds.includes(c.id) && !askedCats.has(c.id));
  const engagedTtc = rfqs.reduce((s, r) => { const k = r.quotes.find((q) => q.status === "retained"); return s + (k ? withVat(k.amountCents, k.vatBp) : 0); }, 0);
  // Accueil et bilan : présence au pointage, coût réel, hospitalités à déclarer.
  const now = new Date();
  const isPast = event.startsAt < now;
  const canPoint = !event.internal && checkinOpen(event.startsAt, now);
  const present = event.registrations.filter((r) => r.checkedInAt);
  const pointed = present.length > 0;
  const hospOf = (rs: typeof event.registrations) => rs.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);
  const absentsWithBenefits = pointed ? event.registrations.filter((r) => !r.checkedInAt && r.benefits.length > 0) : [];
  const hospConsumed = pointed ? hospOf(present) : totalCents;
  const realCost = hospConsumed + engagedTtc;
  const isCompliance = roles.some((r) => COMPLIANCE_ROLES.includes(r));
  // Rappel de la veille, puis remerciement (attestation, questionnaire) : automatiques, ou envoyés d'un clic.
  const ended = eventEnded(event, now);
  const reminded = event.registrations.filter((r) => r.reminderSentAt);
  const followed = event.registrations.filter((r) => r.followUpSentAt);
  const lastSent = (rs: typeof event.registrations, k: "reminderSentAt" | "followUpSentAt") => rs.reduce<Date | null>((m, r) => (r[k] && (!m || r[k]! > m) ? r[k] : m), null);
  const survey = surveySummary(event.surveys);
  const offers = isOrganizer && !event.internal ? await db.serviceOffer.findMany({ where: { active: true }, orderBy: { position: "asc" } }) : [];
  const serviceStats = isOrganizer ? await orderStats(event.serviceOrders.filter((o) => o.status === "realisee")) : new Map();
  const newRfq = (cat?: string) => `/organisations/${id}/prestataires?onglet=nouvelle&evenement=${eventId}${cat ? `&cat=${cat}` : ""}`;
  const status = event.internal
    ? { label: "Réunion interne", tone: "electric" }
    : event.publishedAt
      ? { label: event.registrationOpen ? "Publié · inscriptions ouvertes" : "Publié · inscriptions closes", tone: event.registrationOpen ? "ok" : "done" }
      : { label: "Brouillon", tone: "wait" };
  const duration = event.durationMinutes ? (event.durationMinutes >= 60 ? `${Math.floor(event.durationMinutes / 60)} h${event.durationMinutes % 60 ? ` ${event.durationMinutes % 60}` : ""}` : `${event.durationMinutes} min`) : null;

  const Flag = ({ flag, label, ghost }: { flag: string; label: string; ghost?: boolean }) => (
    <form action={setEventFlag}>
      <input type="hidden" name="orgId" value={id} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="flag" value={flag} />
      <button className={ghost ? "btn ghost" : "btn"}>{label}</button>
    </form>
  );

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/evenements`}>Événements</Link></p>

        <header className="page-hero">
          <div className="hero-top">
            <span className="eyebrow-sm">{eventTypeLabel(event.typeId)}{event.therapeuticArea ? ` · ${event.therapeuticArea}` : ""} · {FORMAT_LABEL[event.format]}</span>
            <span className={`pill ${status.tone}`}>{status.label}</span>
          </div>
          <h1>{event.title}</h1>
          {event.description && <p className="lead">{event.description}</p>}
          <dl className="hero-facts">
            <div>
              <dt><CalendarDays size={13} /> Date</dt>
              <dd>{formatDate(event.startsAt)}<small>à {formatTime(event.startsAt)}{duration ? ` · ${duration}` : ""}</small></dd>
            </div>
            <div>
              <dt><MapPin size={13} /> Lieu</dt>
              <dd>{event.format === "DISTANCIEL" ? "En ligne" : event.city ?? "À définir"}<small>{event.venue ?? (event.format === "HYBRIDE" ? "et en ligne" : "lieu à préciser")}</small></dd>
            </div>
            <div>
              <dt><Users size={13} /> Participants</dt>
              <dd>{participants}{event.capacity ? ` / ${event.capacity}` : ""}<small>{event.internal ? (event.project ? "experts du dossier lié" : "réunion interne") : "inscrits"}</small></dd>
            </div>
            {!event.internal && (
              <div>
                <dt><Gift size={13} /> Hospitalités</dt>
                <dd>{formatEUR(totalCents)}<small>{withBenefits} bénéficiaire{withBenefits > 1 ? "s" : ""} · valeur déclarée</small></dd>
              </div>
            )}
            <div>
              <dt><Truck size={13} /> Logistique</dt>
              <dd>{engagedTtc ? `${formatEUR(engagedTtc)} TTC` : `${rfqs.length} demande${rfqs.length > 1 ? "s" : ""}`}<small>{engagedTtc ? "devis retenus" : rfqs.length ? "devis en cours" : "aucun devis demandé"}</small></dd>
            </div>
          </dl>
        </header>

        {!isOrganizer && <p className="notice ok">Événement confié à {event.agency?.name ?? "votre agence"} par {org.name}.</p>}

        {isPast && !event.internal && (
          <section className="card stack-sm bilan" aria-labelledby="bilan">
            <div className="card-head">
              <div>
                <h2 id="bilan"><ClipboardCheck size={18} /> Bilan de l&apos;événement</h2>
                <p className="muted">{pointed ? "D'après le pointage à l'accueil et les devis retenus." : "Aucun participant pointé : la présence n'est pas connue, les chiffres portent sur les inscrits."}</p>
              </div>
              <a className="btn ghost small" href={`/organisations/${id}/evenements/${eventId}/emargement`}><FileDown size={14} /> Feuille d&apos;émargement</a>
            </div>
            <dl className="hero-facts">
              <div><dt><Users size={13} /> Présents</dt><dd>{pointed ? `${present.length} / ${event.registrations.length}` : "—"}<small>{pointed && event.registrations.length ? `${Math.round((present.length / event.registrations.length) * 100)} % des inscrits` : `${event.registrations.length} inscrit${event.registrations.length > 1 ? "s" : ""}`}</small></dd></div>
              <div><dt><Euro size={13} /> Coût réel</dt><dd>{formatEUR(realCost)}<small>hospitalités et prestataires, TTC</small></dd></div>
              <div><dt><Euro size={13} /> Par {pointed ? "présent" : "inscrit"}</dt><dd>{(pointed ? present.length : event.registrations.length) ? formatEUR(Math.round(realCost / (pointed ? present.length : event.registrations.length))) : "—"}<small>{pointed ? "coût réel rapporté aux présents" : "coût réel rapporté aux inscrits"}</small></dd></div>
              <div><dt><Gift size={13} /> Hospitalités</dt><dd>{formatEUR(hospConsumed)}<small>{pointed ? "consommées par les présents" : "acceptées par les inscrits"}</small></dd></div>
            </dl>
            {absentsWithBenefits.length > 0 && (
              <p className="notice warn">
                {absentsWithBenefits.length} inscrit{absentsWithBenefits.length > 1 ? "s" : ""} absent{absentsWithBenefits.length > 1 ? "s" : ""} au pointage avai{absentsWithBenefits.length > 1 ? "ent" : "t"} accepté des hospitalités ({formatEUR(hospOf(absentsWithBenefits))}) : vérifiez avant de les déclarer.
                {isCompliance && <> <Link href={`/organisations/${id}/hospitalites`}>Hospitalités à déclarer</Link></>}
              </p>
            )}
            <p className="hint"><Link href={`/organisations/${id}/evenements/${eventId}/pointage`}>Corriger le pointage</Link> si une arrivée n&apos;a pas été enregistrée.</p>
            <div className="followup-row">
              <div>
                <strong>Attestations et questionnaire</strong>
                <p className="muted text-sm">
                  {followed.length
                    ? `Envoyés le ${formatDate(lastSent(followed, "followUpSentAt")!)} à ${followed.length} participant${followed.length > 1 ? "s" : ""}${pointed ? " présents" : ""}.`
                    : ended
                      ? `Envoi automatique une heure après la fin : remerciement, ${pointed ? "attestation de présence et " : ""}questionnaire de satisfaction.`
                      : "Envoyés automatiquement une heure après la fin de l'événement."}
                </p>
              </div>
              <div className="actions">
                {pointed && <a className="btn ghost small" href={`/organisations/${id}/evenements/${eventId}/attestations`}><FileDown size={14} /> Attestations (PDF)</a>}
                {ended && followed.length < (pointed ? present.length : event.registrations.length) && <SendNowButton kind="followups" orgId={id} eventId={eventId} label={followed.length ? "Envoyer aux autres participants" : "Envoyer maintenant"} />}
              </div>
            </div>
          </section>
        )}

        {isPast && !event.internal && (
          <section className="card stack-sm" aria-labelledby="avis">
            <h2 id="avis"><Star size={18} /> Avis des participants</h2>
            {survey.count === 0 ? (
              <p className="muted">Aucune réponse pour l&apos;instant.{followed.length ? "" : " Le questionnaire part avec le remerciement, après l'événement."}</p>
            ) : (
              <>
                <dl className="hero-facts">
                  <div><dt>Satisfaction globale</dt><dd>{fmtRating(survey.overall)} / 5<small>{survey.count} réponse{survey.count > 1 ? "s" : ""}{followed.length ? ` sur ${followed.length} envoi${followed.length > 1 ? "s" : ""}` : ""}</small></dd></div>
                  <div><dt>Contenu scientifique</dt><dd>{fmtRating(survey.content)} / 5</dd></div>
                  <div><dt>Organisation et accueil</dt><dd>{fmtRating(survey.logistics)} / 5</dd></div>
                </dl>
                {event.surveys.some((r) => r.comment) && (
                  <ul className="survey-comments">
                    {event.surveys.filter((r) => r.comment).map((r) => <li key={r.id}><span className="rating">{"★".repeat(r.overall)}</span> « {r.comment} »</li>)}
                  </ul>
                )}
                <p className="hint">Réponses anonymes : le nom des participants n&apos;est pas communiqué.</p>
              </>
            )}
          </section>
        )}

        <div className="page-grid">
          <div className="page-main">
            <section className="card logistics">
              <div className="card-head">
                <div>
                  <h2>Logistique et prestataires</h2>
                  <p className="muted">Consultez les prestataires référencés, comparez leurs devis détaillés et retenez la meilleure offre : le coût par participant est rapproché des seuils d&apos;hospitalité.</p>
                </div>
                <Link className="btn" href={newRfq()}>Demander des devis</Link>
              </div>
              {rfqs.length > 0 && (
                <ul className="logistics-list">
                  {rfqs.map((r) => {
                    const st = RFQ_STATUS[rfqDisplayStatus(r)];
                    const kept = r.quotes.find((q) => q.status === "retained");
                    const ref = kept ?? r.quotes[0];
                    const ttc = ref ? withVat(ref.amountCents, ref.vatBp) : 0;
                    const pp = ref ? perParticipant(r.category, ttc, r.headcount ?? expected, settings) : null;
                    return (
                      <li key={r.id}>
                        <div className="logistics-row">
                          <div>
                            <strong>{supplierCategoryLabel(r.category)}</strong>
                            <div className="muted text-sm">
                              {r.quotes.length} devis sur {r._count.suppliers} prestataire{r._count.suppliers > 1 ? "s" : ""} consulté{r._count.suppliers > 1 ? "s" : ""}
                              {ref ? ` · ${kept ? `retenu : ${kept.supplier.name}` : "meilleure offre"} ${formatEUR(ttc)} TTC` : ""}
                            </div>
                            {pp && <div className={`text-xs ${pp.over ? "warn-text" : "muted"}`}>≈ {pp.each.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € par participant{pp.limit ? (pp.over ? ` · au-dessus du seuil d'un ${pp.limit.what} (${pp.limit.max} €)` : ` · sous le seuil d'un ${pp.limit.what}`) : ""}</div>}
                          </div>
                          <span className={`pill ${st.tone}`}>{st.label}</span>
                          <Link className="btn ghost small" href={`/organisations/${id}/prestataires?onglet=demandes#rfq-${r.id}`}>{kept ? "Voir" : "Comparer"}</Link>
                        </div>
                        {isOrganizer && kept && pp && HOSPITALITY_CATS.includes(r.category) && event.benefits.length > 0 && (
                          <form action={applyQuoteToBenefit} className="apply-benefit">
                            <input type="hidden" name="orgId" value={id} />
                            <input type="hidden" name="quoteId" value={kept.id} />
                            <span className="text-sm">Reporter le coût réel dans la valeur déclarée</span>
                            <select name="benefitId" aria-label="Hospitalité concernée">
                              {event.benefits.map((b) => <option key={b.id} value={b.id}>{b.label} (déclaré {formatEUR(b.valueCents)})</option>)}
                            </select>
                            <input name="value" inputMode="decimal" defaultValue={pp.each.toFixed(2).replace(".", ",")} aria-label="Valeur par participant (€ TTC)" />
                            <span className="text-sm">€ TTC</span>
                            <button className="btn ghost small">Mettre à jour</button>
                            <span className="hint">Si le devis couvre plusieurs prestations, répartissez sa valeur. Les inscriptions déjà déclarées gardent la leur.</span>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {usefulCats.length > 0 && (
                <div className="chips">
                  <span className="muted text-sm">{rfqs.length ? "Autres besoins :" : "Besoins courants :"}</span>
                  {usefulCats.map((c) => <Link key={c.id} className="chip" href={newRfq(c.id)}>+ {c.label}</Link>)}
                </div>
              )}
            </section>

            {isOrganizer && (
              <section className="card stack-sm">
                <div className="card-head">
                  <div>
                    <h2>Intervenants</h2>
                    <p className="muted">Lancez un appel à candidatures rattaché à l&apos;événement : les experts référencés candidatent, vous retenez, un dossier s&apos;ouvre pour chaque intervenant.</p>
                  </div>
                  <Link className="btn ghost" href={`/organisations/${id}/opportunites?evenement=${eventId}#nouvel-appel`}>Lancer un appel</Link>
                </div>
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
                                {kept.length}{c.slots ? ` / ${c.slots}` : ""} retenu{kept.length > 1 ? "s" : ""}
                                {kept.length ? ` : ${kept.map((a) => `${drPrefix(a.practitioner.profession)}${a.practitioner.user.lastName}`).join(", ")}` : ""}
                                {pending ? ` · ${pending} candidature${pending > 1 ? "s" : ""} à examiner` : ""}
                              </div>
                            </div>
                            <span className={`pill ${c.status === "open" ? "ok" : "done"}`}>{c.status === "open" ? "Ouvert" : "Clôturé"}</span>
                            <Link className="btn ghost small" href={`/organisations/${id}/opportunites/${c.id}`}>Voir</Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {event.internal && (
              <section className="card">
                <h2>Participants</h2>
                {experts.length === 0 ? (
                  <p className="muted">{event.project ? "Aucun expert engagé dans le dossier pour l'instant." : "Réunion interne sans dossier rattaché : les participants ne sont pas suivis ici."}</p>
                ) : (
                  <ul className="plain stack-sm">
                    {experts.map((e) => (
                      <li key={e.id} className="flex-between">
                        <span>{drPrefix(e.practitioner.profession)}{e.practitioner.user.firstName} {e.practitioner.user.lastName}</span>
                        <span className={`pill ${e.status === "ATT_EXPERTS" ? "wait" : "ok"}`}>{e.status === "ATT_EXPERTS" ? "Réponse attendue" : "Engagé"}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="hint">Les hospitalités offertes aux experts (repas, nuitée) relèvent de leur convention : précisez-les dans le dossier.</p>
              </section>
            )}

            {isOrganizer && !event.internal && (offers.length > 0 || event.serviceOrders.length > 0) && (
              <section className="card stack-sm" aria-labelledby="services">
                <div>
                  <h2 id="services"><Megaphone size={18} /> Faire connaître l&apos;événement</h2>
                  <p className="muted">Services réalisés par l&apos;équipe KolBase, facturés une fois réalisés (prix HT). Chaque service est mesuré : visiteurs et inscriptions obtenus, bilan envoyé par e-mail une semaine après.</p>
                </div>
                {event.serviceOrders.length > 0 && (
                  <ul className="plain stack-sm">
                    {event.serviceOrders.map((o) => (
                      <li key={o.id} className="flex-between service-order">
                        <span>
                          <strong>{o.label}</strong> · {formatEUR(o.priceCents)} HT
                          <span className="text-xs muted"> · commandé le {formatDate(o.createdAt)}{o.plannedAt && o.status === "planifiee" ? ` · prévu le ${formatDate(o.plannedAt)}` : ""}{o.doneAt ? ` · réalisé le ${formatDate(o.doneAt)}` : ""}</span>
                          {o.adminNote && <span className="text-xs muted"> · {o.adminNote}</span>}
                          {o.resultUrl && <> · <a href={o.resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs">voir le résultat</a></>}
                        </span>
                        {serviceStats.get(o.id) && (
                          <span className="service-stats" aria-label="Bilan du service">
                            {reportParts(serviceStats.get(o.id)!, o.offer.kind).map((p) => {
                              const [n, ...rest] = p.key.replace("{n}", p.n.toLocaleString("fr-FR")).split(" ");
                              return <span key={p.key} className="service-stat"><strong>{n}</strong> {rest.join(" ")}</span>;
                            })}
                            {conversion(serviceStats.get(o.id)!) != null && <span className="service-stat"><strong>{conversion(serviceStats.get(o.id)!)} %</strong> des visiteurs inscrits</span>}
                            {serviceStats.get(o.id)!.since != null && <span className="service-stat"><strong>{serviceStats.get(o.id)!.since}</strong> inscription{serviceStats.get(o.id)!.since! > 1 ? "s" : ""} au total depuis le {formatDate(o.doneAt!)}</span>}
                          </span>
                        )}
                        <span className="actions" style={{ marginTop: 0 }}>
                          <span className={`pill ${ORDER_STATUS[o.status]?.tone ?? ""}`}>{ORDER_STATUS[o.status]?.label ?? o.status}</span>
                          {o.status === "demandee" && (
                            <form action={cancelServiceOrder}><input type="hidden" name="orgId" value={id} /><input type="hidden" name="orderId" value={o.id} /><button className="link danger">Annuler</button></form>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {!event.publishedAt ? (
                  <p className="hint">Publiez l&apos;événement dans l&apos;agenda pour commander ces services.</p>
                ) : isPast ? null : (
                  <ServiceOffers
                    orgId={id}
                    eventId={eventId}
                    maxDate={event.startsAt.toISOString().slice(0, 10)}
                    offers={offers.map((o) => ({ id: o.id, label: o.label, description: o.description, price: `${formatEUR(o.priceCents)} HT`, ordered: event.serviceOrders.some((x) => x.offerId === o.id && ["demandee", "planifiee"].includes(x.status)) }))}
                  />
                )}
              </section>
            )}

            <section className="card">
              <div className="block-head">
                <h2>Programme</h2>
                {!event.internal && event.publishedAt && event.program && <Link className="link" href={`/evenements/${event.id}`}>voir sur la page publique</Link>}
              </div>
              <ProgramForm orgId={id} eventId={eventId} program={event.program ?? ""} ai={aiEnabled()} />
            </section>

            <section className="card">
              <h2>Hospitalités proposées</h2>
              {event.benefits.length === 0 ? <p className="muted">Aucune.</p> : (
                <ul className="plain stack-sm">
                  {event.benefits.map((b) => (
                    <li key={b.id} className="flex-between"><span>{b.label}</span><span className="muted">{formatEUR(b.valueCents)} TTC par personne</span></li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="page-aside">
            <section className="card next-step">
              <span className="eyebrow-sm">Diffusion</span>
              {event.internal ? (
                <>
                  <p className="next-hint">Réunion interne : ni publication dans l&apos;agenda, ni inscriptions en ligne.{event.project ? " Les participants sont les experts du dossier." : ""}</p>
                  {isOrganizer && <div className="transitions-stack"><Flag flag="public" label="Ouvrir au public" ghost /></div>}
                </>
              ) : (
                <>
                  <p className="next-hint">
                    {event.publishedAt ? <>Publié dans <Link href={`/evenements/${event.id}`}>l&apos;agenda</Link>. Inscriptions {event.registrationOpen ? "ouvertes" : "fermées"}.</> : "Brouillon : l'événement n'est pas encore visible des praticiens."}
                  </p>
                  <div className="transitions-stack">
                    {event.publishedAt ? <Flag flag="unpublish" label="Retirer de l'agenda" ghost /> : org.verification === "VERIFIED" ? <Flag flag="publish" label="Publier dans l'agenda" /> : <span className="hint">Publication possible une fois l&apos;organisation validée par KolBase.</span>}
                    {event.registrationOpen ? <Flag flag="close" label="Fermer les inscriptions" ghost /> : <Flag flag="open" label="Rouvrir les inscriptions" ghost />}
                    {isOrganizer && !event.publishedAt && <Flag flag="internal" label="En faire une réunion interne" ghost />}
                  </div>
                </>
              )}
            </section>

            {!event.internal && !isPast && (
              <section className="card stack-sm">
                <h2 className="section-title"><QrCode size={15} /> Accueil le jour J</h2>
                <p className="muted text-sm">Chaque inscrit a un badge (QR code) dans « Mes inscriptions ». Scannez-le avec l&apos;appareil photo du téléphone, ou cherchez son nom dans la liste.</p>
                <div className="transitions-stack">
                  <Link className={canPoint ? "btn" : "btn ghost"} href={`/organisations/${id}/evenements/${eventId}/pointage`}>{canPoint ? "Ouvrir le pointage" : "Préparer le pointage"}</Link>
                  <a className="btn ghost" href={`/organisations/${id}/evenements/${eventId}/emargement`}>Feuille d&apos;émargement (PDF)</a>
                </div>
                <p className="muted text-sm reminder-status">
                  <Bell size={13} />{" "}
                  {reminded.length
                    ? `Rappel envoyé le ${formatDate(lastSent(reminded, "reminderSentAt")!)} à ${formatTime(lastSent(reminded, "reminderSentAt")!)} (${reminded.length} inscrit${reminded.length > 1 ? "s" : ""}).`
                    : "Rappel envoyé automatiquement la veille aux inscrits : date, lieu, programme et badge."}
                </p>
                {event.registrations.length > reminded.length && <SendNowButton kind="reminders" orgId={id} eventId={eventId} label={reminded.length ? "Prévenir les nouveaux inscrits" : "Envoyer le rappel maintenant"} />}
              </section>
            )}

            {isOrganizer && (
              <section className="card stack-sm">
                <h2 className="section-title">Agence</h2>
                <p className="muted text-sm">
                  {event.agency ? `Confié à ${event.agency.name} : son équipe gère cet événement avec son propre compte.` : "Géré par votre équipe. Vous pouvez le confier à une agence événementielle : elle est mandatée au passage et prévenue par e-mail."}
                </p>
                {agencies.length > 0 && (
                  <form action={setEventAgency} className="form">
                    <input type="hidden" name="orgId" value={id} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <label>Confier à
                      <select name="agencyId" defaultValue={event.agencyId ?? ""}>
                        <option value="">— personne (géré en interne) —</option>
                        {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}{a.mandatesReceived.length ? "" : " (nouveau mandat)"}</option>)}
                      </select>
                    </label>
                    <button className="btn ghost small">{event.agency ? "Changer" : "Confier l'événement"}</button>
                  </form>
                )}
              </section>
            )}

            {isOrganizer && event.project && (
              <section className="card stack-sm">
                <h2 className="section-title">Dossier lié</h2>
                <Link href={`/organisations/${id}/dossiers/${event.project.id}`}><strong>{event.project.title}</strong></Link>
                <span><StatusPill status={event.project.status} /></span>
                <p className="hint">Experts, conventions et conformité se suivent dans le dossier ; les devis retenus ici s&apos;ajoutent à son budget.</p>
              </section>
            )}
          </aside>
        </div>

        {!event.internal && (
              <section className="card">
                <div className="actions spread">
                  <h2>Inscrits</h2>
                  {event.registrations.length > 0 && <a className="btn ghost small" href={`/organisations/${id}/evenements/${eventId}/export`}>Exporter (CSV)</a>}
                </div>
                {event.registrations.length === 0 ? (
                  <p className="muted">Aucune inscription pour l&apos;instant.</p>
                ) : (
                  <table className="table" tabIndex={0}>
                    <thead><tr><th>Nom</th><th>Profession</th><th>Structure</th><th>Prestations acceptées</th><th>Valeur</th><th>Inscrit le</th>{canPoint && <th>Présence</th>}</tr></thead>
                    <tbody>
                      {event.registrations.map((r) => (
                        <tr key={r.id}>
                          <td>{r.user.firstName} {r.user.lastName}</td>
                          <td>{r.profession ?? "—"}</td>
                          <td>{r.structure ?? "—"}</td>
                          <td>{r.benefits.map((b) => b.benefit.label).join(", ") || "Aucune"}</td>
                          <td>{formatEUR(r.benefits.reduce((s, b) => s + b.valueCents, 0))}</td>
                          <td>{formatDate(r.createdAt)}</td>
                          {canPoint && <td>{r.checkedInAt ? <><span className="pill ok">{formatTime(r.checkedInAt)}</span>{ended && <> <a className="link" href={`/organisations/${id}/evenements/${eventId}/attestations?inscription=${r.id}`}>attestation</a></>}</> : isPast && pointed ? <span className="pill wait">Absent</span> : "—"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
        )}
      </main>
    </>
  );
}
