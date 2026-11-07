import { PageHead, EmptyState } from "@/components/UI";
import { ReviewForm } from "@/components/BookForms";
import { aiEnabled } from "@/lib/ai";
import Link from "next/link";
import { Check, Info, Receipt, Send, X } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { Avatar } from "@/components/Avatar";
import { NewRfqForm, RfqMessageForm, SupplierLine } from "@/components/RfqForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventEnded, eventScope } from "@/lib/events";
import { canCancelRfq, QUOTE_STATUS, RFQ_STATUS, rfqDisplayStatus, rfqView, SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";
import { awardQuote, cancelRfq, proposeQuote, sendRfq } from "@/lib/rfq-actions";
import { endMandate, setMandateAward } from "@/lib/event-actions";
import { activeMandate, type AwardRight } from "@/lib/mandates";
import { lineTotal, lineVat, perHeadLabel, perParticipant, quoteTtc, quoteVatLabel, readLines, vatLabel } from "@/lib/quotes";
import { costPerHead } from "@/lib/indicators";
import { complianceSettings } from "@/lib/compliance";
import { logoSrc } from "@/lib/logos";
import { BillingNotice } from "@/components/BillingNotice";
import { engagementBlock } from "@/lib/billing";
import { Thread } from "@/components/ProjectBits";
import { ConfirmButton } from "@/components/ConfirmButton";
import { de } from "@/lib/elision";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Prestataires")} — KolBase` };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; evenement?: string; cat?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { evenement, cat } = await searchParams;
  const onglet = (await searchParams).onglet ?? (evenement ? "nouvelle" : "demandes");
  const { org, user, roles } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const settings = complianceSettings(org.complianceSettings);
  const scope = eventScope(user, roles);
  const scoped = Object.keys(scope).length > 0;
  const isOrganizer = roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r));
  const blocked = await engagementBlock(id, "devis");

  const [rfqsRaw, suppliersRaw, events] = await Promise.all([
    db.rfq.findMany({
      where: { organizationId: id, ...(scoped ? { event: scope } : {}) },
      include: {
        event: true,
        suppliers: { include: { supplier: true } },
        quotes: { include: { supplier: true }, orderBy: { amountCents: "asc" } },
        messages: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
        review: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.organization.findMany({ where: { kind: "PRESTATAIRE", listed: true, verification: "VERIFIED", NOT: { supplierCategories: { isEmpty: true } } }, orderBy: { name: "asc" } }),
    db.event.findMany({ where: { organizationId: id, ...scope, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" } }),
  ]);
  // Agences mandatées : listées pour l'organisateur, signalées parmi les prestataires consultés, et droit de
  // décision de l'agence connectée (retenir, ou proposer à l'organisateur).
  const mandates = await db.mandate.findMany({
    where: { mandatorId: id, ...activeMandate() },
    include: { agency: { select: { id: true, name: true, _count: { select: { agencyEvents: { where: { organizationId: id } } } } } } },
    orderBy: { startsAt: "desc" },
  });
  const agencyName = new Map(mandates.map((m) => [m.agencyId, m.agency.name]));
  const own = (orgId: string) => user.memberships.some((m) => m.organizationId === orgId);
  const ownOrgIds = user.memberships.filter((m) => m.organization.kind === "PRESTATAIRE").map((m) => m.organizationId);
  // Agence consultée sur une demande de l'événement qu'elle pilote : elle n'en voit que son devis et ses échanges.
  // Devis rangés par total TTC (taux de TVA par ligne) : la meilleure offre d'abord.
  const rfqs = rfqsRaw.map((r) => rfqView({ ...r, quotes: [...r.quotes].sort((a, b) => quoteTtc(a) - quoteTtc(b)) }, ownOrgIds));
  const rightFor = (r: { conflicted: boolean; event: { agencyId: string | null } | null }): AwardRight => {
    if (r.conflicted) return "none";
    if (isOrganizer) return "award";
    const m = mandates.find((x) => x.agencyId === r.event?.agencyId && own(x.agencyId));
    return !m ? "none" : m.canAward ? "award" : "propose";
  };
  // Auteur de chaque demande, et son agence quand il agit par un mandat.
  const creatorIds = [...new Set(rfqs.flatMap((r) => [r.createdById, r.proposedById, r.cancelledById]).filter((x): x is string => !!x))];
  const creators = new Map(
    (creatorIds.length
      ? await db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, firstName: true, lastName: true, memberships: { where: { organization: { kind: "PRESTATAIRE" } }, select: { organizationId: true } } } })
      : []
    ).map((u) => {
      const agency = u.memberships.map((m) => agencyName.get(m.organizationId)).find(Boolean);
      return [u.id, `${u.firstName} ${u.lastName}${agency ? ` (${agency}, agence mandatée)` : ""}`];
    }),
  );
  // Présents des événements passés : le coût par participant d'un devis s'y rapporte après l'événement.
  const now = new Date();
  // Même repère que la fiche de l'événement : présence connue une fois l'événement terminé (eventEnded).
  const pastEventIds = [...new Set(rfqs.filter((r) => r.event && eventEnded(r.event, now)).map((r) => r.event!.id))];
  const presentBy = new Map((pastEventIds.length ? await db.registration.groupBy({ by: ["eventId"], where: { eventId: { in: pastEventIds }, checkedInAt: { not: null } }, _count: { _all: true } }) : []).map((g) => [g.eventId, g._count._all]));
  const ratings = await db.supplierReview.groupBy({ by: ["supplierId"], _avg: { rating: true }, _count: { _all: true } });
  const ratingOf = (sid: string) => ratings.find((r) => r.supplierId === sid);
  // Une agence ne se consulte pas elle-même pour le compte du client.
  const suppliers = suppliersRaw.filter((s) => !own(s.id)).map((s) => ({
    id: s.id, name: s.name, categories: s.supplierCategories, city: s.headquarters, coverage: s.coverage, about: s.about, since: s.createdAt.getFullYear(),
    rating: ratingOf(s.id)?._avg.rating ?? null, reviews: ratingOf(s.id)?._count._all ?? 0,
  }));
  const awarded = rfqs.filter((r) => r.status === "awarded");
  // Montants retenus visibles seulement (une agence consultée ne voit pas celui d'un concurrent).
  const engaged = awarded.reduce((s, r) => s + (r.quotes.find((q) => q.status === "retained")?.amountCents ?? 0), 0);
  const list = cat ? suppliers.filter((s) => s.categories.includes(cat)) : suppliers;
  const tabs = [
    ["demandes", t("Demandes de devis ({n})", { n: rfqs.length })], ["nouvelle", t("Nouvelle demande")], ["annuaire", t("Annuaire ({n})", { n: suppliers.length })],
    ...(isOrganizer ? [["agences", t("Agences mandatées ({mandates})", { mandates: mandates.length })] as const] : []),
  ] as const;

  const sectionTabs = await orgTabs("evenements", id);
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <BillingNotice orgId={id} motive="devis" />
        <SectionNav tabs={sectionTabs} active="prestataires" label={t("Rubrique Événements")} />
        <PageHead title={t("Prestataires et devis")} desc={t("Consultez les prestataires référencés, comparez leurs devis et confiez vos événements à une agence.")} />
        <div className="stats">
          <div className="card stat"><span className="muted">{t("Devis à comparer")}</span><strong>{rfqs.filter((r) => r.status === "sent" && r.quotes.length > 0 && !r.conflicted).length}</strong></div>
          <div className="card stat"><span className="muted">{t("Prestations attribuées")}</span><strong>{awarded.length}</strong></div>
          <div className="card stat"><span className="muted">{t("Budget prestataires engagé")}</span><strong>{fmtEur(locale, engaged)}{" "}{t("HT")}</strong></div>
        </div>
        <nav className="tabs">
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>

        {onglet === "demandes" && (
          <>
            {rfqs.length === 0 && <div className="card empty"><EmptyState icon={Receipt} title={t("Aucune demande de devis.")} action={<Link className="btn secondary small" href="?onglet=nouvelle">{t("Nouvelle demande")}</Link>}>{t("Décrivez votre besoin (salle, traiteur, transport…) : les prestataires référencés vous répondent par un devis.")}</EmptyState></div>}
            {rfqs.map((r) => {
              const st = RFQ_STATUS[rfqDisplayStatus(r)];
              const best = r.quotes.length > 1 && !r.conflicted ? r.quotes[0].id : null;
              const kept = r.quotes.find((q) => q.status === "retained");
              // Agence consultée : le prestataire retenu, s'il s'agit d'un concurrent, sans son montant.
              const keptElsewhere = r.conflicted && r.status === "awarded" && !kept ? rfqsRaw.find((x) => x.id === r.id)?.quotes.find((q) => q.status === "retained")?.supplier.name : null;
              const pending = r.suppliers.filter((s) => !s.declined && !r.quotes.some((q) => q.supplierId === s.supplierId));
              const declinedBy = r.suppliers.filter((s) => s.declined && !r.quotes.some((q) => q.supplierId === s.supplierId));
              const cancellable = (r.status === "draft" || r.status === "sent") && canCancelRfq({ organizer: isOrganizer, author: r.createdById === user.id, conflicted: r.conflicted });
              return (
                <section key={r.id} id={`rfq-${r.id}`} className="card">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow-sm">{t(supplierCategoryLabel(r.category))}{r.city ? ` · ${r.city}` : ""}</div>
                      <h2>{r.event?.title ?? t("Demande de devis")}</h2>
                      {r.event && <div className="muted">{fmtDate(locale, r.event.startsAt)}{r.event.venue ? ` · ${r.event.venue}` : ""}{r.headcount ? ` ${t("· {headcount} participants attendus", { headcount: r.headcount })}` : ""}</div>}
                    </div>
                    <span className={`pill ${st.tone}`}>{t(st.label)}</span>
                  </div>
                  <p>{r.needs}</p>
                  {r.createdById && creators.get(r.createdById) && <p className="text-sm muted">{t("Créée par {v}", { v: creators.get(r.createdById) })}</p>}
                  {r.status === "cancelled" && r.cancelledAt && (
                    <p className="text-sm muted">{r.cancelledById && creators.get(r.cancelledById) ? t("Annulée par {v} le {date}", { v: creators.get(r.cancelledById)!, date: fmtDate(locale, r.cancelledAt) }) : t("Annulée le {date}", { date: fmtDate(locale, r.cancelledAt) })}</p>
                  )}
                  {r.conflicted ? (
                    <div className="info-note">
                      <Info size={15} />
                      <span>
                        {t("Votre organisation est consultée sur cette demande : l'organisation la conduit seule. Vous n'y voyez que votre devis et vos échanges ; répondez depuis")}{" "}<Link href={`/organisations/${r.suppliers[0]?.supplierId}/devis`}>{t("vos demandes de devis")}</Link>.
                      </span>
                    </div>
                  ) : (
                    <div className="kv">
                      <div><span>{t("Prestataires consultés")}</span><span>{r.suppliers.length}</span></div>
                      <div><span>{t("Devis reçus")}</span><span>{r.quotes.length}{r.quotes.length ? ` ${t("· dès {montant} TTC", { montant: fmtEur(locale, quoteTtc(r.quotes[0])) })}` : ""}</span></div>
                      <div><span>{t("Réponse attendue")}</span><span>{r.deadline ? fmtDate(locale, r.deadline) : t("à définir")}</span></div>
                    </div>
                  )}
                  {r.quotes.length > 0 && (
                    <div className="quotes">
                      {r.quotes.map((q) => {
                        const lines = readLines(q.lines);
                        const ttc = quoteTtc(q);
                        // Seuils sur le prix par couvert commandé ; coût par présent après l'événement, pour information.
                        const present = r.event ? presentBy.get(r.event.id) ?? 0 : 0;
                        const head = costPerHead(ttc, r.headcount, present, !!r.event && eventEnded(r.event, now));
                        const pp = perParticipant(r.category, ttc, r.headcount, settings);
                        const expired = q.validUntil && q.validUntil < new Date();
                        return (
                        <div key={q.id} className={`quote${q.id === best ? " best" : ""}`}>
                          <Avatar name={q.supplier.name} size={30} square src={logoSrc(q.supplier)} />
                          <div className="quote-main">
                            <div>
                              <strong>{q.supplier.name}</strong>
                              {agencyName.has(q.supplierId) && <span className="pill wait"> {q.supplierId === r.event?.agencyId ? t("Agence mandatée sur cet événement") : t("Agence mandatée")}</span>}
                              {q.id === best && <span className="pill ok" title={t("Total TTC le plus bas")}>{" "}{t("Meilleure offre")}</span>}
                              {r.status === "sent" && r.proposedQuoteId === q.id && <span className="pill electric" title={r.proposedById ? t("Proposé par {v}", { v: creators.get(r.proposedById) ?? t("l'agence") }) : undefined}>{" "}{t("Proposé par l'agence mandatée")}</span>}
                              {q.status !== "submitted" && <span className={`pill ${q.status === "retained" ? "ok" : "done"}`}> {t(QUOTE_STATUS[q.status])}</span>}
                              {q.revision > 1 && <span className="pill">{" "}{t("Version {revision}", { revision: q.revision })}</span>}
                            </div>
                            <div className="muted">
                              {[
                                t("{amount} TTC (TVA {rate})", { amount: fmtEur(locale, ttc), rate: quoteVatLabel(q, intlLocale(locale), t(" et ")) }),
                                q.validUntil ? t(expired ? "expiré le {date}" : "valable jusqu'au {date}", { date: fmtDate(locale, q.validUntil) }) : null,
                                q.delay,
                              ].filter(Boolean).join(" · ")}
                            </div>
                            {pp && (
                              <div className={`text-xs ${pp.over ? "warn-text" : "muted"}`}>
                                {t("≈ {amount} € TTC {per}", { amount: pp.each.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 }), per: t(perHeadLabel(r.category)) })}
                                {pp.limit && (pp.over ? ` ${t("· au-dessus du seuil {of} ({max} € TTC) : autorisation de l'Ordre à prévoir pour les professionnels de santé", { of: t(pp.limit.of), max: pp.limit.max })}` : ` ${t("· sous le seuil {of} ({max} € TTC)", { of: t(pp.limit.of), max: pp.limit.max })}`)}
                              </div>
                            )}
                            {head.perPresent != null && (
                              <div className="text-xs muted">{t("Pour information : {toLocaleString} € TTC par présent ({present} au pointage)", { toLocaleString: head.perPresent.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 }), present })}</div>
                            )}
                            {(q.note || q.conditions || lines.length > 0 || q.fileKey) && (
                              <details className="quote-detail">
                                <summary>{t("Détail de l'offre")}{lines.length ? ` ${t(lines.length > 1 ? "({lines} lignes)" : "({lines} ligne)", { lines: lines.length })}` : ""}</summary>
                                {lines.length > 0 && (
                                  <table><tbody>{lines.map((l, i) => <tr key={i}><td>{l.label}</td><td>{l.qty.toLocaleString(intlLocale(locale))} × {fmtEur(locale, l.unitCents)} {t("HT")}</td><td>{t("TVA")} {vatLabel(lineVat(l, q.vatBp), intlLocale(locale))}</td><td>{fmtEur(locale, lineTotal(l))} {t("HT")}</td></tr>)}</tbody></table>
                                )}
                                {q.note && <p>{q.note}</p>}
                                {q.conditions && <p className="muted">{t("Conditions : {conditions}", { conditions: q.conditions })}</p>}
                                {q.fileKey && <a href={`/devis/${q.id}`} target="_blank" rel="noreferrer">{t("Devis signé (PDF)")}</a>}
                              </details>
                            )}
                          </div>
                          <span className="amount">{fmtEur(locale, q.amountCents)} <span className="text-xs muted">{t("HT")}</span></span>
                          {r.status === "sent" && own(q.supplierId) && (
                            <span className="text-xs muted" title={t("Conflit d'intérêts : vous êtes membre de ce prestataire.")}>{t("À retenir par l'organisation (conflit d'intérêts)")}</span>
                          )}
                          {r.status === "sent" && expired && !own(q.supplierId) && (
                            <span className="text-xs warn-text" title={t("Une offre expirée n'engage plus le prestataire.")}>{t("Offre expirée : demandez une version à jour")}</span>
                          )}
                          {r.status === "sent" && !expired && !own(q.supplierId) && rightFor(r) === "award" && (
                            <form action={awardQuote} className="award-form">
                              <input type="hidden" name="orgId" value={id} />
                              <input type="hidden" name="quoteId" value={q.id} />
                              <ConfirmButton
                                confirm={t("retenir le devis {de}", { de: de(q.supplier.name) })}
                                summary={
                                  <>
                                    <strong>{q.supplier.name}</strong>{" "}{t(": {montant} HT, soit {montant2} TTC (TVA {quoteVatLabel}).", { montant: fmtEur(locale, q.amountCents), montant2: fmtEur(locale, ttc), quoteVatLabel: quoteVatLabel(q, intlLocale(locale), t(" et ")) })}
                                    {r.quotes.length > 1 && <>{" "}{t("Devis écartés : {join}.", { join: r.quotes.filter((x) => x.id !== q.id).map((x) => `${x.supplier.name} (${fmtEur(locale, x.amountCents)} HT)`).join(", ") })}</>}
                                    {t("Chaque prestataire est prévenu par e-mail ; la décision est définitive.")}
                                  </>
                                }
                              >
                                <Check size={13} />{" "}{t("Retenir")}
                              </ConfirmButton>
                            </form>
                          )}
                          {r.status === "sent" && !expired && !own(q.supplierId) && rightFor(r) === "propose" && (
                            r.proposedQuoteId === q.id
                              ? <span className="text-xs muted">{t("Proposé à l'organisation, qui retient")}</span>
                              : (
                                <form action={proposeQuote}>
                                  <input type="hidden" name="orgId" value={id} />
                                  <input type="hidden" name="quoteId" value={q.id} />
                                  <button className="btn small secondary" title={t("Votre mandat ne permet pas de retenir un devis : l'organisation décide.")}>{t("Proposer à l'organisation")}</button>
                                </form>
                              )
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                  {r.status === "sent" && pending.length > 0 && !r.conflicted && (
                    <p className="muted">{t("En attente de réponse : {join}.", { join: pending.map((s) => s.supplier.name + (agencyName.has(s.supplierId) ? ` (${t("agence mandatée")})` : "")).join(", ") })}</p>
                  )}
                  {(r.status === "sent" || r.status === "awarded") && !r.conflicted && declinedBy.map((s) => (
                    <p key={s.supplierId} className="muted">{t("{name} a décliné", { name: s.supplier.name })}{s.declineNote ? ` : ${s.declineNote}` : "."}</p>
                  ))}
                  {r.status === "draft" && !r.conflicted && <p className="muted">{t("Prestataires sélectionnés : {join}.", { join: r.suppliers.map((s) => s.supplier.name + (agencyName.has(s.supplierId) ? ` (${t("agence mandatée")})` : "")).join(", ") })}</p>}
                  {r.status === "sent" && rightFor(r) === "propose" && <p className="hint">{t("Votre mandat ne vous permet pas de retenir un devis : proposez-en un, l'organisation décide.")}</p>}
                  {(r.status === "sent" || r.status === "awarded") && (
                    <div className="rfq-threads">
                      <span className="label">{t("Questions et échanges")}</span>
                      {r.suppliers.filter((s) => !s.declined || r.messages.some((m) => m.supplierId === s.supplierId)).map((s) => {
                        const msgs = r.messages.filter((m) => m.supplierId === s.supplierId);
                        const last = msgs.at(-1);
                        const toAnswer = !!last?.fromSupplier;
                        return (
                          <details key={s.supplierId} className="rfq-thread" open={toAnswer}>
                            <summary>
                              <strong>{s.supplier.name}</strong>
                              <span className="muted text-xs">{msgs.length ? t(msgs.length > 1 ? "{msgs} messages" : "{msgs} message", { msgs: msgs.length }) : t("aucun message")}</span>
                              {toAnswer && <span className="pill electric">{t("Nouveau message")}</span>}
                            </summary>
                            <Thread messages={msgs} meId={user.id} />
                            {!r.conflicted && (r.status === "sent" || r.quotes.some((q) => q.supplierId === s.supplierId && q.status === "retained")) && (
                              <RfqMessageForm orgId={id} rfqId={r.id} supplierId={s.supplierId} placeholder={t("Écrire à {name}…", { name: s.supplier.name })} />
                            )}
                          </details>
                        );
                      })}
                    </div>
                  )}
                  <div className="actions">
                    {r.status === "draft" && !r.conflicted && (
                      <form action={sendRfq}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="rfqId" value={r.id} />
                        <button className="btn" disabled={!!blocked}><Send size={14} /> {r.suppliers.length > 1 ? t("Envoyer aux {suppliers} prestataires", { suppliers: r.suppliers.length }) : t("Envoyer au prestataire")}</button>
                      </form>
                    )}
                    {cancellable && (
                      <form action={cancelRfq}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="rfqId" value={r.id} />
                        <ConfirmButton
                          className="btn ghost small"
                          confirm={t("annuler la demande")}
                          summary={<>{r.status === "sent" ? t(r.suppliers.length > 1 ? "Les {n} prestataires consultés sont prévenus par e-mail ; aucun devis ne pourra plus être retenu sur cette demande." : "Le prestataire consulté est prévenu par e-mail ; aucun devis ne pourra plus être retenu sur cette demande.", { n: r.suppliers.length }) : t("Le brouillon n'a pas été envoyé : aucun prestataire n'est prévenu.")}{!isOrganizer ? t(" Les organisateurs sont prévenus par e-mail.") : ""}</>}
                        >
                          <X size={13} />{" "}{t("Annuler la demande")}
                        </ConfirmButton>
                      </form>
                    )}
                    {kept && <span className="pill ok"><Check size={12} />{" "}{t("Attribué à {name} — {montant} HT · {montant2} TTC", { name: kept.supplier.name, montant: fmtEur(locale, kept.amountCents), montant2: fmtEur(locale, quoteTtc(kept)) })}</span>}
                    {keptElsewhere && <span className="pill done">{t("Attribuée à {keptElsewhere}", { keptElsewhere })}</span>}
                  </div>
                  {kept && r.status === "awarded" && isOrganizer && (!r.event || r.event.startsAt < new Date()) && (
                    r.review
                      ? <p className="text-sm muted">{t("Votre avis :")}{" "}<span className="rating">{"★".repeat(r.review.rating)}</span> {r.review.comment ? `« ${r.review.comment} »` : ""}</p>
                      : <ReviewForm orgId={id} rfqId={r.id} supplier={kept.supplier.name} />
                  )}
                </section>
              );
            })}
          </>
        )}

        {onglet === "nouvelle" && (
          <NewRfqForm
            orgId={id}
            blocked={blocked}
            ai={aiEnabled()}
            categories={SUPPLIER_CATEGORIES.map((c) => ({ id: c.id, label: t(c.label) }))}
            suppliers={suppliers}
            events={events.map((e) => ({ id: e.id, label: `${fmtDate(locale, e.startsAt)} — ${e.title}`, city: e.city, capacity: e.capacity, agencyId: e.agencyId }))}
            defaultEventId={evenement}
            defaultCategory={cat}
          />
        )}

        {onglet === "agences" && isOrganizer && (
          <section className="stack">
            <div className="info-note">
              <Info size={15} />
              <span>{t("Pour confier un événement à une agence, choisissez-la sur la fiche de l'événement (« Agence ») : elle est mandatée au passage et son équipe y accède aussitôt avec son compte. Ici, vous voyez vos agences et pouvez mettre fin à un mandat.")}</span>
            </div>
            {mandates.length === 0 && <p className="muted">{t("Aucune agence mandatée pour l'instant.")}</p>}
            {mandates.map((m) => (
              <section key={m.id} className="card actions spread">
                <span>
                  <strong>{m.agency.name}</strong>
                  <br />
                  <span className="muted">
                    {m.scope ? `${m.scope} · ` : ""}{t(m.agency._count.agencyEvents > 1 ? "depuis le {date} · {agencyEvents} événements confiés" : "depuis le {date} · {agencyEvents} événement confié", { date: fmtDate(locale, m.startsAt), agencyEvents: m.agency._count.agencyEvents })}
                  </span>
                </span>
                <span className="actions" style={{ marginTop: 0 }}>
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
                </span>
                <span className="text-sm muted" style={{ flexBasis: "100%" }}>
                  {m.canAward
                    ? t("Peut retenir un devis en votre nom sur les événements confiés ; vous êtes prévenu par e-mail de chaque décision.")
                    : t("Propose les devis à retenir ; la décision revient à votre équipe.")}
                </span>
              </section>
            ))}
            {mandates.length > 0 && <p className="hint">{t("Mettre fin au mandat retire aussitôt à l'équipe de l'agence l'accès aux événements qui lui étaient confiés.")}</p>}
          </section>
        )}

        {onglet === "annuaire" && (
          <section className="stack">
            <div className="chips">
              <Link href="?onglet=annuaire" className={`chip${!cat ? " active" : ""}`}>{t("Toutes")}</Link>
              {SUPPLIER_CATEGORIES.map((c) => <Link key={c.id} href={`?onglet=annuaire&cat=${c.id}`} className={`chip${cat === c.id ? " active" : ""}`}>{t(c.label)}</Link>)}
            </div>
            {list.map((s) => <SupplierLine key={s.id} s={s} catLabel={s.categories.map(supplierCategoryLabel).join(", ")} />)}
            {list.length === 0 && <p className="muted">{t("Aucun prestataire référencé dans cette catégorie.")}</p>}
            <div className="info-note">
              <Info size={15} />
              <span>
                {t("Le référencement des prestataires est gratuit ; leur abonnement ne paie que les réponses à de nouvelles demandes, après un premier devis retenu. Il ne leur achète ni un meilleur classement, ni une présélection : le choix des prestataires consultés vous appartient entièrement.")}
              </span>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
